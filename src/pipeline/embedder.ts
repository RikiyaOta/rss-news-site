import { pipeline } from "@huggingface/transformers";

let extractorInstance: any = null;

/**
 * BAAI/bge-m3 の仕様に従い、記事タイトルと要約を passage フォーマットに整形する
 */
export function formatPassageText(title: string, summary: string): string {
  return `passage: ${title.trim()}\n${summary.trim()}`;
}

/**
 * ベクトルの L2 ノルム（ユークリッドノルム）を計算し、単位ベクトルに正規化する
 */
export function l2Normalize(vector: Float32Array | number[]): Float32Array {
  let sumSquares = 0;
  for (let i = 0; i < vector.length; i++) {
    sumSquares += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sumSquares);
  const normalized = new Float32Array(vector.length);
  if (norm === 0) {
    return normalized;
  }
  for (let i = 0; i < vector.length; i++) {
    normalized[i] = vector[i] / norm;
  }
  return normalized;
}

/**
 * feature-extraction pipeline インスタンスを取得する（シングルトン管理、DI可能）
 *
 * NOTE: dtype は fp16 を使用する。@huggingface/transformers 4.x が同梱する
 * onnxruntime-node 1.24.3 では、fp16 の Xenova/bge-m3 を読み込む際に
 * グラフ最適化（SimplifiedLayerNormFusion とキャスト挿入の組み合わせ）が
 * 失敗してセッション初期化ごと例外になるため、@huggingface/transformers は
 * onnxruntime-node 1.21.0 を伴う 3.8.1 に固定している
 * （.github/dependabot.yml で自動更新も除外済み）。
 */
export async function getExtractor(customPipeline?: any): Promise<any> {
  if (customPipeline) {
    extractorInstance = await customPipeline("feature-extraction", "Xenova/bge-m3", {
      dtype: "fp16",
    });
    return extractorInstance;
  }

  if (!extractorInstance) {
    extractorInstance = await pipeline("feature-extraction", "Xenova/bge-m3", {
      dtype: "fp16",
    });
  }

  return extractorInstance;
}

/**
 * extractor インスタンスを直接設定する（テスト・DI用）
 */
export function setExtractor(instance: any): void {
  extractorInstance = instance;
}

/**
 * extractor インスタンスのキャッシュをリセットする（テスト用）
 */
export function resetExtractor(): void {
  extractorInstance = null;
}

/**
 * 記事のタイトルと要約から 1024 次元の多言語ベクトル埋め込みを生成する
 */
export async function generateArticleEmbedding(
  title: string,
  summary: string,
  extractorInstanceParam?: any,
): Promise<Float32Array> {
  const extractor = extractorInstanceParam ?? (await getExtractor());
  const text = formatPassageText(title, summary);
  const output = await extractor(text, { pooling: "mean", normalize: true });

  const rawData = output?.data ?? output;
  return new Float32Array(rawData);
}
