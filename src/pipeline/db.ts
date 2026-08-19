import Database, { Database as DatabaseType } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { Article } from "../shared/types";

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
 * 日別SQLiteデータベースを初期化し、テーブルとインデックスを作成する
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
 * 全体検索インデックスSQLiteデータベースを初期化し、テーブルとインデックスを作成する
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
 * 記事リストをトランザクション内で一括挿入または更新する
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
 * ベクトル埋め込みリストをトランザクション内で一括挿入または更新する
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
