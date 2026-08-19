# Task 11 Brief: フロントエンド React SPA UI 実装

**Files:**
- Create/Update:
  - `index.html`
  - `src/web/main.tsx`
  - `src/web/App.tsx`
  - `src/web/components/Header.tsx`
  - `src/web/components/SearchBar.tsx`
  - `src/web/components/ArticleCard.tsx`
  - `src/web/components/ArticleList.tsx`
- Test:
  - `tests/web/App.test.tsx`
  - `tests/web/components.test.tsx`

**Requirements:**
1. **UI デザイン & Tailwind CSS:**
   - モダンで洗練されたレスポンシブデザイン（ダーク/ライト調、Tailwind CSS 利用）。
   - `index.html`: `<div id="root"></div>`、適切なメタタグとタイトル「AI RSS News & Semantic Search」。
2. **コンポーネント構成:**
   - **`Header.tsx`:**
     - サイトロゴ・タイトル「AI RSS News Dashboard」、日付選択（前日・翌日・カレンダー選択）、検索モード切替。
   - **`SearchBar.tsx`:**
     - 自然言語検索クエリ入力欄、検索実行ボタン、クリアボタン、モデル読み込み・検索中スピナー。
   - **`ArticleCard.tsx`:**
     - 記事タイトル（外部リンク付き）、発信元（source_name）バッジ、公開日時。
     - **スコアバッジ:** 興味関心スコア（0〜100）に応じてカラーコーディング（80点以上: グリーン、60-79点: ブルー、40-59点: イエロー、40点未満: グレー）。
     - **3行日本語要約:** 箇条書きを整形して視認性高く表示。
     - **類似度バッジ:** ベクトル検索モード時に類似度パーセント（例: `一致度 92%`）を表示。
   - **`ArticleList.tsx`:**
     - 記事一覧のグリッド表示、ローディング中スケルトン/スピナー、エラー表示、データなし時の分かりやすい日本語メッセージ。
   - **`App.tsx`:**
     - 日別記事閲覧モードとセマンティック検索モードのステート管理。
     - `fetchDailyArticles` を呼び出した日別記事の初期表示。
     - 検索クエリ入力時に `embedQuery`（Worker）→ `searchArticlesByVector`（Wasm SQLite）を実行して結果を反映。
3. **テスト要件 (`tests/web/App.test.tsx`, `tests/web/components.test.tsx`):**
   - すべてのテストケースを **日本語** で記述。
   - コンポーネントの単体描画、スコアバッジの色分け、要約の表示検証。
   - 日付ナビゲーションと記事取得のモックテスト。
   - セマンティック検索の入力・実行・結果表示・クリアのモックテスト。
   - ローディング状態、空配列時のメッセージ表示、エラー状態の表示検証。
4. 全テストが通過し、型チェック（`tsc --noEmit`）およびビルド（`pnpm build`）がエラーなく完了すること。
5. **コマンド実行ルール:**
   - **パッケージマネージャーには必ず `pnpm` のみを使用し、`npm` や `npx` は絶対に使用しないこと。**
   - コマンドは `BypassSandbox: false`（サンドボックスモード）で実行すること。
