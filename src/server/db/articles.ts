/**
 * Cloudflare D1 (SQLite) データベース操作・記事クエリレイヤー
 */

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
 * UTC ISO8601 日時から日本時間 (JST: UTC+9) の日付文字列 (YYYY-MM-DD) を算出する
 */
export function computePublishedDateJst(publishedAtIso: string): string {
  const date = new Date(publishedAtIso);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date string: ${publishedAtIso}`);
  }
  const jstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = jstDate.getUTCFullYear();
  const mm = String(jstDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(jstDate.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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
      published_at = excluded.published_at,
      published_date_jst = excluded.published_date_jst,
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
 * クエリベクトルとのコサイン類似度が高い上位記事を検索・ソートして取得する
 */
export async function searchArticlesByVector(
  db: D1DatabaseLike | any,
  queryVector: Float32Array,
  options?: { limit?: number; minSimilarity?: number },
): Promise<(ArticleRecord & { similarity: number })[]> {
  const limit = options?.limit ?? 30;
  const minSimilarity = options?.minSimilarity ?? 0;

  const query = `
    SELECT id, title, url, source_name, summary, score, published_at, published_date_jst, embedding, created_at
    FROM articles
    WHERE embedding IS NOT NULL
  `.trim();

  const stmt = db.prepare(query);
  const res = await stmt.all();
  const rows = (Array.isArray(res) ? res : (res.results ?? [])) as Array<
    ArticleRecord & { embedding: Uint8Array | ArrayBuffer }
  >;

  const scoredArticles: Array<ArticleRecord & { similarity: number }> = [];

  for (const row of rows) {
    if (!row.embedding) continue;
    const articleVector = deserializeVector(row.embedding);
    const similarity = cosineSimilarity(queryVector, articleVector);

    if (similarity >= minSimilarity) {
      scoredArticles.push({
        id: row.id,
        title: row.title,
        url: row.url,
        source_name: row.source_name,
        summary: row.summary,
        score: row.score,
        published_at: row.published_at,
        published_date_jst: row.published_date_jst,
        created_at: row.created_at,
        similarity,
      });
    }
  }

  scoredArticles.sort((a, b) => {
    if (b.similarity !== a.similarity) {
      return b.similarity - a.similarity;
    }
    return b.score - a.score;
  });

  return scoredArticles.slice(0, limit);
}
