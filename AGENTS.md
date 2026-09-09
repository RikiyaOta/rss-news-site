# AGENTS.md - AI エージェント開発ガイドライン

本リポジトリ（`rss-news-site`）で作業を行うすべての AI エージェントは、以下の開発規約および制約事項を厳格に遵守してください。

---

## 1. ツールチェーン & パッケージマネージャー制約

* **パッケージマネージャーの厳格固定:**
  * パッケージのインストール、ビルド、テスト、スクリプト実行には **必ず `pnpm` のみを使用** してください。
  * **`npm`、`npx`、`yarn`、`bun` 等のコマンドは絶対に使用禁止** です（例: `npm test` ではなく `pnpm test`、`npx vitest` ではなく `pnpm vitest`）。
* **バージョンマネージャー (`mise`):**
  * グローバルツール（Node.js 24 LTS, pnpm 11.22, Terraform 1.15.8, pinact 4.0.0）は `mise.toml` で管理されており、`mise.lock` でハッシュ固定されています。
* **サプライチェーンセキュリティ:**
  * `pnpm-workspace.yaml` に `minimumReleaseAge: 10080`（7日間）が設定されています。最新リリースから7日未満のパッケージはインストールできません。

---

## 2. テスト規約 & 品質基準

### 2.1 テストの対象

* テストは **プロダクトの振る舞い** のみを対象とします。
* `package.json` / `mise.toml` / `*.tf` / `.github/workflows/*.yml` など、**リポジトリの設定ファイルの内容を文字列マッチで検証するテストを書いてはいけません。** 設定の妥当性は、そのツールを実際に実行する CI ステップ（`terraform validate` / `pinact:check` / `pnpm build` / `wrangler dev`）で担保します。
* `src` から参照されていないコード（死んだ export）にテストを書かないでください。見つけた場合はテストではなくコードごと削除します。

### 2.2 レイヤーとモック境界

各テストは以下のいずれか 1 層に属し、**モック境界はその層に定義されたものだけ**とします。多重にモックすると、どの層も実際には繋がっていない状態になります。

| 層 | 置き場所 | 実行コマンド | モックするもの |
|---|---|---|---|
| L1 ユニット | `tests/unit/**` | `pnpm test` | なし |
| L2 コンポーネント | `tests/component/**` | `pnpm test` | `api-client` のみ |
| L3 結合 (Pipeline) | `tests/integration/pipeline/**` | `pnpm test` | 外部 HTTP と埋め込みモデル |
| L3 結合 (Worker) | `tests/integration/worker/**` | `pnpm test:worker` | なし（workerd + 実 D1） |
| L3 結合 (Model) | `tests/integration/model/**` | `pnpm test:integration` | なし（実モデル） |
| L4 E2E | `tests/e2e/**` | `pnpm test:e2e` | Workers AI のみ |

* **L4 E2E で API をモックしてはいけません。** `wrangler dev` が本番と同じ workerd 上で Hono を起動し、D1（ローカル SQLite に本番と同じ migrations を適用）と `pnpm build` の生成物を配信します。
* **Workers AI だけは例外**です。ローカルでエミュレートできず、呼び出すと実アカウントへリクエストが飛んで課金対象になるため、`tests/e2e/worker-entry.ts` で決定論的なスタブに差し替えます。実モデルの精度は L3 (Model) と nightly で担保します。
* **同じ振る舞いを 2 層で重複検証しないでください。** 上位層は「経路が繋がっていること」だけを確認します。

### 2.3 スキーマとカバレッジ

* `articles` テーブルのスキーマは **`migrations/` が唯一の正**です。テストもここから読み込みます。他の場所にスキーマを複製しないでください。
* カバレッジは下限のみを CI ゲートにします（全体 `lines 90 / branches 85`、`src/shared/date.ts` は 100%）。数値そのものを目標にはしません。
* `src/server/**` は workerd 上で実行されるため V8 カバレッジを収集できません。カバレッジ計測の対象からは外し、品質は L3 (Worker) テストの通過で担保します。

### 2.4 テストケースの書き方

* **テストケース名はすべて日本語**で記述してください（`describe` / `it` / `test` の第1引数、およびアサーションメッセージ）。
* **区分・閾値・日付境界を持つロジックは `it.each` によるテーブル駆動**で記述し、各区分の上端・下端とその直前直後を必ず含めてください。表がそのまま仕様書になるようにします。
* **テスト駆動開発 (TDD):** 新規機能・修正時は必ず失敗するテスト（Red）を作成してから実装（Green）し、リファクタリング（Refactor）を行ってください。

### 2.5 実行コマンド

```bash
pnpm test              # L1 + L2 + L3(Pipeline)
pnpm test:coverage     # 上記 + カバレッジ計測
pnpm test:worker       # L3(Worker): workerd + ローカル D1
pnpm test:integration  # L3(Model): 実モデル (約1.1GB のダウンロードを伴う)
pnpm test:e2e          # L4: wrangler dev + ローカル D1 + 本番ビルド
pnpm test:e2e:smoke    # L4 のうち @smoke タグのみ
pnpm typecheck         # tsc --noEmit
pnpm check             # 型・リント・整形・Terraform・pinact・L1〜L3
```

## 3. コマンド実行 & サンドボックス規約

* **サンドボックス内実行の徹底:**
  * コマンドを実行する際は、原則として標準サンドボックスモード（`BypassSandbox: false`）で実行してください。
* **単一コマンドの実行:**
  * `&&` や `|`（パイプ）で複数のコマンドを1行に連結せず、1ステップにつき単一のコマンドを実行してください。

---

## 4. アーキテクチャ & 実装ルール

1. **RSS 収集 & ローカル多言語埋め込みスコアリングパイプライン:**
   * 外部 LLM API（Gemini 等）を使用せず、ローカルの `BAAI/bge-m3` 埋め込みモデルを用いてユーザー関心プロファイルとのコサイン類似度から 0〜100 点でスコアリングします。
   * RSS 記事のメタデータ（`og:description` / `description`）を抽出してスニペットとして保存します。
   * 記事の公開日時（`published_at`）から日本標準時（JST）の日付（`published_date_jst`）を算出して保存します。
   * **画面の日付はフィードの公開日時のみを正とします。** 収集時刻を公開日時の代替として使用してはいけません。公開日時を取得できない記事は取り込まず（`fetcher` で除外）、UPSERT では公開日が後の日付へ前進しないよう `MIN()` で保持します。
2. **多言語ベクトル埋め込み (`BAAI/bge-m3`):**
   * **指示プレフィックスを付与してはいけません。** `bge-m3` は query / passage いずれにも指示を必要としません。`"query: "` / `"passage: "` は `multilingual-e5` 系の流儀であり（本プロジェクトも当初は `multilingual-e5-small` を使っていました）、`bge-m3` に付けると単なるノイズになります。とくに `"Rust"` のような短い関心テキストではプレフィックスがトークン列の大半を占め、記事側との類似度を構造的に押し下げます。
   * **プーリングは必ず `cls` を使用してください。** `bge-m3` の dense 表現は「`[CLS]` トークンの最終隠れ状態を L2 正規化したもの」と定義されています（`mean` は別モデルの流儀です）。Workers AI の `@cf/baai/bge-m3` も公式実装に準拠するため、ここを揃えないと `/api/search` のクエリベクトルと記事ベクトルの空間が食い違います。
   * 埋め込み生成は必ず `src/pipeline/embedder.ts` の `embedText` を経由させ、プーリング戦略を 1 箇所に閉じ込めてください。
   * ベクトルは 1024 次元の L2 正規化済み `Float32Array`（BLOB 4096バイト）を扱います。
   * **スコア区分の閾値（`src/pipeline/scorer.ts` の `SIMILARITY_BANDS`）は埋め込みモデルが実際に出す類似度レンジに依存します。** モデルやプーリング、プレフィックスを変更したら必ず `pnpm calibrate` で実データの分布を測り直してください。相対比較のテストだけでは「全記事が同じ帯に潰れる」不具合を検知できません。
3. **Cloudflare D1 データベース設計:**
   * テーブル: `articles` (`id` PK, `title`, `url` UNIQUE, `source_name`, `summary`, `score`, `published_at`, `published_date_jst`, `embedding` BLOB, `created_at`)
   * インデックス: `idx_articles_jst_score` (`published_date_jst, score DESC`), `idx_articles_url` (`url`), `idx_articles_score` (`score DESC`)
4. **Cloudflare Workers & Hono API:**
   * Cloudflare Workers（Static Assets + Hono）によるエッジ API / フロントエンド配信。
   * `/api/articles?date=YYYY-MM-DD`: `published_date_jst` 基準の日別記事一覧（スコア降順）。
   * `/api/search?q=...`: Workers AI (`@cf/baai/bge-m3`) によるクエリベクトル化と D1 全記事ベクトル類似度検索。
5. **Terraform & Wrangler 責務分離方針 (Cloudflare Best Practice):**
   * **Terraform の責務:** 永続インフラ・長寿命リソースである Cloudflare D1 データベース（`rss-news-db`）の作成とライフサイクル管理に専念（tfstate は R2 バケット `rss-news-site-tfstate` で管理）。
   * **Wrangler の責務 (`wrangler.jsonc`):** アプリケーションコード（Hono）、React SPA 静的アセット、D1 / Workers AI バインディング、カスタムドメインのルーティングを一元管理。Worker 本体を Terraform 側に重複定義しない。
   * すべてのサードパーティ GitHub Action は `pinact` を使用してコミットハッシュ（SHA-1）で固定してください。
