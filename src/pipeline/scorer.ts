import { UserProfile } from "../shared/types";
import { embedText, formatArticleText, generateArticleEmbedding } from "./embedder";

/**
 * 類似度からスコアへ変換する区分の境界。
 *
 * bge-m3 の cos 類似度は 0〜1 に一様には広がらない。埋め込み空間の異方性により
 * 無関係な自然文どうしでも 0.3〜0.45 程度は出る一方、実際の検索ヒット
 * （クエリと関連文書）は概ね 0.55〜0.75 に収まり、0.85 を超えるのは
 * ほぼ言い換えに近い場合に限られる。
 *
 * 区分の下端を「無関係な文どうしでも出てしまう水準」に置き、上端を
 * 「実運用で到達しうる上限」に置くことで、0〜100 点を実際に使い切る。
 * 実コーパスでの分布は `pnpm calibrate` で確認できる。
 */
export const SIMILARITY_BANDS = {
  /** ここを超えると 85〜100 点。ほぼ言い換えに近い一致 */
  excellent: 0.75,
  /** ここを超えると 65〜85 点。明確に関心テーマの記事 */
  high: 0.65,
  /** ここを超えると 40〜65 点。関連はしているが主題ではない */
  medium: 0.55,
  /** ここを下回ると 0 点。無関係な文どうしでも出る水準 */
  floor: 0.42,
} as const;

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

  let score: number;
  if (maxSimilarity >= excellent) {
    const ratio = Math.min(1, (maxSimilarity - excellent) / (1 - excellent));
    score = 85 + 15 * ratio;
  } else if (maxSimilarity >= high) {
    const ratio = (maxSimilarity - high) / (excellent - high);
    score = 65 + 19 * ratio;
  } else if (maxSimilarity >= medium) {
    const ratio = (maxSimilarity - medium) / (high - medium);
    score = 40 + 24 * ratio;
  } else {
    const ratio = Math.max(0, (maxSimilarity - floor) / (medium - floor));
    score = 39 * ratio;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
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
