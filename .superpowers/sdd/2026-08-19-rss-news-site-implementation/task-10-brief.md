# Task 10 Brief: ブラウザ内クエリベクトル化 Web Worker & クライアントブリッジ

**Files:**
- Create: `src/web/workers/embedder.worker.ts`
- Create: `src/web/lib/browser-embedder.ts`
- Test: `tests/web/browser-embedder.test.ts`

**Requirements:**
1. `src/web/workers/embedder.worker.ts`:
   - `intfloat/multilingual-e5-small` をブラウザ内のバックグラウンドスレッド（Web Worker）で実行。
   - メッセージ形式: `{ id: number, query: string }`
   - 入力クエリに `"query: "` プレフィックスを付与し、`pipeline("feature-extraction", "intfloat/multilingual-e5-small", { dtype: "q8" })` で 384次元ベクトルを抽出。
   - 完了時に `{ id: number, vector: number[] }`、失敗時に `{ id: number, error: string }` を `self.postMessage` で返信。
2. `src/web/lib/browser-embedder.ts`:
   - `formatQueryText(query: string): string`:
     - `intfloat/multilingual-e5-small` の検索クエリ仕様に従い、`"query: " + query.trim()` を生成。
   - `getEmbedderWorker(workerFactory?: () => Worker): Worker`:
     - Web Worker のシングルトン初期化・管理（DIファクトリ対応）。
   - `embedQuery(query: string, options?: { worker?: Worker; timeoutMs?: number }): Promise<Float32Array>`:
     - Worker にメッセージを送信し、対応する `id` のレスポンスを Promise で待機して `Float32Array`（384次元）を返却。
     - エラー時またはタイムアウト時の安全な Reject ハンドリング。
   - `terminateEmbedderWorker(): void`:
     - Worker インスタンスを破棄・リセットするクリーンアップ関数。
3. `tests/web/browser-embedder.test.ts`:
   - すべてのテストケースを **日本語** で記述。
   - `formatQueryText` のプレフィックス付与およびトリム処理の検証
   - モック Worker を用いた `embedQuery` の正常系レスポンス（Float32Array 変換）検証
   - メッセージ ID による非同期レスポンスの正しい識別検証
   - Worker からのエラー返却時の例外検証
   - タイムアウト発生時のハンドリング検証
   - `terminateEmbedderWorker` による Worker 破棄と再生成の検証
4. 全テストが通過し、型チェック（`tsc --noEmit`）でエラーがないこと。
5. **コマンド実行ルール:**
   - **パッケージマネージャーには必ず `pnpm` のみを使用し、`npm` や `npx` は絶対に使用しないこと。**
   - コマンドは `BypassSandbox: false`（サンドボックスモード）で実行すること。
