# Task 9 Brief: フロントエンド Wasm SQLite & 差分DB結合クライアント

**Files:**
- Create: `src/web/lib/r2-client.ts`
- Create: `src/web/lib/sqlite-client.ts`
- Test: `tests/web/sqlite-client.test.ts`

**Requirements:**
1. `src/web/lib/r2-client.ts`:
   - `getR2PublicBaseUrl(): string`:
     - `import.meta.env?.VITE_R2_PUBLIC_URL` または環境変数、未設定時のフォールバックURLを返却する関数。
2. `src/web/lib/sqlite-client.ts`:
   - `cosineSimilarity(a: Float32Array, b: Float32Array): number`:
     - 2つの 384次元 Float32Array の内積（L2正規化済みベクトルのコサイン類似度）を高速計算。
   - `getSql(customInitSqlJs?: any): Promise<any>`:
     - `sql.js` (SQLite WebAssembly) のシングルトン初期化・ローダー。
   - `loadDatabaseFromUrl(url: string, customFetch?: typeof fetch, customSql?: any): Promise<any>`:
     - R2 の URL から SQLite DB ファイル（ArrayBuffer）を fetch し、Wasm DB インスタンスを生成・インメモリキャッシュ（`Map<string, any>`）に保持。
   - `clearDatabaseCache(): void`:
     - テストやリフレッシュ用のキャッシュクリア関数。
   - `fetchDailyArticles(r2BaseUrl: string, dateStr: string, customFetch?: typeof fetch, customSql?: any): Promise<Article[]>`:
     - `${r2BaseUrl}/data/${dateStr}.db` をロードし、`SELECT id, title, url, source_name, summary, score, published_at FROM articles ORDER BY score DESC` を実行して記事リストを返却。
     - DBが存在しない場合（404等）は空配列 `[]` を返却。
   - `searchArticlesByVector(r2BaseUrl: string, queryVec: Float32Array, options?: { topK?: number; customFetch?: typeof fetch; customSql?: any }): Promise<SearchResultItem[]>`:
     - `${r2BaseUrl}/search_index.db` をロードし、全ベクトルの類似度を計算。
     - 類似度上位 K 件（デフォルト 20件）の `{ article_id, date, similarity }` を抽出。
     - ヒットした日付（`date`）の未キャッシュ `data/YYYY-MM-DD.db` のみを並列差分 fetch してロード。
     - 各日別DBから該当 `article_id` の記事詳細（タイトル・要約・スコア等）を取得し、クライアント側で結合（UNION）して類似度順にソートした `SearchResultItem[]` を返却。
3. `tests/web/sqlite-client.test.ts`:
   - すべてのテストケースを **日本語** で記述。
   - コサイン類似度計算の検証（同一ベクトル 1.0、直交 0.0、逆向き -1.0、次元数不一致対応）
   - `fetchDailyArticles` の日別DBロード・スコア順取得・404時空配列返却の検証
   - `searchArticlesByVector` の差分DBダウンロード、該当記事詳細の結合、類似度ソートの検証
   - キャッシュの動作と `clearDatabaseCache` の検証
4. 全テストが通過し、型チェック（`tsc --noEmit`）でエラーがないこと。
5. **コマンド実行ルール:**
   - **パッケージマネージャーには必ず `pnpm` のみを使用し、`npm` や `npx` は絶対に使用しないこと。**
   - コマンドは `BypassSandbox: false`（サンドボックスモード）で実行すること。
