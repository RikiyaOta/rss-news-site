# Task 7 Brief: Cloudflare R2 ストレージ同期クライアント

**Files:**
- Create: `src/pipeline/storage.ts`
- Test: `tests/pipeline/storage.test.ts`

**Requirements:**
1. `src/pipeline/storage.ts`:
   - `getR2ClientConfig(env = process.env)`:
     - 環境変数 `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` を検証（未設定時は分かりやすい日本語エラーをスロー）
     - `R2_BUCKET_NAME`（デフォルト: `"rss-news-site-data"`）
     - エンドポイント `https://${accountId}.r2.cloudflarestorage.com`、`region: "auto"`、クレデンシャルを返す
   - `createR2Client(config?)`:
     - `@aws-sdk/client-s3` の `S3Client` インスタンスを生成
   - `uploadFileToR2(localPath: string, r2Key: string, customClient?: S3Client, customBucket?: string): Promise<void>`:
     - ローカルファイルを読み込み、`PutObjectCommand` で R2 にアップロード（`ContentType: "application/vnd.sqlite3"`）
   - `downloadFileFromR2(r2Key: string, localPath: string, customClient?: S3Client, customBucket?: string): Promise<boolean>`:
     - `GetObjectCommand` で R2 からダウンロードし、親ディレクトリを作成してローカルファイルに書き込み（`true` を返却）
     - オブジェクトが存在しない場合（`NoSuchKey` または HTTP 404）は例外を投げずに `false` を返却
2. `tests/pipeline/storage.test.ts`:
   - すべてのテストケースを **日本語** で記述。
   - 環境変数の検証（正常系および欠損時のエラー送出）
   - モック S3Client を用いたアップロード処理（コマンドパラメータ、ボディ）の検証
   - モック S3Client を用いたダウンロード処理（成功時のファイル保存、`NoSuchKey`/404 時の `false` 返却）の検証
3. 全テストが通過し、型チェック（`tsc --noEmit`）でエラーがないこと。
4. **コマンド実行ルール:** すべてのコマンドは `BypassSandbox: false`（サンドボックスモード）で実行すること。
