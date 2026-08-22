# Cloudflare Workers + D1 + Hono + BGE-M3 全面刷新実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloudflare Workers (Static Assets) + Hono + Cloudflare D1 + BAAI/bge-m3 によるフルスタックサーバーサイド構成への移行を行い、公開日基準の正確なニュース配信とスマホでの超高速・軽量な閲覧・検索体験を実現する。

**Architecture:** 
- フロントエンド: React SPA (Vite ビルド結果を Cloudflare Workers の Static Assets 機能でグローバル CDN 配信)
- バックエンド: Hono を使用した Worker API (`/api/articles`, `/api/search`)
- データベース: Cloudflare D1 (`articles` テーブルにメタデータと 1024 次元ベクトルを保持)
- AI モデル: `BAAI/bge-m3` (GitHub Actions での記事インデックス化 & Cloudflare Workers AI による検索クエリの GPU 推論)
- インフラ管理: Terraform (Cloudflare Provider v5)

**Tech Stack:** Hono, Cloudflare Workers, Cloudflare D1, Cloudflare Workers AI (`@cf/baai/bge-m3`), React, TypeScript, Tailwind CSS, Vite, Terraform, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-20-workers-d1-hono-bge-m3-architecture.md`

## Global Constraints

- パッケージマネージャーは必ず `pnpm` のみを使用すること。
- すべてのテストケース名・アサーションメッセージは日本語で記述すること。
- TDD（Red -> Green -> Refactor）を徹底すること。
- コマンド実行時は原則 `BypassSandbox: false` で実行すること。
- 記事登録および検索時のベクトル埋め込みは `BAAI/bge-m3`（1024次元）で完全一致させること。
- フロントエンドの描画 DOM ノード数は 150 個未満を維持すること（スマホのフリーズを完全防止）。

---

## タスク一覧

### Task 1: D1 データベーススキーマ定義 & クエリレイヤーの実装

**Files:**
- Create: `src/server/db/schema.sql`
- Create: `src/server/db/articles.ts`
- Test: `tests/server/articles-db.test.ts`

**Interfaces:**
- Consumes: `Article`, `SearchResultItem` from `src/shared/types.ts`
- Produces: `upsertArticles(db, articlesWithVectors)`, `getArticlesByPublishedDate(db, date, options)`, `searchArticlesByCosineSimilarity(db, queryVector, options)`

- [ ] **Step 1: D1 データベース操作の失敗するテストを作成**
- [ ] **Step 2: テストを実行して失敗することを確認 (`pnpm vitest run tests/server/articles-db.test.ts`)**
- [ ] **Step 3: スキーマ定義 `schema.sql` と D1 クエリヘルパー `articles.ts` を実装**
- [ ] **Step 4: テストを実行して合格することを確認**
- [ ] **Step 5: コミット (`git commit -m "feat(server): implement D1 schema and article query repository"`)**

---

### Task 2: BAAI/bge-m3 埋め込み & スコアリングモジュールの刷新

**Files:**
- Modify: `src/pipeline/embedder.ts`
- Modify: `src/pipeline/scorer.ts`
- Test: `tests/pipeline/embedder.test.ts`
- Test: `tests/pipeline/scorer.test.ts`

**Interfaces:**
- Consumes: `UserProfile` from `src/shared/types.ts`
- Produces: `getExtractor()`, `scoreArticleWithProfile()`, `precomputeInterestVectors()` (すべて 1024 次元 `BAAI/bge-m3` 対応)

- [ ] **Step 1: `bge-m3` 1024 次元ベクトル対応の失敗するテストを作成**
- [ ] **Step 2: テストを実行して失敗することを確認 (`pnpm vitest run tests/pipeline/scorer.test.ts`)**
- [ ] **Step 3: `embedder.ts` と `scorer.ts` を `BAAI/bge-m3` に更新し、1024 次元正規化・スコア計算を実装**
- [ ] **Step 4: テストを実行して合格することを確認**
- [ ] **Step 5: コミット (`git commit -m "feat(pipeline): update embedder and scorer to BAAI/bge-m3 (1024-dim)"`)**

---

### Task 3: Hono バックエンド API サーバーの実装 (Workers Static Assets)

**Files:**
- Create: `src/server/index.ts`
- Create: `wrangler.jsonc`
- Test: `tests/server/api.test.ts`

**Interfaces:**
- Consumes: D1 クエリレイヤー, Workers AI バインディング (`env.AI`, `env.DB`)
- Produces: `GET /api/articles?date=YYYY-MM-DD`, `GET /api/search?q=...`

- [ ] **Step 1: Hono API エンドポイントの失敗するルーティングテストを作成**
- [ ] **Step 2: テストを実行して失敗することを確認 (`pnpm vitest run tests/server/api.test.ts`)**
- [ ] **Step 3: `src/server/index.ts` に Hono アプリケーションおよび `wrangler.jsonc` を実装**
- [ ] **Step 4: テストを実行して合格することを確認**
- [ ] **Step 5: コミット (`git commit -m "feat(server): implement Hono API router with D1 and Workers AI bindings"`)**

---

### Task 4: フロントエンド React SPA の超軽量化刷新

**Files:**
- Create: `src/web/lib/api-client.ts`
- Modify: `src/web/App.tsx`
- Modify: `src/web/components/ArticleList.tsx`
- Modify: `src/web/components/SearchBar.tsx`
- Delete: `src/web/workers/embedder.worker.ts`, `src/web/lib/browser-embedder.ts`, `src/web/lib/sqlite-client.ts`, `src/web/lib/r2-client.ts`
- Test: `tests/web/App.test.tsx`
- Test: `tests/web/api-client.test.ts`

**Interfaces:**
- Consumes: `/api/articles` および `/api/search`
- Produces: 超軽量 React UI（WASM / Web Worker 依存なし、DOM ノード 150 個未満）

- [ ] **Step 1: 新規 API クライアントと軽量 UI の失敗するテストを作成**
- [ ] **Step 2: テストを実行して失敗することを確認 (`pnpm vitest run tests/web/App.test.tsx`)**
- [ ] **Step 3: `api-client.ts` を作成し、`App.tsx` / `ArticleList.tsx` を API 駆動に移行。不要な Wasm / Worker を削除**
- [ ] **Step 4: テストを実行して合格することを確認**
- [ ] **Step 5: コミット (`git commit -m "feat(web): migrate frontend to lightweight API client and remove client Wasm/Workers"`)**

---

### Task 5: GitHub Actions パイプラインの D1 直接連携化 & R2 廃止

**Files:**
- Create: `src/pipeline/d1-sync.ts`
- Modify: `src/pipeline/index.ts`
- Modify: `.github/workflows/fetch-and-score-pipeline.yml`
- Test: `tests/pipeline/pipeline.test.ts`
- Test: `tests/workflows.test.ts`

**Interfaces:**
- Consumes: RSS 記事群, `bge-m3` スコア & ベクトル
- Produces: D1 への直接 UPSERT 実行。R2 アップロードステップの完全削除

- [ ] **Step 1: D1 同期パイプラインの失敗するテストを作成**
- [ ] **Step 2: テストを実行して失敗することを確認 (`pnpm vitest run tests/pipeline/pipeline.test.ts`)**
- [ ] **Step 3: `d1-sync.ts` を実装し、`pipeline/index.ts` および `fetch-and-score-pipeline.yml` を D1 同期に切り替え**
- [ ] **Step 4: テストを実行して合格することを確認**
- [ ] **Step 5: コミット (`git commit -m "feat(pipeline): sync articles directly to Cloudflare D1 and remove R2 pipeline"`)**

---

### Task 6: Terraform インフラ定義の D1 対応 & R2 整理

**Files:**
- Modify: `terraform/main.tf`
- Modify: `terraform/variables.tf`
- Modify: `terraform/outputs.tf`
- Test: `tests/terraform.test.ts`

**Interfaces:**
- Produces: `cloudflare_d1_database`, Worker / Pages D1 & Workers AI バインディング設定。R2 データバケットの安全な廃止

- [ ] **Step 1: Terraform D1 定義の失敗するテストを作成**
- [ ] **Step 2: テストを実行して失敗することを確認 (`pnpm vitest run tests/terraform.test.ts`)**
- [ ] **Step 3: `terraform/main.tf` に D1 データベースとバインディングを定義し、R2 リソースを整理**
- [ ] **Step 4: `terraform validate` およびテストを実行して合格することを確認**
- [ ] **Step 5: コミット (`git commit -m "feat(infra): add Cloudflare D1 database and bindings to Terraform"`)**

---

### Task 7: 全体結合検証・E2E テスト・ドキュメント更新

**Files:**
- Modify: `tests/e2e/news-site.spec.ts`
- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: E2E テストを D1 API バックエンド対応に更新**
- [ ] **Step 2: `pnpm check`（型チェック、リント、全テスト）を実行して全件合格を確認**
- [ ] **Step 3: `pnpm test:e2e` を実行して全シナリオ（モバイル表示、日別一覧、セマンティック検索）合格を確認**
- [ ] **Step 4: `README.md` と `AGENTS.md` のアーキテクチャ図・説明を更新**
- [ ] **Step 5: コミット (`git commit -m "docs, test: update E2E tests, README, and AGENTS.md for Workers+D1 architecture"`)**

---
