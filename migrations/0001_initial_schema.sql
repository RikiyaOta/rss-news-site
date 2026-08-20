-- D1 データベース初期マイグレーション: 0001_initial_schema.sql
-- 記事テーブル (articles) および各種検索・ソート用インデックスの作成

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  source_name TEXT NOT NULL,
  summary TEXT,
  score REAL NOT NULL,
  published_at TEXT NOT NULL,
  published_date_jst TEXT NOT NULL,
  embedding BLOB,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_articles_jst_score ON articles(published_date_jst, score DESC);
CREATE INDEX IF NOT EXISTS idx_articles_url ON articles(url);
CREATE INDEX IF NOT EXISTS idx_articles_score ON articles(score DESC);
