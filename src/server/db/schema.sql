CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  source_name TEXT NOT NULL,
  summary TEXT,
  score INTEGER NOT NULL,
  published_at TEXT NOT NULL,       -- UTC ISO8601 文字列 (例: '2026-08-19T15:30:00.000Z')
  published_date_jst TEXT NOT NULL, -- 日本時間 (JST) の日付文字列 (例: '2026-08-20')
  embedding BLOB,                   -- 1024次元 Float32Array (4096 bytes)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_articles_jst_score ON articles(published_date_jst, score DESC);
CREATE INDEX IF NOT EXISTS idx_articles_url ON articles(url);
CREATE INDEX IF NOT EXISTS idx_articles_score ON articles(score DESC);
