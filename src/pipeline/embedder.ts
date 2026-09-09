import { pipeline } from "@huggingface/transformers";

let extractorInstance: any = null;

/**
 * BAAI/bge-m3 の dense 表現は「[CLS] トークンの最終隠れ状態を L2 正規化したもの」と
 * 定義されている（FlagEmbedding の BGEM3FlagModel、および sentence-transformers 版の
 * Pooling 設定がいずれも CLS）。mean pooling は別モデルの流儀であり、
 * bge-m3 で使うと学習時と異なる表現を作ってしまい、類似度が全体的に潰れる。
 *
 * Cloudflare Workers AI の `@cf/baai/bge-m3`（/api/search のクエリベクトル生成）も
 * 公式実装に準拠しているため、ここを揃えないと検索側とベクトル空間が食い違う。
 */
export const POOLING_STRATEGY = "cls" as const;

/**
 * 埋め込みに使う本文の最大文字数。
 *
 * 一部のフィード（Zenn / はてな系など）は要約ではなく本文全体を配信するため、
 * 何も切らないと数 KB のテキストが 1 記事のベクトルに入る。記事全体の平均的な
 * 話題に引っ張られてタイトルの主題が薄まるため、先頭のみを対象とする。
 * 画面に表示する `summary` は切り詰めない（埋め込み入力だけの制約）。
 */
export const MAX_EMBEDDING_TEXT_CHARS = 1000;

/**
 * 記事タイトルと要約を埋め込み入力テキストに整形する。
 *
 * NOTE: bge-m3 は query / passage いずれにも指示プレフィックスを必要としない。
 * `"query: "` / `"passage: "` は multilingual-e5 系の流儀であり、bge-m3 に付けると
 * 単なるノイズになるうえ、キーワードのような短い関心テキストではプレフィックスが
 * トークン列の大半を占めてしまい、記事側との類似度を構造的に押し下げる。
 */
export function formatArticleText(title: string, summary: string): string {
  const text = `${title.trim()}\n${summary.trim()}`;
  return text.length > MAX_EMBEDDING_TEXT_CHARS ? text.slice(0, MAX_EMBEDDING_TEXT_CHARS) : text;
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
 * 任意のテキストから 1024 次元の L2 正規化済みベクトルを生成する。
 * プーリング戦略を 1 箇所に閉じ込めるため、埋め込み生成は必ずここを通す。
 */
export async function embedText(text: string, extractorInstanceParam?: any): Promise<Float32Array> {
  const extractor = extractorInstanceParam ?? (await getExtractor());
  const output = await extractor(text, { pooling: POOLING_STRATEGY, normalize: true });
  const rawData = output?.data ?? output;
  return l2Normalize(new Float32Array(rawData));
}

/**
 * 記事のタイトルと要約から 1024 次元の多言語ベクトル埋め込みを生成する
 */
export async function generateArticleEmbedding(
  title: string,
  summary: string,
  extractorInstanceParam?: any,
): Promise<Float32Array> {
  return embedText(formatArticleText(title, summary), extractorInstanceParam);
}
