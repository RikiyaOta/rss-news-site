import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config";
import { fetchFeedArticles, RawArticle } from "./fetcher";
import { scoreArticleWithProfile, precomputeInterestVectors } from "./scorer";
import { ArticleInput, computePublishedDateJst } from "../server/db/articles";
import { syncArticlesToD1, ensureD1Schema, D1SyncResult } from "./d1-sync";
import { initLocalDatabase, upsertArticlesLocal } from "./db";

export interface PipelineOptions {
  dateStr?: string;
  configPath?: string;
  outputDir?: string;
  localDbPath?: string;
  skipD1Sync?: boolean;
  extractorInstance?: any;
  parser?: any;
  customFetch?: typeof fetch;
  accountId?: string;
  databaseId?: string;
  apiToken?: string;
}

export interface PipelineResult {
  date: string;
  processedCount: number;
  skippedCount: number;
  totalFetched: number;
  articles: ArticleInput[];
  d1SyncResult?: D1SyncResult;
  localDbPath?: string;
}

/**
 * RSS記事収集・ローカル埋め込みスコアリング・ベクトル化・Cloudflare D1 同期を行う統合パイプライン
 */
export async function runPipeline(options: PipelineOptions = {}): Promise<PipelineResult> {
  const dateStr = options.dateStr || new Date().toISOString().slice(0, 10);
  const configPath = options.configPath || "config/feeds.yaml";
  const outputDir = options.outputDir || "./data";
  const skipD1Sync = options.skipD1Sync ?? false;
  const extractorInstance = options.extractorInstance;
  const parser = options.parser;
  const customFetch = options.customFetch;

  const resolvedOutputDir = path.resolve(outputDir);
  fs.mkdirSync(resolvedOutputDir, { recursive: true });

  const localDbPath = options.localDbPath || path.join(resolvedOutputDir, "local_articles.db");

  // Step 1: 設定読み込み & RSS 巡回
  console.log(`[1/3] RSSフィードを巡回中... (${configPath})`);
  const config = loadConfig(configPath);
  const allArticles: RawArticle[] = [];

  for (const feed of config.feeds) {
    const items = await fetchFeedArticles(feed, parser);
    allArticles.push(...items);
  }

  const totalFetched = allArticles.length;
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const targetArticles: RawArticle[] = [];
  let skippedCount = 0;

  for (const raw of allArticles) {
    if (seenIds.has(raw.id) || seenUrls.has(raw.url)) {
      skippedCount++;
    } else {
      seenIds.add(raw.id);
      seenUrls.add(raw.url);
      targetArticles.push(raw);
    }
  }

  console.log(
    `処理対象記事数: ${targetArticles.length} 件 (巡回総数: ${totalFetched} 件, スキップ: ${skippedCount} 件)`,
  );

  const processedArticles: ArticleInput[] = [];

  // Step 2: 多言語埋め込みスコアリング (BGE-M3 1024次元)
  if (targetArticles.length > 0) {
    console.log(`[2/3] ユーザー関心ベクトルの事前計算中...`);
    const interestVectors = await precomputeInterestVectors(
      config.profile.interests,
      extractorInstance,
    );

    for (let i = 0; i < targetArticles.length; i++) {
      const raw = targetArticles[i];
      console.log(
        `[2/3] スコアリング & ベクトル生成中 (${i + 1}/${targetArticles.length}): ${raw.title}`,
      );

      const { score, articleVector } = await scoreArticleWithProfile(
        raw.title,
        raw.snippet,
        config.profile,
        interestVectors,
        extractorInstance,
      );

      const publishedDateJst = computePublishedDateJst(raw.published_at);

      const article: ArticleInput = {
        id: raw.id,
        title: raw.title,
        url: raw.url,
        source_name: raw.source_name,
        summary: raw.snippet,
        score,
        published_at: raw.published_at,
        published_date_jst: publishedDateJst,
        embedding: articleVector,
      };

      processedArticles.push(article);
    }
  }

  // Step 3: ローカル SQLite DB への保存 & Cloudflare D1 への同期
  if (processedArticles.length > 0) {
    if (localDbPath) {
      console.log(`[3/3] ローカル SQLite データベースを更新中... (${localDbPath})`);
      const localDb = initLocalDatabase(localDbPath);
      try {
        upsertArticlesLocal(localDb, processedArticles);
      } finally {
        localDb.close();
      }
    }
  }

  let d1SyncResult: D1SyncResult | undefined;

  const accountId =
    options.accountId || process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
  const databaseId = options.databaseId || process.env.CLOUDFLARE_D1_DATABASE_ID;
  const apiToken = options.apiToken || process.env.CLOUDFLARE_API_TOKEN;

  if (!skipD1Sync && accountId && databaseId && apiToken && processedArticles.length > 0) {
    try {
      await ensureD1Schema({ accountId, databaseId, apiToken, customFetch });
    } catch (schemaErr: any) {
      console.warn("D1 スキーマ初期化スキップまたは警告:", schemaErr?.message);
    }
    console.log(`[3/3] Cloudflare D1 (${databaseId}) へ記事を同期中...`);
    d1SyncResult = await syncArticlesToD1({
      accountId,
      databaseId,
      apiToken,
      articles: processedArticles,
      customFetch,
    });
  }

  console.log(
    `✅ パイプラインが正常に完了しました (処理: ${processedArticles.length}件, スキップ: ${skippedCount}件, 日付: ${dateStr})`,
  );

  return {
    date: dateStr,
    processedCount: processedArticles.length,
    skippedCount,
    totalFetched,
    articles: processedArticles,
    d1SyncResult,
    localDbPath,
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
