/**
 * E2E 用の決定論的な擬似埋め込み。
 *
 * Workers AI はローカルでエミュレートできず、呼び出すと実アカウントへ
 * リクエストが飛んで課金対象になる。PR ごとの E2E ではこの関数で
 * ベクトルを生成し、Cloudflare へのアクセスを完全に無くしている。
 *
 * ASCII 単語と文字 bigram を固定の次元へ寄与させるため、コサイン類似度は
 * おおむね「表記の重なり具合」になる。日本語は分かち書きされないため、
 * 単語分割ではなく bigram を併用している。実モデルの精度は再現しないが、
 * 検索経路 (クエリのベクトル化 → D1 の全ベクトルとの類似度計算 → 並び替え) が
 * 端から端まで繋がっていることの検証には十分である。
 *
 * 実モデルでの精度は nightly E2E (AI バインディングのみ remote) と
 * tests/integration/model の実モデルテストで担保する。
 */
export const EMBEDDING_DIMENSIONS = 1024;

/** FNV-1a でトークンを次元インデックスへ写す */
function tokenToDimension(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % EMBEDDING_DIMENSIONS;
}

/** 記事本文・検索クエリから特徴となるトークン列を取り出す */
function extractTokens(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^\p{Letter}\p{Number}]+/u)
    .filter(Boolean);

  const tokens: string[] = [...words];

  // 日本語は空白で区切られないため、文字 bigram で部分一致を拾えるようにする
  for (const word of words) {
    for (let i = 0; i + 1 < word.length; i++) {
      tokens.push(word.slice(i, i + 2));
    }
  }

  return tokens;
}

/** 記事本文・検索クエリから L2 正規化済みの擬似ベクトルを生成する */
export function fakeEmbedding(text: string): Float32Array {
  const vector = new Float32Array(EMBEDDING_DIMENSIONS);

  for (const token of extractTokens(text)) {
    vector[tokenToDimension(token)] += 1;
  }

  let sumSquares = 0;
  for (let i = 0; i < vector.length; i++) {
    sumSquares += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sumSquares);

  if (norm === 0) {
    // 空文字でもゼロ除算にならないよう既定の次元へ単位ベクトルを置く
    vector[0] = 1;
    return vector;
  }

  for (let i = 0; i < vector.length; i++) {
    vector[i] /= norm;
  }
  return vector;
}
