# Task 8 Brief: パイプライン統合実行スクリプト

**Files:**
- Create: `src/pipeline/index.ts`
- Test: `tests/pipeline/pipeline.test.ts`

**Requirements:**
1. `src/pipeline/index.ts`:
   - `PipelineOptions` インターフェース:
     - `dateStr?: string` (デフォルト: 当日 `YYYY-MM-DD`)
     - `configPath?: string` (デフォルト: `"config/feeds.yaml"`)
     - `geminiApiKey?: string` (デフォルト: `process.env.GEMINI_API_KEY`)
     - `outputDir?: string` (デフォルト: `"./data"`)
     - `skipR2?: boolean` (デフォルト: `false`、ローカルテスト用)
     - `aiClient?: any` (DI用)
     - `extractorInstance?: any` (DI用)
     - `s3Client?: any` (DI用)
   - `runPipeline(options?: PipelineOptions): Promise<PipelineResult>`:
     - **Step 1 (DB同期):** R2から既存の `data/YYYY-MM-DD.db` と `search_index.db` をダウンロード（存在すれば同期、なければ新規作成）
     - **Step 2 (RSS巡回):** `loadConfig` で設定を読み込み、各フィードから記事を取得
     - **Step 3 (差分抽出):** `getExistingArticleIds` で既存記事を除外し、未処理記事を抽出
     - **Step 4 (AI要約・採点・ベクトル化):**
       - 各記事について `summarizeAndScoreArticle` で 3行要約 と 0-100点スコア を取得
       - `generateArticleEmbedding` で 384次元ベクトルを生成
       - **15 RPM レート制限遵守:** 記事ごとに 4.2秒 (4200ms) の `sleep` を確実に実行（最後の記事を除く）
     - **Step 5 (DB保存):** `insertArticles` および `insertVectors` で日別DBと全体検索DBに保存
     - **Step 6 (R2アップロード):** 更新された2つのSQLiteファイルを R2 にアップロード
     - **Step 7 (クリーンアップ):** DB接続をクローズし、結果オブジェクト（`processedCount`, `skippedCount`, `date` 等）を返却
   - CLI エントリーポイント: 直接スクリプトとして実行された場合に `runPipeline()` を呼び出す
2. `tests/pipeline/pipeline.test.ts`:
   - すべてのテストケースを **日本語** で記述。
   - モックを用いたパイプライン全体の統合テスト（RSS取得 → 要約・採点 → ベクトル化 → DB保存 → R2アップロード）
   - 既存記事のスキップ・差分処理の検証
   - 記事間の 4.2秒 スリープ呼び出しの検証（fakeTimersまたはモック利用）
   - APIキー未設定時のエラーハンドリング検証
3. 全テストが通過し、型チェック（`tsc --noEmit`）でエラーがないこと。
4. **コマンド実行ルール:**
   - **パッケージマネージャーには必ず `pnpm` のみを使用し、`npm` や `npx` は絶対に使用しないこと。**
   - コマンドは `BypassSandbox: false`（サンドボックスモード）で実行すること。
