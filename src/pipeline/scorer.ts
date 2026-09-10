import { UserProfile } from "../shared/types";
import { MAX_SCORE, SCORE_BAND_MIN } from "../shared/score-bands";
import { embedText, formatArticleText, generateArticleEmbedding } from "./embedder";

/**
 * 類似度からスコアへ変換する区分の境界。
 *
 * bge-m3 の cos 類似度は 0〜1 に一様には広がらない。埋め込み空間の異方性により
 * 無関係な自然文どうしでも 0.3 台は出る一方、上側も 1.0 には伸びない。
 * とくに本プロジェクトのように「単語に近い短い関心テキスト」と
 * 「タイトル＋要約」を突き合わせる非対称な構成では、上限がかなり低くなる。
 *
 * 以下の値は実際の記事 2237 件を再スコアリングして得た分布に基づく
 * （dry-run のログを実測。汎用的なベンチマークの数字ではない）。
 *
 *   完全に無関係 (Belgian car salesman / Iceland votes)   0.32〜0.40
 *   平均的な記事                                          0.42〜0.48
 *   明確に関心テーマ (TanStack + Hono + Cloudflare)        0.50〜0.53
 *   最上位 (Rust に移植された Bun 1.4 ↔ "Rust")            0.55〜0.56
 *
 * 区分を実分布より高く置くと上位の区分が到達不能になり、全記事が
 * 下の帯に潰れる。関心テキストの書き方やモデルを変えると分布ごと動くため、
 * 変更したら必ず `pnpm rescore --dry-run` の分布サマリーを見て置き直すこと。
 */
export const SIMILARITY_BANDS = {
  /** ここを超えると最上位区分。実測の上限を超える例外的な一致 */
  excellent: 0.6,
  /** ここを超えると上位区分。明確に関心テーマの記事 */
  high: 0.53,
  /** ここを超えると中位区分。関連はしているが主題ではない */
  medium: 0.46,
  /** ここを下回ると 0 点。無関係な記事でも出る水準 */
  floor: 0.38,
} as const;

/**
 * 区分の上端。1 つ上の区分の下端に触れないよう 1 点下に置く。
 *
 * これにより、上の区分の閾値をわずかに下回った類似度は必ず
 * 下の区分の点数に収まる（例: 類似度 0.5999 → 84 点）。
 */
function bandTop(upperBandMinScore: number): number {
  return upperBandMinScore - 1;
}

/**
 * コサイン類似度（内積）を計算する
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * コサイン類似度と除外キーワード有無から 0〜100 点のスコアを算出する
 */
export function calculateScoreFromSimilarity(
  maxSimilarity: number,
  hasExcludeKeyword: boolean,
): number {
  if (hasExcludeKeyword) {
    return Math.min(10, Math.max(0, Math.round(maxSimilarity * 10)));
  }

  const { excellent, high, medium, floor } = SIMILARITY_BANDS;

  // 点数の切り方は表示側 (記事カードのバッジ) と共有する。
  // ここで独自の数値を書くと、同じ記事が「生成された区分」と
  // 「表示される区分」で食い違う。
  let score: number;
  if (maxSimilarity >= excellent) {
    const ratio = Math.min(1, (maxSimilarity - excellent) / (1 - excellent));
    score = SCORE_BAND_MIN.excellent + (MAX_SCORE - SCORE_BAND_MIN.excellent) * ratio;
  } else if (maxSimilarity >= high) {
    const ratio = (maxSimilarity - high) / (excellent - high);
    score = SCORE_BAND_MIN.high + (bandTop(SCORE_BAND_MIN.excellent) - SCORE_BAND_MIN.high) * ratio;
  } else if (maxSimilarity >= medium) {
    const ratio = (maxSimilarity - medium) / (high - medium);
    score = SCORE_BAND_MIN.medium + (bandTop(SCORE_BAND_MIN.high) - SCORE_BAND_MIN.medium) * ratio;
  } else {
    const ratio = Math.max(0, (maxSimilarity - floor) / (medium - floor));
    score = SCORE_BAND_MIN.low + (bandTop(SCORE_BAND_MIN.medium) - SCORE_BAND_MIN.low) * ratio;
  }

  return Math.max(0, Math.min(MAX_SCORE, Math.round(score)));
}

/**
 * ユーザー関心キーワード群のベクトルを事前計算する
 */
export async function precomputeInterestVectors(
  interests: string[],
  extractorParam?: any,
): Promise<Map<string, Float32Array>> {
  const vectorMap = new Map<string, Float32Array>();

  for (const interest of interests) {
    if (!interest || !interest.trim()) continue;
    const text = interest.trim();
    vectorMap.set(text, await embedText(text, extractorParam));
  }

  return vectorMap;
}

export interface ArticleScore {
  score: number;
  maxSimilarity: number;
  /** 最も類似度が高かった関心キーワード（スコアの根拠を追えるようにする） */
  matchedInterest: string;
  /** スコアを 10 点以下に抑え込んだ除外キーワード。該当なしの場合は null */
  excludedBy: string | null;
  articleVector: Float32Array;
}

/**
 * 記事のテキスト（タイトル＋抜粋）とユーザープロファイルを照合してスコアリングを行う
 */
export async function scoreArticleWithProfile(
  title: string,
  snippet: string,
  profile: UserProfile,
  precomputedVectors?: Map<string, Float32Array>,
  extractorParam?: any,
): Promise<ArticleScore> {
  // 1. 記事ベクトルの生成
  const articleVector = await generateArticleEmbedding(title, snippet, extractorParam);

  // 2. 関心ベクトルの準備
  const interestVectors =
    precomputedVectors ?? (await precomputeInterestVectors(profile.interests, extractorParam));

  // 3. 最大コサイン類似度の算出
  let maxSimilarity = 0;
  let matchedInterest = "";
  for (const [interest, targetVector] of interestVectors) {
    const sim = cosineSimilarity(articleVector, targetVector);
    if (sim > maxSimilarity) {
      maxSimilarity = sim;
      matchedInterest = interest;
    }
  }

  // 4. 除外キーワードの検出
  //
  // 照合対象は埋め込みに使うテキストと同じもの（タイトル＋要約の先頭 1000 文字）に
  // 揃える。本文全体を配信するフィードでは snippet が記事まるごとになるため、
  // 制限しないと本文のどこかに 1 度出ただけの語で記事が 10 点以下に潰れてしまう。
  const matchTarget = formatArticleText(title, snippet).toLowerCase();
  const excludedBy =
    profile.exclude_keywords.find(
      (kw) => kw.trim() && matchTarget.includes(kw.trim().toLowerCase()),
    ) ?? null;

  // 5. スコア計算
  const score = calculateScoreFromSimilarity(maxSimilarity, excludedBy !== null);

  return { score, maxSimilarity, matchedInterest, excludedBy, articleVector };
}
