# Cloudflare Workers + D1 + Hono + BGE-M3 全面刷新設計仕様書

**日付:** 2026-08-20  
**ステータス:** 策定済み (Proposed)

---

## 1. 背景と課題

現行の「Cloudflare Pages + R2 + ブラウザ内 Wasm SQLite + ブラウザ内 Transformers.js」構成では、以下の根本的な課題が存在します：

1. **モバイル環境での深刻なパフォーマンス低下:**
   - 3,267 件の記事を一括描画することで **81,725 個の DOM ノード** が生成され、低スペック端末でフリーズが発生。
   - 初回に **10.4MB の日別 SQLite DB** と **118.3MB の ONNX モデル** をダウンロードする必要があり、通信量と待機時間が過大。
2. **「取得日」と「記事公開日（`published_at`）」のデータ構造の食い違い:**
   - 日付別 SQLite ファイル（`YYYY-MM-DD.db`）が「RSS 取得日」で物理分割されているため、過去の日付で公開された記事を「公開日基準」で正確に集約・表示することが構造上困難。
3. **クライアントリソースの過度な浪費:**
   - 検索・ベクトル計算・全件スキャンをすべてユーザーのブラウザ（JavaScript）に丸投げしているため、端末性能によって検索体験が大きく左右される。

---

## 2. ゴール & 非ゴール

### ゴール (Goals)
1. **Cloudflare Workers (Static Assets) + Hono への移行:**
   - 同一ドメイン（`https://rss-news.rikiyaota.kyoto`）で静的 React アセットの CDN 配信と `/api/*` のバックエンド API を統合ホスト。
2. **Cloudflare D1 によるサーバーサイド単一 SQLite データベース化:**
   - すべての記事を単一の D1 データベース（`articles` テーブル）に格納し、`published_at`（公開日）基準で SQL クエリ（`WHERE DATE(published_at) = ? ORDER BY score DESC LIMIT 50`）を実行。
   - R2 の日別 SQLite DB（`data/YYYY-MM-DD.db`）および `search_index.db` の配布構成を完全廃止。
3. **オープンソース最高峰モデル `BAAI/bge-m3` による統一:**
   - **GitHub Actions (記事収集・スコアリング):** ランナー CPU で `BAAI/bge-m3`（1024次元）を用いて高精度スコアリングとベクトル埋め込みを生成し、D1 に直接 INSERT。
   - **Cloudflare Workers (セマンティック検索):** `env.AI.run('@cf/baai/bge-m3', { text: query })`（Workers AI のエッジ GPU）でクエリを 0.05 秒でベクトル化し、D1 の記事ベクトルと照合して返却。
4. **超軽量・爆速フロントエンド（React SPA）の実現:**
   - `sql.js`（WASM）、ブラウザ内 `@huggingface/transformers`、Web Worker を完全削除。
   - DOM ノード数を 150 個未満に抑え、スマホでの表示・検索・タブ切り替えを 0.01 秒で完結。

### 非ゴール (Non-Goals)
- 外部有料 AI API（OpenAI / Gemini API）の利用（すべてオープンソース `bge-m3` と無料枠 Cloudflare Workers AI で完結）。
- ユーザー認証・ログイン機能の追加（個人利用・公開ビューアとしてのシンプルさを維持）。

---

## 3. システムアーキテクチャ

```
┌────────────────────────────────────────────────────────────────────────┐
│                        GitHub Actions (日次cron)                       │
│  1. RSS Fetch (og:description補完)                                     │
│  2. Local Embedding & Scoring (BAAI/bge-m3: 1024-dim, 0〜100点)        │
│  3. Cloudflare D1 REST API へ記事 & ベクトルを直接 UPSERT               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Direct Insert
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Cloudflare Platform (エッジインフラ)                  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Cloudflare Workers with Static Assets                            │  │
│  │ (Custom Domain: rss-news.rikiyaota.kyoto)                        │  │
│  │                                                                  │  │
│  │  [Static Assets Cache Engine]                                    │  │
│  │   ├── /                 ──► dist/index.html (React SPA)          │  │
│  │   └── /assets/*         ──► dist/assets/* (JS/CSS)               │  │
│  │                                                                  │  │
│  │  [Hono API Router (/api/*)]                                      │  │
│  │   ├── GET /api/articles ──► D1: SELECT (DATE(published_at) = ?)  │  │
│  │   └── GET /api/search   ──► Workers AI: @cf/baai/bge-m3          │  │
│  │                             └─► D1: Vector Cosine Scan (Top K)   │  │
│  └───────────────────┬───────────────────────────┬──────────────────┘  │
│                      │ Bindings                  │ Bindings            │
│                      ▼                           ▼                     │
│         ┌─────────────────────────┐ ┌─────────────────────────┐        │
│         │ Cloudflare D1 Database  │ │ Cloudflare Workers AI   │        │
│         │ (Database: rss-news-db) │ │ (@cf/baai/bge-m3 GPU)   │        │
│         └─────────────────────────┘ └─────────────────────────┘        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. データベース設計 (Cloudflare D1)

### テーブル: `articles`
```sql
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  source_name TEXT NOT NULL,
  summary TEXT,
  score INTEGER NOT NULL,
  published_at TEXT NOT NULL,       -- ISO8601 文字列 (例: '2026-08-20T07:30:00Z')
  published_date TEXT NOT NULL,     -- 検索用日付 (例: '2026-08-20')
  embedding BLOB,                   -- 1024次元 Float32Array (4096 bytes)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_articles_published_date_score ON articles(published_date, score DESC);
CREATE INDEX IF NOT EXISTS idx_articles_url ON articles(url);
CREATE INDEX IF NOT EXISTS idx_articles_score ON articles(score DESC);
```

---

## 5. API インターフェース設計 (Hono)

### 1. 日別記事一覧取得 API
* **エンドポイント:** `GET /api/articles`
* **クエリパラメータ:**
  * `date` (string, required): 取得対象日（形式: `YYYY-MM-DD`）
  * `limit` (number, optional, default: 50): 最大取得件数
  * `offset` (number, optional, default: 0): ページネーションオフセット
* **レスポンス (200 OK):**
```json
{
  "date": "2026-08-20",
  "total": 42,
  "articles": [
    {
      "id": "abc-123",
      "title": "Cloudflare Workers with Static Assets の実践",
      "url": "https://example.com/post/1",
      "source_name": "Cloudflare Blog",
      "summary": "Cloudflare Workers の最新静的アセット配信機能についての解説。",
      "score": 92,
      "published_at": "2026-08-20T08:00:00.000Z"
    }
  ]
}
```

### 2. セマンティック検索 API
* **エンドポイント:** `GET /api/search`
* **クエリパラメータ:**
  * `q` (string, required): 検索クエリ
  * `limit` (number, optional, default: 30): 上位取得件数
* **処理フロー:**
  1. `c.env.AI.run("@cf/baai/bge-m3", { text: `query: ${q}` })` で 1024 次元のクエリベクトルを生成。
  2. D1 から直近の記事ベクトルを取得し、コサイン類似度を計算。
  3. 類似度上位 K 件の記事メタデータ（`id`, `title`, `url`, `source_name`, `summary`, `score`, `published_at`, `similarity`）を返却。
* **レスポンス (200 OK):**
```json
{
  "query": "TypeScript",
  "results": [
    {
      "id": "bun-1-1",
      "title": "Bun v1.1.5",
      "url": "https://bun.com/blog/bun-v1.1.5",
      "source_name": "bun.com",
      "summary": "TypeScript のコンパイル速度向上とバグ修正...",
      "score": 82,
      "published_at": "2026-08-19T10:00:00.000Z",
      "similarity": 0.88
    }
  ]
}
```

---

## 6. フロントエンド（React SPA）の設計変更

1. **削除する依存関係・ファイル:**
   - `sql.js` (WebAssembly)
   - `src/web/workers/embedder.worker.ts`
   - `src/web/lib/sqlite-client.ts`
   - `src/web/lib/r2-client.ts`
2. **新規作成・軽量化するモジュール:**
   - `src/client/api.ts`: Hono バックエンドとの `fetch('/api/articles')` / `fetch('/api/search')` クライアント。
   - `src/client/App.tsx`: 軽量 React コンポーネント。DOM ノード数 150 個未満、スクロール即時反応。

---

## 7. Terraform インフラ設計 (Cloudflare Provider v5)

1. **追加リソース:**
   - `cloudflare_d1_database.news_db`: D1 データベース `rss-news-db`
2. **移行リソース:**
   - `cloudflare_workers_script` (または `cloudflare_pages_project` の D1 / Workers AI バインディング付与)
   - `cloudflare_worker_domain` (カスタムドメイン `rss-news.rikiyaota.kyoto`)
3. **廃止・削除リソース:**
   - `cloudflare_r2_bucket.data` (`rss-news-site-data`)
   - `cloudflare_r2_managed_domain.data`
   - `cloudflare_r2_bucket_cors.data`

---

## 8. テスト・検証戦略

- **ユニットテスト (Vitest):**
  - Hono API ルーティング、D1 クエリヘルパー、`bge-m3` ベクトル計算ロジック、React クライアントの日本語テスト。
- **統合 & E2E テスト (Playwright):**
  - モバイル環境（375x667）での日別一覧表示、日付切り替え、セマンティック検索、DOM ノード数検証。
- **CI / Terraform 検証:**
  - `terraform validate` & `terraform plan` による D1 / Worker プロビジョニング検証。
