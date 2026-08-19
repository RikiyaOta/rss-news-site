# Task 4 Brief: Gemini 2.5 Flash-Lite 要約 & スコアリングモジュール

**Files:**
- Create: `src/pipeline/gemini.ts`
- Test: `tests/pipeline/gemini.test.ts`

**Requirements:**
1. `src/pipeline/gemini.ts`:
   - `ScoringResult` インターフェース:
     - `summary: string` (3行要約)
     - `score: number` (0〜100 の整数)
   - `sleep(ms: number): Promise<void>`:
     - 指定ミリ秒スリープするPromise関数（15 RPM 制限を守る 4200ms 待機用）
   - `buildScoringPrompt(article: { title: string; snippet: string }, profile: UserProfile): string`:
     - 記事タイトル・抜粋・ユーザーの関心キーワード・除外キーワード・採点ガイドラインをプロンプトに埋め込み、JSONフォーマット指定を行う。
   - `parseGeminiResponse(responseText: string): ScoringResult`:
     - レスポンステキストからマークダウンコードブロック（```json 等）を除去して安全にJSONパース
     - スコア（`score`）を `0`〜`100` の整数値にクランプ（無効値時は 50 フォールバック）
     - 要約（`summary`）文字列の正規化（パース失敗時はフォールバック文字列を返却）
   - `summarizeAndScoreArticle(article: RawArticle, profile: UserProfile, apiKey: string, aiClient?: any): Promise<ScoringResult>`:
     - `@google/genai` の `GoogleGenAI`（またはテスト用モック）を使用して `gemini-2.5-flash-lite` を呼び出し、要約とスコアを取得
2. `tests/pipeline/gemini.test.ts`:
   - すべてのテストケースを **日本語** で記述。
   - プロンプト生成の検証（関心キーワード・除外キーワードの包含）
   - レスポンスパースの検証（正常JSON、マークダウン付きJSON、スコア範囲外クランプ、不正JSONフォールバック）
   - API呼び出しのモック検証
   - `sleep` 関数の動作検証
3. 全テストが通過し、型チェック（`tsc --noEmit`）でエラーがないこと。
