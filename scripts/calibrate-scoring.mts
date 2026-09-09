/**
 * 実フィード・実モデルでの「関心プロファイルとの最大コサイン類似度」の分布を測り、
 * スコア区分 (src/pipeline/scorer.ts の SIMILARITY_BANDS) が実データに対して
 * 妥当かどうかを確認するための計測スクリプト。
 *
 *   pnpm calibrate            # config/feeds.yaml の全フィード
 *   pnpm calibrate 20         # 先頭 20 フィードだけで手早く確認
 *
 * 閾値は「無関係な文どうしでも出る水準」と「実運用で到達しうる上限」の間に
 * 置く必要があるが、その水準は埋め込みモデルとコーパスに依存する。
 * 区分を動かすときは想像ではなくこの出力を根拠にすること。
 *
 * モデルのダウンロード (fp16 で約 1.1GB) を伴うため CI の既定では実行しない。
 */
import { loadConfig } from "../src/pipeline/config";
import { fetchFeedArticles } from "../src/pipeline/fetcher";
import {
  calculateScoreFromSimilarity,
  cosineSimilarity,
  precomputeInterestVectors,
  SIMILARITY_BANDS,
} from "../src/pipeline/scorer";
import { generateArticleEmbedding } from "../src/pipeline/embedder";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[index];
}

const feedLimit = process.argv[2] ? parseInt(process.argv[2], 10) : Infinity;
const config = loadConfig("config/feeds.yaml");
const feeds = config.feeds.slice(0, feedLimit);

console.log(`📡 ${feeds.length} 件のフィードを巡回します...`);
const articles = [];
for (const feed of feeds) {
  const items = await fetchFeedArticles(feed);
  articles.push(...items);
}
console.log(`  ${articles.length} 件の記事を取得しました。\n`);

console.log("🤖 関心プロファイルのベクトルを計算中...");
const interestVectors = await precomputeInterestVectors(config.profile.interests);

const rows: { similarity: number; score: number; interest: string; title: string }[] = [];
for (let i = 0; i < articles.length; i++) {
  const article = articles[i];
  const vector = await generateArticleEmbedding(article.title, article.snippet);

  let maxSimilarity = 0;
  let matched = "";
  for (const [interest, target] of interestVectors) {
    const sim = cosineSimilarity(vector, target);
    if (sim > maxSimilarity) {
      maxSimilarity = sim;
      matched = interest;
    }
  }

  rows.push({
    similarity: maxSimilarity,
    score: calculateScoreFromSimilarity(maxSimilarity, false),
    interest: matched,
    title: article.title,
  });

  if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${articles.length} 件処理...`);
}

const similarities = rows.map((r) => r.similarity).sort((a, b) => a - b);
console.log(`\n===== 最大コサイン類似度の分布 (n=${rows.length}) =====`);
for (const p of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 1]) {
  console.log(`  p${(p * 100).toFixed(0).padStart(3)}: ${percentile(similarities, p).toFixed(4)}`);
}

console.log(`\n===== 現在の区分 =====`);
console.log(`  floor=${SIMILARITY_BANDS.floor} medium=${SIMILARITY_BANDS.medium} `
  + `high=${SIMILARITY_BANDS.high} excellent=${SIMILARITY_BANDS.excellent}`);

console.log(`\n===== スコアの分布 =====`);
const buckets = [0, 20, 40, 60, 80, 100];
for (let i = 0; i < buckets.length - 1; i++) {
  const lower = buckets[i];
  const upper = buckets[i + 1];
  const count = rows.filter(
    (r) => r.score >= lower && (i === buckets.length - 2 ? r.score <= upper : r.score < upper),
  ).length;
  const percent = rows.length ? ((count / rows.length) * 100).toFixed(1) : "0.0";
  console.log(`  ${String(lower).padStart(3)}〜${String(upper).padStart(3)}点: ` +
    `${String(count).padStart(4)} 件 (${percent.padStart(5)}%)`);
}

console.log(`\n===== 上位 15 件 =====`);
for (const row of [...rows].sort((a, b) => b.score - a.score).slice(0, 15)) {
  console.log(
    `  ${String(row.score).padStart(3)}点 sim=${row.similarity.toFixed(3)} ` +
      `[${row.interest}] ${row.title.slice(0, 50)}`,
  );
}

console.log(`\n===== 下位 10 件 =====`);
for (const row of [...rows].sort((a, b) => a.score - b.score).slice(0, 10)) {
  console.log(
    `  ${String(row.score).padStart(3)}点 sim=${row.similarity.toFixed(3)} ` +
      `[${row.interest}] ${row.title.slice(0, 50)}`,
  );
}
