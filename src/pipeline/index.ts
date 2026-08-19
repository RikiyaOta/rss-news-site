import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Article } from "../shared/types";
import { loadConfig } from "./config";
import { fetchFeedArticles, RawArticle } from "./fetcher";
import { scoreArticleWithProfile, precomputeInterestVectors } from "./scorer";
import {
  initDailyDatabase,
  initSearchIndexDatabase,
  getExistingArticleIds,
  getExistingSearchIndexIds,
  insertArticles,
  insertVectors,
  SearchVectorRecord,
} from "./db";
import { uploadFileToR2, downloadFileFromR2 } from "./storage";

export interface PipelineOptions {
  dateStr?: string;
  configPath?: string;
  outputDir?: string;
  skipR2?: boolean;
  extractorInstance?: any;
  s3Client?: any;
  parser?: any;
}

export interface PipelineResult {
  date: string;
  processedCount: number;
  skippedCount: number;
  totalFetched: number;
  dailyDbPath: string;
  searchDbPath: string;
  articles: Article[];
}

/**
 * RSS記事収集・ローカル埋め込みスコアリング・ベクトル化・SQLite保存・R2同期を行う統合パイプライン
 */
export async function runPipeline(options: PipelineOptions = {}): Promise<PipelineResult> {
  const dateStr = options.dateStr || new Date().toISOString().slice(0, 10);
  const configPath = options.configPath || "config/feeds.yaml";
  const outputDir = options.outputDir || "./data";
  const skipR2 = options.skipR2 ?? false;
  const extractorInstance = options.extractorInstance;
  const s3Client = options.s3Client;
  const parser = options.parser;

  const resolvedOutputDir = path.resolve(outputDir);
  fs.mkdirSync(resolvedOutputDir, { recursive: true });

  const dailyDbPath = path.join(resolvedOutputDir, `${dateStr}.db`);
  const searchDbPath = path.join(resolvedOutputDir, "search_index.db");

  // Step 1 (DB同期): R2から既存の data/YYYY-MM-DD.db と search_index.db を同期
  if (!skipR2) {
    console.log(`[1/4] R2 から既存DBを同期中... (${dateStr})`);
    await downloadFileFromR2(`data/${dateStr}.db`, dailyDbPath, s3Client).catch(() => false);
    await downloadFileFromR2("search_index.db", searchDbPath, s3Client).catch(() => false);
  }

  // Step 2: DB初期化、設定読み込み、RSS巡回、差分抽出
  const dailyDb = initDailyDatabase(dailyDbPath);
  const searchDb = initSearchIndexDatabase(searchDbPath);

  let processedArticles: Article[] = [];
  let skippedCount = 0;
  let totalFetched = 0;

  try {
    const existingDailyIds = getExistingArticleIds(dailyDb);
    const existingSearchIndexIds = getExistingSearchIndexIds(searchDb);

    console.log(`[2/4] RSSフィードを巡回中... (${configPath})`);
    const config = loadConfig(configPath);
    const allArticles: RawArticle[] = [];

    for (const feed of config.feeds) {
      const items = await fetchFeedArticles(feed, parser);
      allArticles.push(...items);
    }

    totalFetched = allArticles.length;
    const seenIds = new Set<string>([...existingDailyIds, ...existingSearchIndexIds]);
    const targetArticles: RawArticle[] = [];

    for (const raw of allArticles) {
      if (seenIds.has(raw.id)) {
        skippedCount++;
      } else {
        seenIds.add(raw.id);
        targetArticles.push(raw);
      }
    }

    console.log(
      `処理対象記事数: ${targetArticles.length} 件 (巡回総数: ${totalFetched} 件, スキップ: ${skippedCount} 件)`,
    );

    // Step 3 (ローカル埋め込みスコアリング & ベクトル化)
    const vectorRecords: SearchVectorRecord[] = [];

    if (targetArticles.length > 0) {
      console.log(`[3/4] ユーザー関心ベクトルの事前計算中...`);
      const interestVectors = await precomputeInterestVectors(
        config.profile.interests,
        extractorInstance,
      );

      for (let i = 0; i < targetArticles.length; i++) {
        const raw = targetArticles[i];
        console.log(
          `[3/4] スコアリング & ベクトル生成中 (${i + 1}/${targetArticles.length}): ${raw.title}`,
        );

        const { score, articleVector } = await scoreArticleWithProfile(
          raw.title,
          raw.snippet,
          config.profile,
          interestVectors,
          extractorInstance,
        );

        const article: Article = {
          id: raw.id,
          title: raw.title,
          url: raw.url,
          source_name: raw.source_name,
          summary: raw.snippet,
          score,
          published_at: raw.published_at,
        };
        processedArticles.push(article);

        vectorRecords.push({
          article_id: article.id,
          date: dateStr,
          embedding: articleVector,
        });
      }
    }

    // Step 4 (DB保存)
    if (processedArticles.length > 0) {
      insertArticles(dailyDb, processedArticles);
      insertVectors(searchDb, vectorRecords);
    }
  } finally {
    // クリーンアップ: DB接続を確実にクローズ
    dailyDb.close();
    searchDb.close();
  }

  // Step 4 (R2アップロード)
  if (!skipR2) {
    console.log(`[4/4] R2 へ更新DBをアップロード中...`);
    await uploadFileToR2(dailyDbPath, `data/${dateStr}.db`, s3Client);
    await uploadFileToR2(searchDbPath, "search_index.db", s3Client);
  }

  console.log(
    `✅ パイプラインが正常に完了しました (処理: ${processedArticles.length}件, スキップ: ${skippedCount}件, 日付: ${dateStr})`,
  );

  return {
    date: dateStr,
    processedCount: processedArticles.length,
    skippedCount,
    totalFetched,
    dailyDbPath,
    searchDbPath,
    articles: processedArticles,
  };
}

// CLI エントリーポイント
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith("/src/pipeline/index.ts") ||
    process.argv[1].endsWith("/src/pipeline/index.js"));

if (isDirectExecution) {
  runPipeline().catch((err) => {
    console.error("パイプライン実行エラー:", err);
    process.exit(1);
  });
}
