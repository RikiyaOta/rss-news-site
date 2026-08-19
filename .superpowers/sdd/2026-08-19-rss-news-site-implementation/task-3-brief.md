# Task 3 Brief: RSS フィード取得・正規化モジュール

**Files:**
- Create: `src/pipeline/fetcher.ts`
- Test: `tests/pipeline/fetcher.test.ts`

**Requirements:**
1. `src/pipeline/fetcher.ts`:
   - `RawArticle` インターフェース:
     - `id: string`
     - `title: string`
     - `url: string`
     - `source_name: string`
     - `snippet: string`
     - `published_at: string` (ISO 8601)
   - `generateArticleId(url: string): string`:
     - URLの前後の空白をトリムし、SHA-256ハッシュの先頭16文字を小文字16進数で返す。
   - `normalizeFeedItem(item: any, sourceName: string): RawArticle`:
     - URLの抽出（`link` または `guid`）、空文字や空白のハンドリング
     - タイトルの正規化（デフォルト "No Title"）
     - 本文・概要（`contentSnippet`, `content`, `summary`）からHTMLタグや過剰な空白を除去
     - 公開日時のパース（`isoDate` または `pubDate` の ISO 8601 変換、無効時は現在時刻）
   - `fetchFeedArticles(source: FeedSource): Promise<RawArticle[]>`:
     - `rss-parser` を使用し、指定フィードを取得・正規化
     - User-Agent ヘッダー設定、タイムアウト設定
     - 取得失敗時はエラーログを出力して空配列 `[]` を返しパイプライン全体を落とさない
2. `tests/pipeline/fetcher.test.ts`:
   - すべてのテストケースを **日本語** で記述。
   - URLハッシュの一意性と決定論的動作の検証
   - フィードアイテムの正規化ロジックの検証（HTMLタグ除去、タイトル/日付フォールバック）
   - フィード取得エラー時の安全な空配列返却の検証
3. 全テストが通過し、型チェック（`tsc --noEmit`）でエラーがないこと。
