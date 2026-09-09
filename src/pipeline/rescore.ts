/**
 * D1 に登録済みの全記事を再スコアリング・再ベクトル化するバックフィル。
 *
 * 通常のパイプラインは登録済み URL をスキップするため、スコア区分や埋め込みの
 * 仕様（プーリング・プレフィックス）を変えても過去記事には反映されない。
 * さらに古い記事は `maxAgeDays` の枠外にあり、フィードからは二度と取得できない。
 * 埋め込みの作り方を変えたときは、検索用ベクトルの空間を揃えるためにも
 * ここを一度通す必要がある。
 *
 *   pnpm rescore --dry-run     # D1 を更新せず、スコアの変化だけを表示する
 *   pnpm rescore               # 実際に score と embedding を更新する
 *   pnpm rescore --limit 100   # 先頭 100 件だけ処理する（動作確認用）
 */
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config";
import { precomputeInterestVectors, scoreArticleWithProfile } from "./scorer";
import { fetchAllArticlesForRescore, updateArticleScores, RescoreTarget } from "./d1-sync";

export interface RescoreOptions {
  configPath?: string;
  dryRun?: boolean;
  limit?: number;
  batchSize?: number;
  accountId?: string;
  databaseId?: string;
  apiToken?: string;
  extractorInstance?: any;
  customFetch?: typeof fetch;
}

export interface RescoreResult {
  total: number;
  updated: number;
  /** スコアが変化した件数（dry-run でも数える） */
  changed: number;
  errors?: any[];
}

export async function runRescore(options: RescoreOptions = {}): Promise<RescoreResult> {
  const configPath = options.configPath || "config/feeds.yaml";
  const dryRun = options.dryRun ?? false;
  const customFetch = options.customFetch;

  const accountId =
    options.accountId || process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
  const databaseId = options.databaseId || process.env.CLOUDFLARE_D1_DATABASE_ID;
  const apiToken = options.apiToken || process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !databaseId || !apiToken) {
    throw new Error(
      "Cloudflare D1 設定エラー: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN が必要です",
    );
  }

  const config = loadConfig(configPath);

  console.log(`\n========================================`);
  console.log(`[1/3] 📥 D1 から既存記事を取得中...`);
  console.log(`========================================`);

  let articles = await fetchAllArticlesForRescore({
    accountId,
    databaseId,
    apiToken,
    customFetch,
  });
  if (options.limit !== undefined) {
    articles = articles.slice(0, options.limit);
  }
  console.log(`  ${articles.length} 件の記事を取得しました。`);

  if (articles.length === 0) {
    return { total: 0, updated: 0, changed: 0 };
  }

  console.log(`\n========================================`);
  console.log(`[2/3] 🤖 再スコアリング & 1024次元ベクトル再生成 (${articles.length} 件)...`);
  console.log(`========================================`);
  console.log(`  ユーザー関心プロファイルベクトルを事前計算中...`);
  const interestVectors = await precomputeInterestVectors(
    config.profile.interests,
    options.extractorInstance,
  );

  const targets: RescoreTarget[] = [];
  let changed = 0;

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    const percent = Math.round(((i + 1) / articles.length) * 100);

    const { score, maxSimilarity, matchedInterest, excludedBy, articleVector } =
      await scoreArticleWithProfile(
        article.title,
        article.summary ?? "",
        config.profile,
        interestVectors,
        options.extractorInstance,
      );

    const diff = score - article.score;
    if (diff !== 0) changed++;

    const reason = excludedBy
      ? `除外: ${excludedBy}`
      : `${matchedInterest} sim=${maxSimilarity.toFixed(3)}`;
    const diffLabel = diff === 0 ? "±0" : diff > 0 ? `+${diff}` : `${diff}`;

    console.log(
      `  [${i + 1}/${articles.length} (${percent}%)] ${article.score
        .toString()
        .padStart(
          3,
          " ",
        )}点 → ${score.toString().padStart(3, " ")}点 (${diffLabel.padStart(4, " ")}) ` +
        `(${reason}) | ${article.title.slice(0, 40)}`,
    );

    targets.push({ id: article.id, score, embedding: articleVector });
  }

  if (dryRun) {
    console.log(`\n[3/3] 🔍 --dry-run のため D1 は更新していません。`);
    console.log(`\n========================================`);
    console.log(
      `✅ 再スコアリング (dry-run) 完了 (対象: ${articles.length}件, 変化: ${changed}件)`,
    );
    console.log(`========================================\n`);
    return { total: articles.length, updated: 0, changed };
  }

  console.log(`\n[3/3] ☁️ Cloudflare D1 へ ${targets.length} 件の更新を反映中...`);
  const syncResult = await updateArticleScores({
    accountId,
    databaseId,
    apiToken,
    targets,
    batchSize: options.batchSize,
    customFetch,
  });

  console.log(`  ✨ D1 更新完了: ${syncResult.updated}/${syncResult.total} 件`);
  if (syncResult.errors && syncResult.errors.length > 0) {
    console.error("  ❌ D1 更新エラー詳細:", JSON.stringify(syncResult.errors, null, 2));
  }

  console.log(`\n========================================`);
  console.log(
    `✅ 再スコアリングが完了しました (対象: ${articles.length}件, 更新: ${syncResult.updated}件, 変化: ${changed}件)`,
  );
  console.log(`========================================\n`);

  return {
    total: articles.length,
    updated: syncResult.updated,
    changed,
    ...(syncResult.errors ? { errors: syncResult.errors } : {}),
  };
}

/** CLI 引数をパースする */
export function parseRescoreArgs(argv: string[]): { dryRun: boolean; limit?: number } {
  const dryRun = argv.includes("--dry-run");
  const limitIndex = argv.indexOf("--limit");
  let limit: number | undefined;
  if (limitIndex !== -1 && argv[limitIndex + 1]) {
    const parsed = parseInt(argv[limitIndex + 1], 10);
    if (!isNaN(parsed) && parsed > 0) limit = parsed;
  }
  return { dryRun, ...(limit !== undefined ? { limit } : {}) };
}

// CLI エントリーポイント
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith("/src/pipeline/rescore.ts") ||
    process.argv[1].endsWith("/src/pipeline/rescore.js"));

if (isDirectExecution) {
  runRescore(parseRescoreArgs(process.argv.slice(2))).catch((err) => {
    console.error("再スコアリング実行エラー:", err);
    process.exit(1);
  });
}
