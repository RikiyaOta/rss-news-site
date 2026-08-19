# Task 6 Brief: SQLite 日別DB & 全体検索インデックスDB 生成モジュール

**Files:**
- Create: `src/pipeline/db.ts`
- Test: `tests/pipeline/db.test.ts`

**Requirements:**
1. `src/pipeline/db.ts`:
   - `initDailyDatabase(filePath: string): Database.Database`:
     - `better-sqlite3` を使用して指定パスのSQLite DBをオープン/作成
     - テーブル `articles` を作成:
       ```sql
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
       ```
   - `initSearchIndexDatabase(filePath: string): Database.Database`:
     - テーブル `search_index` を作成:
       ```sql
       CREATE TABLE IF NOT EXISTS search_index (
         article_id TEXT PRIMARY KEY,
         date TEXT NOT NULL,
         embedding BLOB NOT NULL
       );
       CREATE INDEX IF NOT EXISTS idx_search_index_date ON search_index(date);
       ```
   - `getExistingArticleIds(db: Database.Database): Set<string>`:
     - `articles` テーブル内の全 `id` を `Set<string>` として取得（重複巡回の除外用）
   - `insertArticles(db: Database.Database, articles: Article[]): void`:
     - トランザクション内で `INSERT OR REPLACE INTO articles` を実行
   - `insertVectors(db: Database.Database, items: { article_id: string; date: string; embedding: Float32Array }[]): void`:
     - トランザクション内で `INSERT OR REPLACE INTO search_index` を実行し、`Float32Array` を `Buffer.from(embedding.buffer)` としてBLOB保存
   - `getArticlesByScore(db: Database.Database): Article[]`:
     - `SELECT * FROM articles ORDER BY score DESC` で記事一覧を取得
   - `getAllSearchVectors(db: Database.Database): { article_id: string; date: string; embedding: Float32Array }[]`:
     - `SELECT article_id, date, embedding FROM search_index` で全ベクトルを取得し `Float32Array` に復元
2. `tests/pipeline/db.test.ts`:
   - すべてのテストケースを **日本語** で記述。
   - 日別DBの初期化・インデックス作成・記事挿入・スコア順取得・IDセット取得の検証
   - 全体検索DBの初期化・ベクトルBLOB挿入・384次元 Float32Array の完全復元検証
   - トランザクションによる一括更新および空配列入力時の安全動作検証
3. 全テストが通過し、型チェック（`tsc --noEmit`）でエラーがないこと。
4. **コマンド実行ルール:** すべてのコマンドは `BypassSandbox: false`（サンドボックスモード）で実行すること。
