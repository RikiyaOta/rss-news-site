# テスト方針レビュー（2026-09-07 / 実装済み 2026-09-08）

現状の 296 テスト（ユニット）＋ 12 シナリオ（E2E）＋ 10 ケース（実モデル統合）を全件確認したうえでの、
**方針レベルの問題点** と **具体的な作り直し案** をまとめる。

---

> **実装状況:** 本レビューの方針は全 8 ステップとも実装済み。結果は末尾の「9. 実装結果」を参照。

## 0. 結論（先に3行）

1. **テストの約 25%（74/296）が、プロダクトの振る舞いではなく「リポジトリの設定ファイルの文字列」か「死んだコード」を検証している。** 実質的にデグレードを検知できない。
2. **E2E が実環境ではない。** Vite dev サーバー上で全 API をモックしているため、Hono Worker・D1 の SQL・Workers AI・本番ビルド・静的アセット配信は **一度も実行されていない**。E2E は結局 `App.test.tsx` を遅く再演しているだけになっている。しかも E2E は PR で走らない（nightly cron のみ）。
3. **「境界値・ユーザー操作の網羅性が一目で分かる」構成にはなっていない。** テーブル駆動がなく、JST 日付境界・`limit`/`offset` の異常値・無限スクロールなど、壊れたら実害の大きい箇所が素通りしている。

カバレッジ数値は 91.67%（statements）と一見良好だが、**死んだコード（`src/pipeline/db.ts`）が 98% でカバーされている**ため、数字が実態より良く見えている。

---

## 1. 現状の棚卸し

| ファイル | 件数 | 実行環境 | 何を検証しているか |
|---|---:|---|---|
| `tests/pipeline/fetcher.test.ts` | 45 | node | RSS 正規化・公開日時抽出・メタ補完 |
| `tests/workflows.test.ts` | 38 | node | **`.github/workflows/*.yml` の文字列** |
| `tests/web/components.test.tsx` | 22 | jsdom | 各 React コンポーネント |
| `tests/server/articles-db.test.ts` | 20 | node + better-sqlite3 | D1 クエリレイヤ（実 SQL 実行） |
| `tests/web/App.test.tsx` | 20 | jsdom | 画面全体（api-client は全モック） |
| `tests/pipeline/embedder.test.ts` | 17 | node | 埋め込み生成（モデルはモック） |
| `tests/web/daily-pager.test.tsx` | 16 | jsdom | ページめくり UI |
| `tests/terraform.test.ts` | 15 | node | **`terraform/*.tf` の文字列** |
| `tests/pipeline/db.test.ts` | 15 | node | **ローカル SQLite（死んだコード）** |
| `tests/web/use-horizontal-drag.test.tsx` | 14 | jsdom | ドラッグ判定フック |
| `tests/web/api-client.test.ts` | 13 | node | fetch ラッパ（fetch はモック） |
| `tests/pipeline/d1-sync.test.ts` | 12 | node | D1 REST 同期（fetch はモック） |
| `tests/server/api.test.ts` | 12 | node | Hono API（D1 は手書き JS 偽装） |
| `tests/pipeline/config.test.ts` | 11 | node | YAML パース |
| `tests/pipeline/scorer.test.ts` | 11 | node | スコアリング |
| `tests/pipeline/pipeline.test.ts` | 9 | node | パイプライン統合 |
| `tests/toolchain.test.ts` | 6 | node | **`mise.toml` / `package.json` の文字列** |
| `tests/e2e/news-site.spec.ts` | 12 | Playwright | 画面（**API は全モック**） |
| `tests/integration/embedding-model.test.ts` | 10 | node（実モデル） | bge-m3 の実挙動 |

カバレッジ（`pnpm test:coverage`、`tests/workflows.test.ts` を除外して計測）:

```
All files                 91.67 stmts / 84.05 branch
 src/server/index.ts      82.97 / 64.28   ← extractEmbeddingVector が未網羅
 src/server/db/articles   88.15 / 73.07
 src/web/App.tsx          91.42 / 69.56
 src/web/components/ArticleList.tsx  75.00 / 78.78  ← 無限スクロール未網羅
 src/web/components/SearchBar.tsx    75.00 / 82.35
 src/web/hooks/useDailyArticleStore  82.97 / 67.85
 src/pipeline/db.ts       98.03 / 82.35   ← 死んだコードを厚くカバー
```

---

## 2. 方針レベルの問題点

### P1. プロダクトではなく「リポジトリの設定ファイル」をテストしている（59 件 / 20%）

`toolchain.test.ts` / `terraform.test.ts` / `workflows.test.ts` の 59 件は、
**「自分で書いた設定ファイルに、自分で書いた文字列が入っていること」** を確認しているだけで、
以下の性質を持つ:

- **失敗が「バグの発見」にならない。** 設定を意図的に変えた瞬間にテストも直す必要があり、テストが仕様の追認になっている（トートロジー）。
- **リファクタリングの純粋なコストになる。** 例えば `cron: 0 */3 * * *` を `0 */4 * * *` に変えたいだけで、テストの修正が必要。
- **環境依存で壊れる。** 実際、`workflows.test.ts` の pinact ケースは `mise` が PATH に無い環境（本レビュー環境）で **今まさに失敗している**:
  ```
  FAIL  pinact による静的検証 ... がパスすること
  Error: pinact による検証に失敗しました: /bin/sh: 1: mise: not found
  ```
  ユニットテストの中から `execSync("mise exec -- pinact ...")` を呼ぶのは、テストの責務ではなく CI ステップの責務。
- **すでに二重化している。** `terraform validate` / `terraform fmt -check` / `pnpm pinact:check` は **`ci.yml` に実ステップとして存在する**。文字列マッチのテストはその劣化コピー。

ユーザーの言う「mise がインストールされてるか？のテスト」はまさにこれで、**判断は正しい**。

さらに悪質な例として、`workflows.test.ts` は `e2e.yml` に `E2E_REAL_MODEL` という文字列が含まれることを検証しているが、
**`E2E_REAL_MODEL` は Playwright のタイムアウトを 30s→60s にするだけで、テストの中身は何も変わらない**（実モデルなど使っていない）。
「意味のない環境変数が存在し続けること」をテストが固定してしまっている。

### P2. 死んだコードのテストがカバレッジを水増ししている（15 件）

`src/pipeline/db.ts` の export のうち、**8 個は `tests/pipeline/db.test.ts` からしか参照されていない**:

| export | src からの参照 |
|---|---|
| `initDailyDatabase` | なし |
| `initSearchIndexDatabase` | なし |
| `getExistingArticleIds` | なし |
| `getExistingSearchIndexIds` | なし |
| `insertArticles` | なし |
| `insertVectors` | なし |
| `getArticlesByScore` | なし |
| `getAllSearchVectors` | なし |
| `initLocalDatabase` / `upsertArticlesLocal` | `src/pipeline/index.ts` のみ |

D1 アーキテクチャへ移行する前（ローカル SQLite + 384 次元ベクトル時代）の遺物。
テストが「消せない理由」として残ってしまっている典型。
唯一生きている `initLocalDatabase` / `upsertArticlesLocal` も、
**GitHub Actions の使い捨てランナー上の `./data/local_articles.db` に書いているだけで、誰も読まない。**
本来は「モジュールごと消す」が正解で、テストはその後に消える。

### P3. E2E が「実環境に近い」の逆を行っている

現状の E2E:

```
Playwright → pnpm dev (Vite dev server) → React SPA
                                             ↓ fetch
                                        page.route() で全部モック
```

つまり **本番構成のうち、テストされているのは React だけ**。以下は E2E で一度も動かない:

- Hono アプリ本体（`src/server/index.ts`）
- D1 への実 SQL（`ORDER BY score DESC LIMIT ? OFFSET ?`、`ON CONFLICT ... MIN()`）
- Workers AI（`@cf/baai/bge-m3`）でのクエリベクトル化と `extractEmbeddingVector`
- `pnpm build` の産物（`dist/`）と Workers の `ASSETS` バインディングによる配信
- `wrangler.jsonc` のバインディング設定そのもの

結果として、**E2E は `App.test.tsx` と検証内容がほぼ重複している**（日付移動・検索・クリア・ページめくり）。
遅くて壊れやすい二重投資になっており、「デグレードを検知する」という目的をほとんど果たしていない。

加えて **E2E は PR で走らない**（`e2e.yml` は `schedule` + `workflow_dispatch` のみ）。
壊れても翌朝まで気付けず、しかも誰も見ないので実質的に無効化されている。

### P4. 層の責務が重複し、肝心の結合層が空白

現状のモック境界:

| 層 | モックしている境界 | 実際に動くもの |
|---|---|---|
| `App.test.tsx` | `api-client` 丸ごと | React のみ |
| `api-client.test.ts` | `globalThis.fetch` | URL 組み立てのみ |
| `api.test.ts` | D1 を手書き JS で偽装 | Hono のみ（**SQL は実行されない**） |
| E2E | HTTP レイヤ | React のみ |

**どの層も「React → HTTP → Hono → SQLite」を一度も通していない。**
`tests/server/api.test.ts` の `createInMemoryD1()` は、`ON CONFLICT` の挙動を JS で手書きで再現しており、
**本物の SQL が間違っていてもテストは通る**（`articles-db.test.ts` は better-sqlite3 を使っているのでこちらは健全）。

さらに構造上の地雷として、**`articles` テーブルのスキーマが 4 箇所に重複定義されており、すでにズレている**:

| 定義場所 | `score` の型 | `created_at` |
|---|---|---|
| `migrations/0001_initial_schema.sql`（**本番に適用される正**） | `REAL` | `DEFAULT` |
| `src/server/db/schema.sql`（**テストが読んでいる**） | `INTEGER` | `NOT NULL DEFAULT` |
| `src/pipeline/d1-sync.ts` `SCHEMA_STATEMENTS` | `REAL` | `DEFAULT` |
| `src/pipeline/db.ts` | `INTEGER` | `NOT NULL DEFAULT` |

つまり **テストは本番と違うスキーマに対して緑になっている**。これを検知できるテストは 1 件も無い。

### P5. 境界値・操作網羅が「見て分かる」構成になっていない

良いケースも多い（`fetcher.test.ts` の公開日時フォールバック、`use-horizontal-drag.test.tsx` の方向ロック、
`articles-db.test.ts` の JST 14:59:59/15:00:00 は良い境界テスト）。
一方で以下は網羅の意図が読み取れないか、抜けている:

- **`calculateScoreFromSimilarity`**: 4 つの区分（0.85/0.80/0.73/それ未満）があるのに、境界の**下側**（0.8499, 0.7999, 0.7299）が未検証。`it` が散文的で「境界を網羅した」ことが一目で分からない。→ テーブル駆動 (`it.each`) にすべき典型。
- **「今日」の JST 判定**: `getCurrentJstDate`（server）と `getTodayJstString`（web）と E2E のヘルパーで **同じロジックが 3 重に実装**されていて、**固定時刻でのテストが 1 件も無い**。UTC 15:00 をまたぐと日付が変わるアプリなのに、この境界が未検証。
- **`limit` / `offset` の異常値**: `?limit=abc`（NaN → 50 にフォールバック）、`?limit=-1`、`?limit=999999`（上限なし、D1 を全件走査しうる）、`?offset=-1` が未検証。
- **`extractEmbeddingVector`**: Workers AI のレスポンス形状 5 パターンを吸収する関数だが、**テストは 1 形状のみ**（`server/index.ts` 35〜56 行が未カバー）。ここが壊れると検索が全滅する。
- **無限スクロール**（`ArticleList.tsx` 56〜62 行）: `IntersectionObserver` によるロードが**ユニット・E2E ともに未検証**（jsdom に `IntersectionObserver` が無く、E2E はスクロールしない）。「さらに読み込む」ボタンのみテストされている。
- **`useDailyArticleStore`**: `loadMore` のエラー分岐（147〜150 行）、同一日付への同時リクエスト抑止（`inFlightRef`）が未検証。
- **E2E のモバイル**: モバイル前提の UI なのに Playwright の project は `Desktop Chrome` のみ。`viewport` を手で上書きしているだけで、実機プロファイル（タッチ・DPR・UA）では走っていない。
- **壊れやすいアサーション**: E2E シナリオ 5 の `DOM ノード数 < 150`。正当な UI 追加で落ちる一方、レイアウト崩れは検知できない。目的（軽量性）に対して手段が不適切。

---

## 3. 提案する新方針

### 3.1 レイヤー定義（これを唯一の基準にする）

| 層 | 置き場所 | 実行環境 | 対象 | 何をモックするか | いつ走る |
|---|---|---|---|---|---|
| **L0 静的検査** | — | CI ステップ | 型・lint・fmt・`terraform validate`・`pinact:check`・`actionlint` | — | 毎 PR |
| **L1 ユニット** | `tests/unit/**` | node | 純粋関数（日付・スコア・ベクトル・正規化・パース） | 何も | 毎 PR |
| **L2 コンポーネント** | `tests/component/**` | jsdom | React 単体・カスタムフック | api-client | 毎 PR |
| **L3 結合（Worker）** | `tests/integration/worker/**` | **workerd + 実 D1** | Hono + 実 SQL + バインディング | Workers AI のみ | 毎 PR |
| **L3 結合（Pipeline）** | `tests/integration/pipeline/**` | node + better-sqlite3 | RSS→スコア→D1 同期 | HTTP（RSS/D1 REST）とモデル | 毎 PR |
| **L3 結合（Model）** | `tests/integration/model/**` | node（実モデル） | bge-m3 の実挙動 | 何も | 依存更新時 |
| **L4 E2E** | `tests/e2e/**` | **`wrangler dev` + 実 D1 + 本番ビルド** | ブラウザ〜Worker〜DB の全経路 | 原則なし | 毎 PR（smoke）＋ nightly（full） |

**原則:**

- **リポジトリの設定ファイルはテストの対象にしない。** 設定の妥当性は「そのツールを実際に実行する CI ステップ」で担保する（`terraform validate`、`pinact:check`、`actionlint`、`wrangler deploy --dry-run`）。文字列マッチは書かない。
- **モック境界は層ごとに 1 つだけ。** 「api-client もモック、fetch もモック、D1 も偽装」のような多重モックは、どこも実際には繋がっていない状態を作る。
- **1 つの振る舞いは 1 つの層でのみ検証する。** 日付移動を L2 と L4 の両方でフルに検証しない。L4 は「経路が繋がっていること」だけを見る。
- **死んだコードにテストを書かない・残さない。** 消す判断はテストではなくコードから始める。

### 3.2 E2E を実環境に寄せる具体案

```
Playwright
  → wrangler dev（本番と同じ workerd + Hono + ASSETS(dist) + ローカル D1）
      ↑ 事前に pnpm build で dist を生成
      ↑ 事前に wrangler d1 execute --local --file=migrations/0001_initial_schema.sql
      ↑ 事前に固定シード（tests/fixtures/seed.sql、埋め込みベクトル込み）を投入
  → 実 /api/articles（実 SQL、実ページネーション）
  → 実 /api/search（Workers AI 部分のみ差し替え）
```

**どこまでがローカルエミュレーションか:**

`wrangler dev` は既定でローカルモードで動き、**workerd（本番と同じランタイム）と Miniflare が
Worker 本体・D1・静的アセット配信をローカルでエミュレートする**。
D1 は `.wrangler/state` 配下のローカル SQLite ファイルになり、Cloudflare アカウントには一切アクセスしない。
つまり **PR ごとの E2E は Cloudflare の無料枠を 1 ミリも消費しない**。

ただし **Workers AI だけは例外**で、[ローカル開発でも常にリモートの Cloudflare アカウントへ
リクエストが送られ、利用量としてカウントされる](https://developers.cloudflare.com/workers/development-testing/bindings-per-env)。
`wrangler dev` でローカルにエミュレートすることはできない。
これは本案が「PR ではスタブ」を採る理由が、単に動かせないからだけでなく、
**課金・認証の観点でもそうすべき**という裏付けになる。

**Workers AI の扱い（2 段構え）:**

- **PR（毎回）**: `c.env.AI` を薄くラップし（`src/server/ai.ts`）、E2E 用設定では決定論的なダミーベクトルを
  返すスタブに差し替える。これで **Hono・D1・実 SQL・本番ビルド・アセット配信は全部本物**、
  かつ **Cloudflare 利用量ゼロ・シークレット不要**。
- **nightly**: **AI バインディングだけを remote にする**（Wrangler の
  [remote bindings](https://github.com/cloudflare/workers-sdk/discussions/9660) 機能で
  `AI` に `remote: true` を付ける）。D1 はローカルのシード済み SQLite のまま。
  → 死んでいた `E2E_REAL_MODEL` フラグを、本来の意味（実 AI を使うか否か）で復活させる。

> **重要**: nightly を `wrangler dev --remote`（全バインディングをリモート化）にしてはいけない。
> それをすると **本番 D1 に接続してしまい**、(a) 実データに依存してアサーションが非決定的になる、
> (b) 誤って本番データへ書き込むリスクがある、(c) 行読み取りが無料枠を消費する、の 3 点で不利益しかない。
> **リモートにするのは AI バインディング 1 つだけ。**

**無料枠への影響（試算）:**

| 項目 | 数値 | 出典 |
|---|---|---|
| Workers AI 無料枠 | **10,000 Neurons / 日**（00:00 UTC リセット） | [Workers AI Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) |
| `@cf/baai/bge-m3` の単価 | **1,075 Neurons / 100万入力トークン** | 同上 |
| → 無料枠で処理できる入力量 | 約 **930 万トークン / 日** | 計算 |
| nightly E2E の検索クエリ | 5 クエリ × 約 10 トークン = 50 トークン | 想定 |
| **nightly E2E の消費量** | **約 0.05 Neurons / 日（無料枠の 0.0005%）** | 計算 |

**結論: Workers AI のコストは実質ゼロ。** 仮に nightly で 1,000 クエリ投げても約 11 Neurons で、
無料枠の 0.1% に届かない。心配は不要。

**D1 側**（PR・nightly ともローカルなので消費なし。参考値）:
無料枠は **1 日あたり 5,000,000 行読み取り / 100,000 行書き込み / ストレージ 5GB**。
なお **2026-09-01 以降、Workers Free プランでは上限を超えた D1 クエリはエラーを返すようになった**
（[Changelog](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/)）ため、
本番側の行読み取り量には別途注意が必要（→ 6.1 参照）。

**あわせて:**

- E2E を **PR でも走らせる**（smoke タグ 3〜4 本、2 分以内）。full は nightly。
- Playwright の project に `Mobile Chrome`（Pixel 5 相当、`hasTouch: true`）を追加。モバイルが主戦場なので。
- `DOM ノード数 < 150` は削除。軽量性を見たいなら Lighthouse/bundle size を CI で計測する。
- E2E のシナリオ名を「シナリオ N: 〜」から、検証する振る舞いそのものの名前に変える。

### 3.3 Worker 結合テスト（新設・最重要）

`@cloudflare/vitest-pool-workers` を導入し、**workerd 上で実 D1（miniflare）を使って Hono を実行**する。
これにより `tests/server/api.test.ts` の手書き偽装 D1 を廃止でき、以下が本物になる:

- `ON CONFLICT(url) DO UPDATE SET ... MIN(excluded.published_at, articles.published_at)` の公開日保持
- `ORDER BY score DESC LIMIT ? OFFSET ?` のページネーションと `COUNT(*)` の整合
- BLOB としてのベクトル往復（`serializeVector` / `deserializeVector`）
- スキーマは **`migrations/` から適用**する（＝本番と同じ定義でテストする）

同時に **スキーマ定義を `migrations/` の 1 本に集約**し、`src/server/db/schema.sql` と
`d1-sync.ts` の `SCHEMA_STATEMENTS` は migrations を読む形にするか削除する（P4 のドリフトを構造で解決）。

### 3.4 網羅性を「見て分かる」形にする

境界値は **`it.each` のテーブル駆動**で書き、表がそのまま仕様書になるようにする。例:

```ts
describe("calculateScoreFromSimilarity の区分境界", () => {
  it.each([
    // 類似度,  除外KW, 期待スコア, 意図
    [1.0,    false, 100, "上限"],
    [0.85,   false,  85, "最上位区分の下端"],
    [0.8499, false,  84, "最上位区分のすぐ下"],
    [0.80,   false,  65, "上位区分の下端"],
    [0.7999, false,  64, "上位区分のすぐ下"],
    [0.73,   false,  40, "中位区分の下端"],
    [0.7299, false,  39, "中位区分のすぐ下"],
    [0.50,   false,   0, "下限（クリップ）"],
    [0.00,   false,   0, "ゼロ"],
    [1.0,    true,   10, "除外KWありの上限"],
    [0.0,    true,    0, "除外KWありの下限"],
  ])("類似度 %s (除外KW: %s) は %s 点になること（%s）", (sim, excl, expected) => {
    expect(calculateScoreFromSimilarity(sim, excl)).toBe(expected);
  });
});
```

同様にテーブル駆動化すべき対象:

- JST 日付境界（`14:59:59Z` / `15:00:00Z` / 年跨ぎ / うるう日）を **`vi.setSystemTime` で固定**して、
  server・web の両方で（そもそも実装を `src/shared/date.ts` に一本化する）
- `limit` / `offset` の異常値（未指定 / `0` / 負値 / 非数値 / 巨大値）
- `extractEmbeddingVector` の入力 5 形状 + 不正形状
- スコアバッジの色分け閾値（80 / 79 / 60 / 59 / 40 / 39）

---

## 4. ファイル別の判定

| ファイル | 判定 | 理由・アクション |
|---|---|---|
| `tests/toolchain.test.ts` | **廃止（6件）** | 設定ファイルの自己言及。`mise install` / `pnpm install --frozen-lockfile` が CI で成功することが本来の検証。 |
| `tests/terraform.test.ts` | **廃止（15件）** | `terraform validate` / `fmt -check` は既に `ci.yml` にある。「Worker を Terraform に定義しない」設計意図は `main.tf` のコメントと AGENTS.md で足りる。 |
| `tests/workflows.test.ts` | **廃止（38件）** | `actionlint` + `pinact:check`（CI ステップ）へ置換。テスト内 `execSync("mise ...")` は環境依存で現に失敗している。 |
| `tests/pipeline/db.test.ts` | **廃止（15件）** | 死んだコードのテスト。**`src/pipeline/db.ts` をモジュールごと削除**し、`index.ts` からローカル SQLite 書き込みも外す（判断済み）。 |
| `tests/server/api.test.ts` | **作り直し（12件）** | 手書き偽装 D1 を廃止し、L3 Worker 結合（workerd + 実 D1 + migrations）へ移設。`limit/offset` 異常値・`extractEmbeddingVector` の全形状を追加。 |
| `tests/server/articles-db.test.ts` | **維持＋強化（20件）** | better-sqlite3 で実 SQL を叩いており健全。スキーマを `migrations/` から読むよう変更。`countArticlesByPublishedDate` の `offset` 超過ケース等を追加。 |
| `tests/pipeline/fetcher.test.ts` | **維持（45件）** | 本レビューで最も質が高い。公開日時フォールバック・未来日付・HTML 除去など境界が丁寧。`it.each` 化で更に読みやすくできる程度。 |
| `tests/pipeline/scorer.test.ts` | **強化（11件）** | 区分境界の下端が未検証。上記テーブル駆動へ。 |
| `tests/pipeline/embedder.test.ts` | **縮小（17件）** | `getExtractor` のシングルトン/DI テスト 5 件は実装詳細寄り。2 件程度に集約可。`l2Normalize` の境界は良い。 |
| `tests/pipeline/d1-sync.test.ts` | **維持（12件）** | SQL 長・プレースホルダ数一致・インジェクション・`MIN()` 保持など、実害に直結する良いテスト。 |
| `tests/pipeline/pipeline.test.ts` | **維持（9件）** | 重複排除・既存 URL スキップ・JST 照合期間は良い。L3 Pipeline へ移設。 |
| `tests/pipeline/config.test.ts` | **維持（11件）** | 妥当。ただし「実 `config/feeds.yaml` を読む」1 件は設定変更で落ちうるので、スキーマ検証のみに留める。 |
| `tests/web/components.test.tsx` | **維持＋分割（22件）** | 良好。ファイルをコンポーネント単位に分割し、`ArticleList` の空/エラー/追加読み込み中の状態網羅を追加。 |
| `tests/web/App.test.tsx` | **縮小（20件）** | ページめくり系 8 件は `daily-pager` / `use-horizontal-drag` と重複。App では「モード切替」「先読み」「キャッシュ」など App 固有の結線のみ残す。 |
| `tests/web/daily-pager.test.tsx` | **維持（16件）** | しきい値・フリック速度・抵抗・2本指と、細かな操作が網羅されていて良い。 |
| `tests/web/use-horizontal-drag.test.tsx` | **維持（14件）** | 同上。方向ロックの境界が丁寧。 |
| `tests/web/api-client.test.ts` | **維持（13件）** | エラー系のフォールバックまで見ていて良い。 |
| `tests/integration/embedding-model.test.ts` | **維持（10件）** | NaN/縮退/正規化を実モデルで確認する設計は正しい。依存更新時のみ走る運用も適切。 |
| `tests/e2e/news-site.spec.ts` | **作り直し（12件）** | モック撤廃 + `wrangler dev` + 実 D1 + 本番ビルド。PR で smoke を走らせる。DOM ノード数アサーションは削除。モバイル project 追加。 |

**差し引き:** 廃止 74 件、作り直し 24 件、新規（Worker 結合・境界値・無限スクロール等）で +40 件程度。
総数は 296 → 260 前後に減るが、**デグレード検知能力は大幅に上がる**。

---

## 5. 移行プラン（小さく確実に）

| Step | 内容 | 効果 |
|---|---|---|
| 1 | `toolchain` / `terraform` / `workflows` テスト削除 + `actionlint` を CI に追加 | 59 件削減、CI 安定化（現に落ちているケースの解消） |
| 2 | `src/pipeline/db.ts` と `db.test.ts` を削除し、`index.ts` からローカル SQLite 書き込みを除去。`better-sqlite3` の依存も見直し | 15 件削減、カバレッジの実態化、依存削減 |
| 3 | スキーマを `migrations/` に一本化。`schema.sql` / `SCHEMA_STATEMENTS` を統合 | 本番との乖離を構造的に解消 |
| 4 | JST 日付ロジックを `src/shared/date.ts` に集約し、固定時刻で境界テスト | 3 重実装の解消と最重要境界の担保 |
| 5 | `@cloudflare/vitest-pool-workers` で L3 Worker 結合を新設、`api.test.ts` を移設 | 実 SQL・実バインディングの検証を獲得 |
| 6 | 境界値のテーブル駆動化（スコア区分 / limit・offset / AI レスポンス形状 / バッジ色） | 網羅性が一目で分かる |
| 7 | E2E を `wrangler dev`（ローカル workerd + ローカル D1 + 本番ビルド）へ。PR で smoke（AI スタブ）、nightly で AI のみ remote binding の full | 「実環境に近い」の実現、デグレード検知。無料枠消費はほぼゼロ |
| 8 | ディレクトリを `unit / component / integration / e2e` に再編、カバレッジ閾値（`lines 90 / branches 80`、中核モジュールのみ 100%）を設定 | 方針がディレクトリ構造として自明になる |

### 5.1 補足: 本番側の D1 行読み取りに注意（テスト外の指摘）

`searchArticlesByVector` は **`WHERE embedding IS NOT NULL` で全記事を取得し、
コサイン類似度を Worker 側で計算している**（`src/server/db/articles.ts`）。
つまり **検索 1 回につき記事テーブルの全行を読む**。

2026-09-01 から Workers Free プランでは D1 の 1 日 500 万行読み取りを超えるとクエリがエラーになるため、
記事が蓄積するほど「検索 N 回 × 全記事数」で上限に近づく。
個人利用の頻度なら当面問題ないが、**アーカイブが 1 万件を超えたあたりから意識が必要**。
本レビューの対象外だが、無料枠を気にされているので併記する。
将来的な対策は Vectorize への移行か、`published_date_jst` での期間絞り込みなど。

---

## 6. AGENTS.md へ追記する規約案

```markdown
## 2. テスト規約 & 品質基準

* **テストの対象:**
  * テストは **プロダクトの振る舞い** のみを対象とする。
  * `package.json` / `mise.toml` / `*.tf` / `.github/workflows/*.yml` など、**リポジトリの設定ファイルの内容を
    文字列マッチで検証するテストを書いてはならない**。設定の妥当性は、そのツールを実際に実行する
    CI ステップ（`terraform validate` / `pinact:check` / `actionlint` / `wrangler deploy --dry-run`）で担保する。
  * `src` から参照されていないコード（死んだ export）にテストを書かない。見つけた場合はコードごと削除する。
* **レイヤーとモック境界:** 各テストは以下のいずれか 1 層に属し、モック境界はその層に定義されたもの 1 つのみとする。
  * L1 ユニット（`tests/unit`）: 純粋関数。モックなし。
  * L2 コンポーネント（`tests/component`）: React / フック。`api-client` のみモック。
  * L3 結合（`tests/integration`）: Worker は workerd + 実 D1（migrations 適用）。外部 HTTP と実モデルのみモック。
  * L4 E2E（`tests/e2e`）: `wrangler dev` + 実 D1 + 本番ビルド。**API のモックを禁止する。**
* **境界値:** 区分・閾値・日付境界を持つロジックは `it.each` によるテーブル駆動で記述し、
  各区分の上端・下端・直前直後を必ず含める。
* **同じ振る舞いを 2 層で重複検証しない。** 上位層は「経路が繋がっていること」のみを確認する。
```

---

## 7. 判断結果（2026-09-08 確定）

| # | 論点 | 判断 |
|---|---|---|
| 1 | `src/pipeline/db.ts`（ローカル SQLite）の扱い | **削除する。** モジュールごと消し、`src/pipeline/index.ts` からローカル DB 書き込みを除去。`better-sqlite3` は L3 Pipeline テストのヘルパーとしてのみ残るか、不要なら依存ごと削除。 |
| 2 | E2E での Workers AI の扱い | **2 段構えを採用（3.2 参照）。** PR は完全ローカル（AI スタブ、Cloudflare 利用量ゼロ）。nightly は **AI バインディングのみ** `remote: true`、D1 はローカルのまま。`wrangler dev --remote` による全リモート化は採らない。 |
| 3 | カバレッジ閾値 | **下限のみ CI ゲートにする。** 全体 `lines 90 / branches 80`、日付・スコアリングなど中核モジュールのみ 100%。数値そのものを目標にはしない。 |

**コスト面の結論:** PR ごとの E2E は 100% ローカルエミュレーション（workerd + Miniflare の D1）で
**無料枠を一切消費しない**。nightly も Workers AI を約 0.05 Neurons/日（無料枠 10,000 の 0.0005%）使うだけで、
実質的にコストゼロ。詳細な試算は 3.2 の表を参照。

---

## 9. 実装結果（2026-09-08）

### 9.1 数値

| 指標 | Before | After |
|---|---:|---:|
| 既定スイートのテスト数 | 296 | 312 |
| うち設定ファイル・死んだコードのテスト | 74 | **0** |
| Worker + 実 D1 の結合テスト | 0 | **40** |
| E2E シナリオ | 12（API 全モック） | **50**（モックなし、desktop + mobile） |
| カバレッジ (lines) | 93.29%（死んだコード込み） | **96.47%**（実コードのみ） |
| カバレッジ (branches) | 84.05% | **91.01%** |

### 9.2 新しい E2E が実際に見つけたバグ

`ArticleCard` は検索結果の日付バッジを `searchItem.date` から描画していたが、
**API が返すのは `published_date_jst` であり `date` は存在しない**。
つまり **本番では検索結果の日付バッジが一度も表示されていなかった**。

旧 E2E とユニットテストのモックだけが `date` を返していたため、
「モックが本物より親切」な状態になり、全テストが緑のまま不具合が残っていた。
本 PR で `SearchResultItem.date` を廃止し `published_date_jst` に統一、
回帰テストを追加している。

**P4（層の責務が重複し、肝心の結合層が空白）が実害を生んでいた実例。**

### 9.3 方針からの変更点

- **actionlint の導入は見送り。** mise でのバージョン解決をこの環境で検証できず、
  誤ったピンで CI 全体を落とすリスクがあるため。SHA 固定は既存の `pinact:check` で担保済み。
  なお、旧テストが検知していた「パイプで CI が緑になる」問題は、
  テストではなく **`ci.yml` からパイプ自体を排除**して構造的に解消した。
- **nightly の実 Workers AI は「1 行のコメントアウトを外せば有効」の状態まで用意し、既定は無効。**
  Cloudflare の認証情報をこの環境で検証できないため、未検証のまま有効化して
  nightly を赤くするより、利用者の判断で切り替えられる形にした。
- **`src/server/**` はカバレッジ計測の対象外。** workerd 上では V8 カバレッジを
  収集できないため（実測で 0% と出る）。品質は `pnpm test:worker` の 40 件で担保する。

