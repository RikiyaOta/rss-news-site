/**
 * Cloudflare D1 (SQLite) データベース操作・記事クエリレイヤー
 */
import { computePublishedDateJst } from "../../shared/date";

export { computePublishedDateJst };

export interface ArticleInput {
  id: string;
  title: string;
  url: string;
  source_name: string;
  summary?: string | null;
  score: number;
  published_at: string;
  published_date_jst?: string;
  embedding?: Float32Array | null;
}

export interface ArticleRecord {
  id: string;
  title: string;
  url: string;
  source_name: string;
  summary: string | null;
  score: number;
  published_at: string;
  published_date_jst: string;
  embedding?: Float32Array | null;
  created_at?: string;
}

export interface SearchResultArticle extends ArticleRecord {
  similarity: number;
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run(): Promise<{ success: boolean; meta?: Record<string, unknown> }>;
  all<T = unknown>(): Promise<{ results?: T[]; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch?(statements: D1PreparedStatementLike[]): Promise<unknown[]>;
  exec?(query: string): Promise<unknown>;
  [key: string]: unknown;
}

/**
 * Float32Array ベクトルを BLOB 保存用の Uint8Array バイト列に変換する
 */
export function serializeVector(vec: Float32Array): Uint8Array {
  return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
}

/**
 * BLOB バイト列 (Uint8Array / ArrayBuffer) を Float32Array ベクトルに復元する
 */
export function deserializeVector(
  blob: Uint8Array | ArrayBuffer | ArrayLike<number>,
): Float32Array {
  if (blob instanceof Float32Array) {
    return blob;
  }
  if (blob instanceof ArrayBuffer) {
    return new Float32Array(blob);
  }
  if (ArrayBuffer.isView(blob)) {
    const buffer = blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength);
    return new Float32Array(buffer);
  }
  if (Array.isArray(blob)) {
    const u8 = new Uint8Array(blob);
    return new Float32Array(u8.buffer);
  }
  throw new Error("Invalid blob type for deserializeVector");
}

/**
 * 2つの Float32Array ベクトル間のコサイン類似度を計算する
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimensions do not match: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * 記事配列を D1 データベースに一括 upsert (挿入または URL 重複時更新) する
 */
export async function upsertArticles(
  db: D1DatabaseLike | any,
  articles: ArticleInput[],
): Promise<number> {
  if (!articles || articles.length === 0) {
    return 0;
  }

  const query = `
    INSERT INTO articles (
      id, title, url, source_name, summary, score, published_at, published_date_jst, embedding
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET
      title = excluded.title,
      source_name = excluded.source_name,
      summary = excluded.summary,
      score = excluded.score,
      -- 公開日時は再巡回で後ろへ動かさない（より古い＝実際の公開日時を正とする）
      published_at = MIN(excluded.published_at, articles.published_at),
      published_date_jst = MIN(excluded.published_date_jst, articles.published_date_jst),
      embedding = COALESCE(excluded.embedding, articles.embedding);
  `.trim();

  const statements = articles.map((article) => {
    const publishedDateJst =
      article.published_date_jst ?? computePublishedDateJst(article.published_at);
    const serializedVec = article.embedding ? serializeVector(article.embedding) : null;
    return db
      .prepare(query)
      .bind(
        article.id,
        article.title,
        article.url,
        article.source_name,
        article.summary ?? null,
        article.score,
        article.published_at,
        publishedDateJst,
        serializedVec,
      );
  });

  if (typeof db.batch === "function") {
    await db.batch(statements);
  } else {
    for (const stmt of statements) {
      await stmt.run();
    }
  }

  return articles.length;
}

/**
 * 指定した JST 公開日 (YYYY-MM-DD) の記事をスコア降順で取得する
 */
export async function getArticlesByPublishedDate(
  db: D1DatabaseLike | any,
  dateJst: string,
  options?: { limit?: number; offset?: number },
): Promise<ArticleRecord[]> {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const query = `
    SELECT id, title, url, source_name, summary, score, published_at, published_date_jst, created_at
    FROM articles
    WHERE published_date_jst = ?
    ORDER BY score DESC
    LIMIT ? OFFSET ?
  `.trim();

  const stmt = db.prepare(query).bind(dateJst, limit, offset);
  const res = await stmt.all();
  const rawResults = Array.isArray(res) ? res : (res.results ?? []);
  return rawResults as ArticleRecord[];
}

/**
 * 指定した JST 公開日 (YYYY-MM-DD) の記事の総件数を取得する。
 * ページネーションの有無に関わらず、その日の全件数を返す。
 */
export async function countArticlesByPublishedDate(
  db: D1DatabaseLike | any,
  dateJst: string,
): Promise<number> {
  const query = `
    SELECT COUNT(*) AS total
    FROM articles
    WHERE published_date_jst = ?
  `.trim();

  const total = await db.prepare(query).bind(dateJst).first("total");
  const parsed = Number(total ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 事前計算したクエリベクトルのノルムを使ってコサイン類似度を求める。
 *
 * 検索では 1 本のクエリベクトルを全記事と突き合わせるため、
 * クエリ側のノルムを記事ごとに計算し直すのは無駄になる。
 * 1024 次元 × 記事数ぶんの乗算をまるごと省くために切り出している。
 */
function cosineSimilarityWithQueryNorm(
  query: Float32Array,
  target: Float32Array,
  queryNorm: number,
): number {
  if (query.length !== target.length) {
    throw new Error(`Vector dimensions do not match: ${query.length} vs ${target.length}`);
  }
  let dot = 0;
  let targetNormSquares = 0;
  for (let i = 0; i < query.length; i++) {
    dot += query[i] * target[i];
    targetNormSquares += target[i] * target[i];
  }
  const denom = queryNorm * Math.sqrt(targetNormSquares);
  if (denom === 0) return 0;
  return dot / denom;
}

/** ベクトルの L2 ノルム */
function l2Norm(vector: Float32Array): number {
  let sumSquares = 0;
  for (let i = 0; i < vector.length; i++) {
    sumSquares += vector[i] * vector[i];
  }
  return Math.sqrt(sumSquares);
}

/** 上位 K 件の並び順を決める比較。類似度降順、同値ならスコア降順 */
function isBetterCandidate(
  similarity: number,
  score: number,
  otherSimilarity: number,
  otherScore: number,
): boolean {
  if (similarity !== otherSimilarity) return similarity > otherSimilarity;
  return score > otherScore;
}

/**
 * クエリベクトルとのコサイン類似度が高い上位記事を検索・ソートして取得する。
 *
 * 全記事のベクトルを走査する必要がある一方で、返すのは上位 limit 件だけなので、
 * 走査中に保持するのは上位 limit 件のみとし、記事オブジェクトの生成も
 * 最終的に返す分だけに絞っている（全件を配列に積んでから sort しない）。
 */
export async function searchArticlesByVector(
  db: D1DatabaseLike | any,
  queryVector: Float32Array,
  options?: { limit?: number; minSimilarity?: number },
): Promise<(ArticleRecord & { similarity: number })[]> {
  const limit = options?.limit ?? 30;
  const minSimilarity = options?.minSimilarity ?? 0;

  if (limit <= 0) return [];

  // created_at は API レスポンスでも画面でも使わないため取得しない
  const query = `
    SELECT id, title, url, source_name, summary, score, published_at, published_date_jst, embedding
    FROM articles
    WHERE embedding IS NOT NULL
  `.trim();

  const stmt = db.prepare(query);
  const res = await stmt.all();
  const rows = (Array.isArray(res) ? res : (res.results ?? [])) as Array<
    ArticleRecord & { embedding: Uint8Array | ArrayBuffer }
  >;

  const queryNorm = l2Norm(queryVector);

  // 上位 limit 件だけを類似度降順で保持する（要素数は limit を超えない）
  const top: Array<{ row: (typeof rows)[number]; similarity: number }> = [];

  for (const row of rows) {
    if (!row.embedding) continue;

    const similarity = cosineSimilarityWithQueryNorm(
      queryVector,
      deserializeVector(row.embedding),
      queryNorm,
    );
    if (similarity < minSimilarity) continue;

    // 既に limit 件あり、最下位にも及ばないなら捨てる
    const worst = top.length === limit ? top[top.length - 1] : undefined;
    if (worst && !isBetterCandidate(similarity, row.score, worst.similarity, worst.row.score)) {
      continue;
    }

    let insertAt = top.length;
    while (
      insertAt > 0 &&
      isBetterCandidate(
        similarity,
        row.score,
        top[insertAt - 1].similarity,
        top[insertAt - 1].row.score,
      )
    ) {
      insertAt--;
    }
    top.splice(insertAt, 0, { row, similarity });
    if (top.length > limit) top.pop();
  }

  return top.map(({ row, similarity }) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    source_name: row.source_name,
    summary: row.summary,
    score: row.score,
    published_at: row.published_at,
    published_date_jst: row.published_date_jst,
    similarity,
  }));
}
