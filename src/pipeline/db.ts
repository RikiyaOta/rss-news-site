import Database, { Database as DatabaseType } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { Article } from "../shared/types";
import { ArticleInput, computePublishedDateJst } from "../server/db/articles";

export interface SearchVectorRecord {
  article_id: string;
  date: string;
  embedding: Float32Array;
}

/**
 * 指定されたファイルパスの親ディレクトリが存在することを確認し、なければ作成する
 */
function ensureDirectory(filePath: string): void {
  const dir = path.dirname(filePath);
  if (dir && dir !== "." && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * ローカル D1 互換 SQLite データベースを初期化し、テーブルとインデックスを作成する
 */
export function initLocalDatabase(filePath: string): DatabaseType {
  ensureDirectory(filePath);
  const db = new Database(filePath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      source_name TEXT NOT NULL,
      summary TEXT,
      score INTEGER NOT NULL,
      published_at TEXT NOT NULL,
      published_date_jst TEXT NOT NULL,
      embedding BLOB,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_articles_jst_score ON articles(published_date_jst, score DESC);
    CREATE INDEX IF NOT EXISTS idx_articles_url ON articles(url);
    CREATE INDEX IF NOT EXISTS idx_articles_score ON articles(score DESC);
  `);

  return db;
}

/**
 * ローカル SQLite データベースに記事配列を一括 upsert する
 */
export function upsertArticlesLocal(db: DatabaseType, articles: ArticleInput[]): void {
  if (articles.length === 0) {
    return;
  }

  const upsertStmt = db.prepare(`
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
  `);

  const tx = db.transaction((items: ArticleInput[]) => {
    for (const article of items) {
      const publishedDateJst =
        article.published_date_jst ?? computePublishedDateJst(article.published_at);
      const buffer = article.embedding
        ? Buffer.from(
            article.embedding.buffer,
            article.embedding.byteOffset,
            article.embedding.byteLength,
          )
        : null;

      upsertStmt.run(
        article.id,
        article.title,
        article.url,
        article.source_name,
        article.summary ?? null,
        article.score,
        article.published_at,
        publishedDateJst,
        buffer,
      );
    }
  });

  tx(articles);
}

/**
 * 日別SQLiteデータベースを初期化し、テーブルとインデックスを作成する（旧互換）
 */
export function initDailyDatabase(filePath: string): DatabaseType {
  ensureDirectory(filePath);
  const db = new Database(filePath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      source_name TEXT NOT NULL,
      summary TEXT NOT NULL,
      score INTEGER NOT NULL,
      published_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_articles_score ON articles(score DESC);
  `);

  return db;
}

/**
 * 全体検索インデックスSQLiteデータベースを初期化し、テーブルとインデックスを作成する（旧互換）
 */
export function initSearchIndexDatabase(filePath: string): DatabaseType {
  ensureDirectory(filePath);
  const db = new Database(filePath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS search_index (
      article_id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      embedding BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_search_index_date ON search_index(date);
  `);

  return db;
}

/**
 * articles テーブル内の全 article id を Set として取得する（重複巡回の除外用）
 */
export function getExistingArticleIds(db: DatabaseType): Set<string> {
  const rows = db.prepare("SELECT id FROM articles").all() as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

/**
 * search_index テーブル内の全 article_id を Set として取得する（過去全期間の重複巡回除外用）
 */
export function getExistingSearchIndexIds(db: DatabaseType): Set<string> {
  const rows = db.prepare("SELECT article_id FROM search_index").all() as Array<{
    article_id: string;
  }>;
  return new Set(rows.map((row) => row.article_id));
}

/**
 * 記事リストをトランザクション内で一括挿入または更新する（旧互換）
 */
export function insertArticles(db: DatabaseType, articles: Article[]): void {
  if (articles.length === 0) {
    return;
  }

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO articles (id, title, url, source_name, summary, score, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTransaction = db.transaction((items: Article[]) => {
    for (const article of items) {
      insertStmt.run(
        article.id,
        article.title,
        article.url,
        article.source_name,
        article.summary,
        article.score,
        article.published_at,
      );
    }
  });

  insertTransaction(articles);
}

/**
 * ベクトル埋め込みリストをトランザクション内で一括挿入または更新する（旧互換）
 * Float32Array は BLOB（Buffer）として保存される
 */
export function insertVectors(db: DatabaseType, items: SearchVectorRecord[]): void {
  if (items.length === 0) {
    return;
  }

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO search_index (article_id, date, embedding)
    VALUES (?, ?, ?)
  `);

  const insertTransaction = db.transaction((vectorItems: SearchVectorRecord[]) => {
    for (const item of vectorItems) {
      const buffer = Buffer.from(
        item.embedding.buffer,
        item.embedding.byteOffset,
        item.embedding.byteLength,
      );
      insertStmt.run(item.article_id, item.date, buffer);
    }
  });

  insertTransaction(items);
}

/**
 * articles テーブルから全記事を score 降順で取得する
 */
export function getArticlesByScore(db: DatabaseType): Article[] {
  return db
    .prepare(
      "SELECT id, title, url, source_name, summary, score, published_at FROM articles ORDER BY score DESC",
    )
    .all() as Article[];
}

/**
 * search_index テーブルから全ベクトルレコードを取得し、Float32Array に復元して返す
 */
export function getAllSearchVectors(db: DatabaseType): SearchVectorRecord[] {
  const rows = db.prepare("SELECT article_id, date, embedding FROM search_index").all() as Array<{
    article_id: string;
    date: string;
    embedding: Buffer;
  }>;

  return rows.map((row) => {
    const buf = row.embedding;
    const floatArray = new Float32Array(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    return {
      article_id: row.article_id,
      date: row.date,
      embedding: floatArray,
    };
  });
}
