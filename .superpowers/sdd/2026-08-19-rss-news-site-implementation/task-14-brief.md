# Task 14 Brief: Playwright E2E テストの日本語実装

**Files:**
- Create:
  - `playwright.config.ts`
  - `tests/e2e/news-site.spec.ts`

**Requirements:**
1. `playwright.config.ts`:
   - `webServer`: `pnpm dev --port 5173` (または `pnpm preview`), `url: "http://localhost:5173"`, `reuseExistingServer: !process.env.CI`
   - `use`: `baseURL: "http://localhost:5173"`, `trace: "on-first-retry"`
   - `testDir`: `"./tests/e2e"`
2. `tests/e2e/news-site.spec.ts`:
   - すべてのテストケース（`describe`, `test`, `expect`）を **日本語** で記述。
   - **シナリオ 1: トップページ表示と日別ニュース一覧:**
     - タイトル「AI RSS News Dashboard」が表示されること
     - 日付ナビゲーションとカレンダーピッカーが表示されること
     - 記事カードにタイトル、発信元バッジ、興味関心スコアバッジ、3行要約箇条書きが表示されること
   - **シナリオ 2: 日付ナビゲーション操作:**
     - 前日・翌日ボタンのクリックで日付が切り替わること
   - **シナリオ 3: 自然言語セマンティック検索フロー:**
     - 検索バーにクエリ（例: `"TypeScript"`）を入力して検索実行
     - 検索結果に「一致度 XX%」バッジと該当日付バッジが表示されること
   - **シナリオ 4: 検索のクリアと日別表示への復帰:**
     - クリアボタンクリックで入力欄がリセットされ、日別ニュース一覧に戻ること
   - **シナリオ 5: レスポンシブモバイル表示検証:**
     - モバイル画面幅（375px）でレイアウト崩れなく表示されること
3. 全テストが通過し、型チェック（`tsc --noEmit`）でエラーがないこと。
4. **コマンド実行ルール:**
   - **パッケージマネージャーには必ず `pnpm` のみを使用し、`npm` や `npx` は絶対に使用しないこと。**
