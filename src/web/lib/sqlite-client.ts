import initSqlJs from "sql.js";
import { Article, SearchResultItem } from "../../shared/types";

let SQL: any = null;
const dbCache = new Map<string, any>();

/**
 * 2つの正規化済み Float32Array ベクトル間のコサイン類似度（内積）を計算する
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (!a || !b || a.length !== b.length) {
    throw new Error("ベクトルの次元数が一致しません");
  }
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * sql.js (SQLite WebAssembly) のシングルトン初期化・ローダー
 */
export async function getSql(customInitSqlJs?: any): Promise<any> {
  if (SQL && !customInitSqlJs) return SQL;

  const init =
    customInitSqlJs || (typeof initSqlJs === "function" ? initSqlJs : (initSqlJs as any)?.default);
  if (typeof init === "function") {
    const config: any = {};
    if (typeof window !== "undefined") {
      config.locateFile = (file: string) =>
        `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.12.0/${file.replace("-browser", "")}`;
    }
    const instance = await init(config);
    if (!customInitSqlJs) {
      SQL = instance;
    }
    return instance;
  }

  throw new Error("sql.js の初期化関数が見つかりません");
}

/**
 * R2 の URL から SQLite DB ファイルを取得し、Wasm DB インスタンスを生成してキャッシュする
 */
export async function loadDatabaseFromUrl(
  url: string,
  customFetch?: typeof fetch,
  customSql?: any,
): Promise<any> {
  if (dbCache.has(url)) {
    return dbCache.get(url);
  }

  const fetcher = customFetch || fetch;
  const res = await fetcher(url);
  if (!res.ok) {
    throw new Error(`DBのダウンロードに失敗しました: ${res.status} ${res.statusText || ""}`.trim());
  }

  const buffer = await res.arrayBuffer();
  const sql = customSql || (await getSql());
  const db = new sql.Database(new Uint8Array(buffer));
  dbCache.set(url, db);
  return db;
}

/**
 * インメモリの DB キャッシュをクリアする
 */
export function clearDatabaseCache(): void {
  for (const db of dbCache.values()) {
    try {
      db.close();
    } catch {
      // 既に close されている場合は無視
    }
  }
  dbCache.clear();
}

/**
 * 指定日の日別記事一覧をスコア降順で取得する
 */
export async function fetchDailyArticles(
  r2BaseUrl: string,
  dateStr: string,
  customFetch?: typeof fetch,
  customSql?: any,
): Promise<Article[]> {
  const baseUrl = r2BaseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/data/${dateStr}.db`;

  let db: any;
  try {
    db = await loadDatabaseFromUrl(url, customFetch, customSql);
  } catch {
    // 404 等でDBが存在しない場合は空配列を返却
    return [];
  }

  try {
    const stmt = db.prepare(
      "SELECT id, title, url, source_name, summary, score, published_at FROM articles ORDER BY score DESC",
    );
    const articles: Article[] = [];
    while (stmt.step()) {
      articles.push(stmt.getAsObject() as Article);
    }
    stmt.free();
    return articles;
  } catch {
    return [];
  }
}

export interface SearchOptions {
  topK?: number;
  customFetch?: typeof fetch;
  customSql?: any;
}

/**
 * 全期間の search_index.db からコサイン類似度で類似記事を横断検索し、該当差分DBを結合して返却する
 */
export async function searchArticlesByVector(
  r2BaseUrl: string,
  queryVec: Float32Array,
  options?: SearchOptions,
): Promise<SearchResultItem[]> {
  const baseUrl = r2BaseUrl.replace(/\/+$/, "");
  const searchUrl = `${baseUrl}/search_index.db`;
  const topK = options?.topK ?? 20;

  let searchDb: any;
  try {
    searchDb = await loadDatabaseFromUrl(searchUrl, options?.customFetch, options?.customSql);
  } catch {
    // search_index.db が存在しない場合は空配列
    return [];
  }

  const candidates: { article_id: string; date: string; similarity: number }[] = [];
  try {
    const stmt = searchDb.prepare("SELECT article_id, date, embedding FROM search_index");
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const raw = row.embedding;
      const uint8 = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
      const vec = new Float32Array(uint8.buffer, uint8.byteOffset, uint8.byteLength / 4);
      const similarity = cosineSimilarity(queryVec, vec);
      candidates.push({
        article_id: String(row.article_id),
        date: String(row.date),
        similarity,
      });
    }
    stmt.free();
  } catch {
    return [];
  }

  if (candidates.length === 0) {
    return [];
  }

  // 類似度降順でソートし上位 K 件を抽出
  candidates.sort((a, b) => b.similarity - a.similarity);
  const topCandidates = candidates.slice(0, topK);

  // 必要な日付DBのみを並列差分ロード
  const uniqueDates = [...new Set(topCandidates.map((c) => c.date))];
  await Promise.all(
    uniqueDates.map((date) =>
      loadDatabaseFromUrl(
        `${baseUrl}/data/${date}.db`,
        options?.customFetch,
        options?.customSql,
      ).catch(() => null),
    ),
  );

  const results: SearchResultItem[] = [];
  for (const cand of topCandidates) {
    const db = dbCache.get(`${baseUrl}/data/${cand.date}.db`);
    if (!db) continue;

    try {
      const stmt = db.prepare(
        "SELECT id, title, url, source_name, summary, score, published_at FROM articles WHERE id = ?",
      );
      stmt.bind([cand.article_id]);
      if (stmt.step()) {
        const article = stmt.getAsObject() as Article;
        results.push({
          ...article,
          date: cand.date,
          similarity: cand.similarity,
        });
      }
      stmt.free();
    } catch {
      // 取得失敗した個別レコードはスキップ
    }
  }

  return results;
}
