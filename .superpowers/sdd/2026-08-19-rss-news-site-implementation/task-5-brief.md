# Task 5 Brief: 多言語ベクトル埋め込み生成モジュール

**Files:**
- Create: `src/pipeline/embedder.ts`
- Test: `tests/pipeline/embedder.test.ts`

**Requirements:**
1. `src/pipeline/embedder.ts`:
   - `formatPassageText(title: string, summary: string): string`:
     - `intfloat/multilingual-e5-small` の仕様に従い、`"passage: " + title.trim() + "\n" + summary.trim()` のフォーマットを生成する。
   - `l2Normalize(vector: Float32Array | number[]): Float32Array`:
     - ベクトルのL2ノルム（ユークリッド距離）を計算し、単位ベクトルに正規化する。
   - `getExtractor(customPipeline?: any): Promise<any>`:
     - `@huggingface/transformers` の `pipeline("feature-extraction", "intfloat/multilingual-e5-small", { dtype: "fp32" })` を初期化・シングルトン管理する（DI可能）。
   - `generateArticleEmbedding(title: string, summary: string, extractorInstance?: any): Promise<Float32Array>`:
     - `formatPassageText` で整形したテキストをモデルに入力し、mean pooling + 正規化された 384次元の `Float32Array` を返却する。
2. `tests/pipeline/embedder.test.ts`:
   - すべてのテストケースを **日本語** で記述。
   - `formatPassageText` のプレフィックスおよびトリム処理の検証
   - `l2Normalize` のノルム=1.0 正規化計算の検証
   - モック extractor を用いた `generateArticleEmbedding` の次元数・正規化出力の検証
   - DI（依存性注入）によるテスタビリティの検証
3. 全テストが通過し、型チェック（`tsc --noEmit`）でエラーがないこと。
4. **コマンド実行ルール:** すべてのコマンドは `BypassSandbox: false`（サンドボックスモード）で実行すること。
