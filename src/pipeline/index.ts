import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config";
import { fetchFeedArticles, RawArticle } from "./fetcher";
import { scoreArticleWithProfile, precomputeInterestVectors } from "./scorer";
import { ArticleInput, computePublishedDateJst } from "../server/db/articles";
import { syncArticlesToD1, ensureD1Schema, fetchExistingUrlsFromD1, D1SyncResult } from "./d1-sync";
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
  maxAgeDays?: number; // default: 3
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
  const maxAgeDays = options.maxAgeDays ?? 3;

  const resolvedOutputDir = path.resolve(outputDir);
  fs.mkdirSync(resolvedOutputDir, { recursive: true });

  const localDbPath = options.localDbPath || path.join(resolvedOutputDir, "local_articles.db");

  // Step 1: 設定読み込み & RSS 巡回
  console.log(`\n========================================`);
  console.log(`[1/3] 📡 RSS フィード巡回中... (直近 ${maxAgeDays} 日間)`);
  console.log(`========================================`);
  const config = loadConfig(configPath);
  const allArticles: RawArticle[] = [];

  for (let i = 0; i < config.feeds.length; i++) {
    const feed = config.feeds[i];
    const items = await fetchFeedArticles(feed, parser, customFetch, maxAgeDays);
    console.log(
      `  [${i + 1}/${config.feeds.length}] 📰 ${feed.name}: ${items.length} 件取得 (URL: ${feed.url})`,
    );
    allArticles.push(...items);
  }

  const totalFetched = allArticles.length;
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const candidateArticles: RawArticle[] = [];
  let deduplicatedCount = 0;

  for (const raw of allArticles) {
    if (seenIds.has(raw.id) || seenUrls.has(raw.url)) {
      deduplicatedCount++;
    } else {
      seenIds.add(raw.id);
      seenUrls.add(raw.url);
      candidateArticles.push(raw);
    }
  }

  // D1 から既存登録済み URL を取得して重複計算をスキップ
  const accountId =
    options.accountId || process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
  const databaseId = options.databaseId || process.env.CLOUDFLARE_D1_DATABASE_ID;
  const apiToken = options.apiToken || process.env.CLOUDFLARE_API_TOKEN;

  let existingD1Urls = new Set<string>();
  if (!skipD1Sync && accountId && databaseId && apiToken) {
    try {
      // 直近 maxAgeDays 日以降の登録済み URL を確認
      const sinceDate = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      existingD1Urls = await fetchExistingUrlsFromD1({
        accountId,
        databaseId,
        apiToken,
        sinceDateJst: sinceDate,
        customFetch,
      });
      if (existingD1Urls.size > 0) {
        console.log(`  🔍 D1 内に既存の登録済み記事を ${existingD1Urls.size} 件検出しました。`);
      }
    } catch {
      // 照合エラー時は全件スコアリングにフォールバック
    }
  }

  const targetArticles: RawArticle[] = [];
  let alreadyScoredCount = 0;

  for (const raw of candidateArticles) {
    if (existingD1Urls.has(raw.url)) {
      alreadyScoredCount++;
    } else {
      targetArticles.push(raw);
    }
  }

  const totalSkipped = deduplicatedCount + alreadyScoredCount;

  console.log(`\n📊 記事収集結果サマリー:`);
  console.log(`  ・巡回総件数: ${totalFetched} 件`);
  console.log(
    `  ・スキップ件数: ${totalSkipped} 件 (重複: ${deduplicatedCount}件, 既存登録済み: ${alreadyScoredCount}件)`,
  );
  console.log(`  ・新規スコアリング対象: ${targetArticles.length} 件\n`);

  const processedArticles: ArticleInput[] = [];

  // Step 2: 多言語埋め込みスコアリング (Xenova/bge-m3 1024次元)
  if (targetArticles.length > 0) {
    console.log(`========================================`);
    console.log(
      `[2/3] 🤖 AI スコアリング & 1024次元ベクトル生成中 (${targetArticles.length} 件)...`,
    );
    console.log(`========================================`);
    console.log(`  ユーザー関心プロファイルベクトルを事前計算中...`);
    const interestVectors = await precomputeInterestVectors(
      config.profile.interests,
      extractorInstance,
    );

    for (let i = 0; i < targetArticles.length; i++) {
      const raw = targetArticles[i];
      const percent = Math.round(((i + 1) / targetArticles.length) * 100);

      const { score, articleVector } = await scoreArticleWithProfile(
        raw.title,
        raw.snippet,
        config.profile,
        interestVectors,
        extractorInstance,
      );

      const publishedDateJst = computePublishedDateJst(raw.published_at);

      console.log(
        `  [AI ${i + 1}/${targetArticles.length} (${percent}%)] スコア: ${score.toString().padStart(3, " ")}点 | [${raw.source_name}] ${raw.title.slice(0, 40)}`,
      );

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
  } else {
    console.log(`[2/3] 🤖 新規記事がないため、AI スコアリングはスキップされました。`);
  }

  // Step 3: ローカル SQLite DB への保存 & Cloudflare D1 への同期
  if (processedArticles.length > 0) {
    if (localDbPath) {
      console.log(`\n[3/3] 💾 ローカル SQLite データベースを更新中... (${localDbPath})`);
      const localDb = initLocalDatabase(localDbPath);
      try {
        upsertArticlesLocal(localDb, processedArticles);
      } finally {
        localDb.close();
      }
    }
  }

  let d1SyncResult: D1SyncResult | undefined;

  if (!skipD1Sync && accountId && databaseId && apiToken && processedArticles.length > 0) {
    console.log(
      `\n[3/3] ☁️ Cloudflare D1 (${databaseId}) へ ${processedArticles.length} 件の記事を同期中...`,
    );
    try {
      await ensureD1Schema({ accountId, databaseId, apiToken, customFetch });
    } catch (schemaErr: any) {
      console.warn("  (D1 スキーマ初期化スキップまたは警告):", schemaErr?.message);
    }

    d1SyncResult = await syncArticlesToD1({
      accountId,
      databaseId,
      apiToken,
      articles: processedArticles,
      customFetch,
    });

    console.log(`  ✨ D1 同期完了: ${d1SyncResult.inserted}/${d1SyncResult.total} 件 挿入・更新`);
    if (d1SyncResult.errors && d1SyncResult.errors.length > 0) {
      console.error("  ❌ D1 同期エラー詳細:", JSON.stringify(d1SyncResult.errors, null, 2));
    }
  }

  console.log(`\n========================================`);
  console.log(
    `✅ パイプラインが正常に完了しました (処理: ${processedArticles.length}件, スキップ: ${totalSkipped}件, 日付: ${dateStr})`,
  );
  console.log(`========================================\n`);

  return {
    date: dateStr,
    processedCount: processedArticles.length,
    skippedCount: totalSkipped,
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
