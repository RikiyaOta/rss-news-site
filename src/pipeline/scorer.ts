import { UserProfile } from "../shared/types";
import { getExtractor, l2Normalize } from "./embedder";

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

  let score: number;
  if (maxSimilarity >= 0.85) {
    const ratio = Math.min(1, (maxSimilarity - 0.85) / 0.15);
    score = 85 + 15 * ratio;
  } else if (maxSimilarity >= 0.8) {
    const ratio = (maxSimilarity - 0.8) / 0.05;
    score = 65 + 19 * ratio;
  } else if (maxSimilarity >= 0.73) {
    const ratio = (maxSimilarity - 0.73) / 0.07;
    score = 40 + 24 * ratio;
  } else {
    const ratio = Math.max(0, (maxSimilarity - 0.5) / 0.23);
    score = 39 * ratio;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * ユーザー関心キーワード群の query ベクトルを事前計算する
 */
export async function precomputeInterestVectors(
  interests: string[],
  extractorParam?: any,
): Promise<Map<string, Float32Array>> {
  const extractor = extractorParam ?? (await getExtractor());
  const vectorMap = new Map<string, Float32Array>();

  for (const interest of interests) {
    if (!interest || !interest.trim()) continue;
    const text = `query: ${interest.trim()}`;
    const output = await extractor(text, { pooling: "mean", normalize: true });
    const rawData = output?.data ?? output;
    vectorMap.set(interest.trim(), l2Normalize(new Float32Array(rawData)));
  }

  return vectorMap;
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
): Promise<{ score: number; maxSimilarity: number; articleVector: Float32Array }> {
  const extractor = extractorParam ?? (await getExtractor());

  // 1. 記事ベクトルの生成
  const passageText = `passage: ${title.trim()}\n${(snippet || "").trim()}`;
  const output = await extractor(passageText, { pooling: "mean", normalize: true });
  const rawData = output?.data ?? output;
  const articleVector = l2Normalize(new Float32Array(rawData));

  // 2. 関心ベクトルの準備
  const interestVectors =
    precomputedVectors ?? (await precomputeInterestVectors(profile.interests, extractor));

  // 3. 最大コサイン類似度の算出
  let maxSimilarity = 0;
  for (const [, targetVector] of interestVectors) {
    const sim = cosineSimilarity(articleVector, targetVector);
    if (sim > maxSimilarity) {
      maxSimilarity = sim;
    }
  }

  // 4. 除外キーワードの検出
  const fullText = `${title} ${snippet}`.toLowerCase();
  const hasExclude = profile.exclude_keywords.some(
    (kw) => kw.trim() && fullText.includes(kw.trim().toLowerCase()),
  );

  // 5. スコア計算
  const score = calculateScoreFromSimilarity(maxSimilarity, hasExclude);

  return { score, maxSimilarity, articleVector };
}
