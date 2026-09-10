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
  /** dry-run では D1 を更新しないため、updated < total でも失敗ではない */
  dryRun: boolean;
  errors?: any[];
}

/** 分布サマリーの入力となる 1 記事分の計測値 */
export interface RescoreSample {
  oldScore: number;
  newScore: number;
  similarity: number;
  excluded: boolean;
}

/** スコア分布のバケット境界（下端は含む、上端は含まない。最上位のみ 100 を含む） */
const SCORE_BUCKETS = [0, 20, 40, 60, 80, 100] as const;

export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return NaN;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.round((sortedValues.length - 1) * p)),
  );
  return sortedValues[index];
}

/**
 * 再スコアリング結果の分布を組み立てる。
 *
 * 1 記事ずつのログだけでは、区分が実データと噛み合っているかを
 * 判断できない（実際に噛み合っていない状態を数千行のログから
 * 目視で見つける羽目になった）。類似度の分位点と新旧のスコア分布を
 * 必ず最後に出す。
 */
export function buildDistributionSummary(samples: RescoreSample[]): string[] {
  if (samples.length === 0) return [];

  const lines: string[] = [];
  const similarities = samples.map((s) => s.similarity).sort((a, b) => a - b);

  lines.push(`\n===== 最大コサイン類似度の分布 (n=${samples.length}) =====`);
  for (const p of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 1]) {
    const label = `p${(p * 100).toFixed(0)}`.padStart(4, " ");
    lines.push(`  ${label}: ${percentile(similarities, p).toFixed(4)}`);
  }

  lines.push(`\n===== スコア分布 (旧 → 新) =====`);
  for (let i = 0; i < SCORE_BUCKETS.length - 1; i++) {
    const lower = SCORE_BUCKETS[i];
    const upper = SCORE_BUCKETS[i + 1];
    const isTop = i === SCORE_BUCKETS.length - 2;
    const inBucket = (score: number) => score >= lower && (isTop ? score <= upper : score < upper);

    const oldCount = samples.filter((s) => inBucket(s.oldScore)).length;
    const newCount = samples.filter((s) => inBucket(s.newScore)).length;
    const percent = ((newCount / samples.length) * 100).toFixed(1);

    lines.push(
      `  ${String(lower).padStart(3, " ")}〜${String(upper).padStart(3, " ")}点: ` +
        `${String(oldCount).padStart(5, " ")} 件 → ${String(newCount).padStart(5, " ")} 件 ` +
        `(${percent.padStart(5, " ")}%)`,
    );
  }

  const excludedCount = samples.filter((s) => s.excluded).length;
  const maxScore = Math.max(...samples.map((s) => s.newScore));
  lines.push(`\n  除外キーワードで減点された記事: ${excludedCount} 件`);
  lines.push(`  新スコアの最高点: ${maxScore} 点`);

  // 上位の区分に 1 件も届かないなら、区分が実分布より高すぎるということ。
  if (maxScore < 60) {
    lines.push(
      `  ⚠️ 最高点が 60 点未満です。SIMILARITY_BANDS が実際の類似度分布より高すぎる可能性があります。`,
    );
  }

  return lines;
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
    return { total: 0, updated: 0, changed: 0, dryRun };
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
  const samples: RescoreSample[] = [];
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
    samples.push({
      oldScore: article.score,
      newScore: score,
      similarity: maxSimilarity,
      excluded: excludedBy !== null,
    });
  }

  for (const line of buildDistributionSummary(samples)) {
    console.log(line);
  }

  if (dryRun) {
    console.log(`\n[3/3] 🔍 --dry-run のため D1 は更新していません。`);
    console.log(`\n========================================`);
    console.log(
      `✅ 再スコアリング (dry-run) 完了 (対象: ${articles.length}件, 変化: ${changed}件)`,
    );
    console.log(`========================================\n`);
    return { total: articles.length, updated: 0, changed, dryRun };
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
    // 同じエラーが全バッチ分並ぶと原因が埋もれるので、種類ごとにまとめる。
    const byMessage = new Map<string, number>();
    for (const error of syncResult.errors) {
      const message = error?.message ? String(error.message) : JSON.stringify(error);
      byMessage.set(message, (byMessage.get(message) ?? 0) + 1);
    }
    console.error(`  ❌ D1 更新エラー (${syncResult.errors.length} 件):`);
    for (const [message, count] of byMessage) {
      console.error(`     ${count} 回: ${message}`);
    }
  }

  const failed = syncResult.total - syncResult.updated;

  console.log(`\n========================================`);
  if (failed > 0) {
    // 書き込めていないのに成功として終わると、反映されたつもりで放置される。
    // 実際に「全バッチ失敗・更新 1 件」で緑のまま完了した事故があったので、
    // 未更新が 1 件でもあれば失敗として扱う。
    console.error(
      `❌ 再スコアリングは完了しましたが ${failed} 件を D1 へ反映できませんでした ` +
        `(対象: ${articles.length}件, 更新: ${syncResult.updated}件)`,
    );
  } else {
    console.log(
      `✅ 再スコアリングが完了しました (対象: ${articles.length}件, 更新: ${syncResult.updated}件, 変化: ${changed}件)`,
    );
  }
  console.log(`========================================\n`);

  return {
    total: articles.length,
    updated: syncResult.updated,
    changed,
    dryRun,
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
  runRescore(parseRescoreArgs(process.argv.slice(2)))
    .then((result) => {
      // 未反映が残ったまま緑で終わらせない (CI が成功扱いにすると気づけない)。
      if (result.updated < result.total && !result.dryRun) {
        process.exitCode = 1;
      }
    })
    .catch((err) => {
      console.error("再スコアリング実行エラー:", err);
      process.exit(1);
    });
}
