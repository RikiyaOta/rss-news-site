import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Article } from "../shared/types";
import { loadConfig } from "./config";
import { fetchFeedArticles, RawArticle } from "./fetcher";
import { summarizeAndScoreArticle, sleep } from "./gemini";
import { generateArticleEmbedding } from "./embedder";
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
  geminiApiKey?: string;
  outputDir?: string;
  skipR2?: boolean;
  aiClient?: any;
  extractorInstance?: any;
  s3Client?: any;
  parser?: any;
  sleepFn?: (ms: number) => Promise<void>;
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
 * RSS記事収集・AI要約採点・ベクトル化・SQLite保存・R2同期を行う統合パイプライン
 */
export async function runPipeline(options: PipelineOptions = {}): Promise<PipelineResult> {
  const geminiApiKey = options.geminiApiKey ?? process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    throw new Error("GEMINI_API_KEY が設定されていません");
  }

  const dateStr = options.dateStr || new Date().toISOString().slice(0, 10);
  const configPath = options.configPath || "config/feeds.yaml";
  const outputDir = options.outputDir || "./data";
  const skipR2 = options.skipR2 ?? false;
  const aiClient = options.aiClient;
  const extractorInstance = options.extractorInstance;
  const s3Client = options.s3Client;
  const parser = options.parser;
  const sleepFn = options.sleepFn || sleep;

  const resolvedOutputDir = path.resolve(outputDir);
  fs.mkdirSync(resolvedOutputDir, { recursive: true });

  const dailyDbPath = path.join(resolvedOutputDir, `${dateStr}.db`);
  const searchDbPath = path.join(resolvedOutputDir, "search_index.db");

  // Step 1 (DB同期): R2から既存の data/YYYY-MM-DD.db と search_index.db を同期
  if (!skipR2) {
    console.log(`[1/5] R2 から既存DBを同期中... (${dateStr})`);
    await downloadFileFromR2(`data/${dateStr}.db`, dailyDbPath, s3Client).catch(() => false);
    await downloadFileFromR2("search_index.db", searchDbPath, s3Client).catch(() => false);
  }

  // Step 2 & 3: DB初期化、設定読み込み、RSS巡回、差分抽出
  const dailyDb = initDailyDatabase(dailyDbPath);
  const searchDb = initSearchIndexDatabase(searchDbPath);

  let processedArticles: Article[] = [];
  let skippedCount = 0;
  let totalFetched = 0;

  try {
    const existingDailyIds = getExistingArticleIds(dailyDb);
    const existingSearchIndexIds = getExistingSearchIndexIds(searchDb);

    console.log(`[2/5] RSSフィードを巡回中... (${configPath})`);
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

    // Step 4 (AI要約・採点・ベクトル化)
    const vectorRecords: SearchVectorRecord[] = [];

    for (let i = 0; i < targetArticles.length; i++) {
      const raw = targetArticles[i];
      console.log(
        `[3/5] AI要約 & スコアリング中 (${i + 1}/${targetArticles.length}): ${raw.title}`,
      );

      const { summary, score } = await summarizeAndScoreArticle(
        raw,
        config.profile,
        geminiApiKey,
        aiClient,
      );

      const article: Article = {
        id: raw.id,
        title: raw.title,
        url: raw.url,
        source_name: raw.source_name,
        summary,
        score,
        published_at: raw.published_at,
      };
      processedArticles.push(article);

      console.log(`[4/5] ベクトル生成中 (${i + 1}/${targetArticles.length}): ${raw.title}`);
      const embedding = await generateArticleEmbedding(
        article.title,
        article.summary,
        extractorInstance,
      );

      vectorRecords.push({
        article_id: article.id,
        date: dateStr,
        embedding,
      });

      // 15 RPM レート制限遵守: 記事ごとに 4.2秒 (4200ms) 待機（最後の記事を除く）
      if (i < targetArticles.length - 1) {
        await sleepFn(4200);
      }
    }

    // Step 5 (DB保存)
    if (processedArticles.length > 0) {
      insertArticles(dailyDb, processedArticles);
      insertVectors(searchDb, vectorRecords);
    }
  } finally {
    // Step 7 (クリーンアップ): DB接続を確実にクローズ
    dailyDb.close();
    searchDb.close();
  }

  // Step 6 (R2アップロード)
  if (!skipR2) {
    console.log(`[5/5] R2 へ更新DBをアップロード中...`);
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
