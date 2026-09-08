-- 冗長な URL インデックスの削除
--
-- articles.url には `url TEXT NOT NULL UNIQUE` により
-- SQLite が自動でユニークインデックス (sqlite_autoindex) を作成している。
-- idx_articles_url はそれと同じ列に対する完全な重複であり、
-- 検索を速くしないまま INSERT のたびに書き込み行数を 1 行増やしていた。
--
-- D1 は「インデックスへの書き込み」も rows written として課金対象に数えるため、
-- 削除することで記事 1 件あたりの書き込み行数が減る。
-- ON CONFLICT(url) の判定は UNIQUE 制約側のインデックスがそのまま担う。

DROP INDEX IF EXISTS idx_articles_url;
