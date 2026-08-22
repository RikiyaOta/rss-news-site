# ローカル多言語埋め込みスコアリング & UI 刷新 設計仕様書 (Design Spec)

- **作成日:** 2026-08-19
- **ステータス:** 承認済み (Approved)

---

## 1. 概要 (Overview)

Gemini API の無料枠制限（15 RPM / 4200ms待機 / 429 Too Many Requests）に起因するボトルネックおよび運用依存を完全解消するため、以下のアーキテクチャ刷新を行う。

1. **Gemini API の完全撤廃:** 要約生成および外部 API への依存を廃止し、無料・完全ローカル・高速（実行時間数秒）なパイプラインへ移行。
2. **多言語ベクトル埋め込み（`multilingual-e5-small`）によるローカル興味関心スコアリング:** ユーザープロファイルの関心トピックベクトルと記事テキストのコサイン類似度から 0〜100 点のスコアをローカルで算出。
3. **スマートメタデータ抽出:** RSS フィードに抜粋がない記事（Hacker News 等）については、記事 URL から `og:description` / `<meta name="description">` を軽量フェッチして補完。
4. **フロントエンド UI の刷新 & ブラウザ翻訳最適化:** 「AI 3行要約」カードを廃止し、タイトルと短い抜粋（最大2行）を基調としたすっきりしたレイアウトへ刷新。ブラウザ標準翻訳機能（Chrome/Safari）で快適に閲覧できるセマンティックな HTML を採用。

---

## 2. アーキテクチャとパイプライン設計 (Architecture & Pipeline)

### 2.1 パイプライン処理フロー

```mermaid
flowchart TD
    A[RSS フィード巡回] --> B[記事の重複チェック]
    B --> C{抜粋があるか?}
    C -->|あり| D[テキスト整形]
    C -->|なし| E[URL から og:description を軽量フェッチ]
    E --> D
    D --> F[記事の多言語ベクトル埋め込み生成]
    G[profile.interests の関心ベクトル群] --> H[コサイン類似度スコアリング & 減点判定]
    F --> H
    H --> I[日別 SQLite DB (data/YYYY-MM-DD.db) 保存]
    F --> J[全体検索 SQLite DB (search_index.db) 保存]
    I --> K[Cloudflare R2 へ同期]
    J --> K
```

### 2.2 スコアリングアルゴリズム (`src/pipeline/scorer.ts`)

1. **関心ベクトルの生成:**
   * `profile.interests` の各トピックを `"query: <interest>"` 形式で `intfloat/multilingual-e5-small` (384次元, L2正規化) でベクトル化。
2. **記事テキストのベクトル化:**
   * 記事タイトル＋抜粋を `"passage: <title>\n<snippet>"` 形式でベクトル化。
3. **コサイン類似度計算:**
   * 記事ベクトル $\vec{a}$ と 各関心ベクトル $\vec{t}_i$ の内積 $s_i = \vec{a} \cdot \vec{t}_i$ を計算。
   * 最大類似度 $S_{\max} = \max_i(s_i)$ を抽出。
4. **スコア（0〜100点）へのスケーリング:**
   * $S_{\max} \ge 0.85 \implies \text{round}(85 + 15 \times \frac{S_{\max} - 0.85}{0.15}) \quad (85 \sim 100\text{点})$
   * $0.80 \le S_{\max} < 0.85 \implies \text{round}(65 + 20 \times \frac{S_{\max} - 0.80}{0.05}) \quad (65 \sim 84\text{点})$
   * $0.73 \le S_{\max} < 0.80 \implies \text{round}(40 + 25 \times \frac{S_{\max} - 0.73}{0.07}) \quad (40 \sim 64\text{点})$
   * $S_{\max} < 0.73 \implies \text{round}(40 \times \frac{\max(0, S_{\max} - 0.50)}{0.23}) \quad (0 \sim 39\text{点})$
5. **除外キーワードペナルティ:**
   * 記事タイトルまたは抜粋に `profile.exclude_keywords`（例: "PR記事", "スポンサード" 等）が含まれる場合、スコアを $\min(\text{score}, 10)$ に減点。

### 2.3 メタデータ自動補完 (`src/pipeline/fetcher.ts`)

* `raw.snippet` が空の場合、記事 URL に対して 5 秒タイムアウトの GET リクエストを発行。
* HTML 内から `meta[property="og:description"]` または `meta[name="description"]` を抽出。
* 失敗（403/404/タイムアウト）時は空文字のまま安全にフォールバック。

---

## 3. データモデルと SQLite スキーマ (Data Model)

### 3.1 `Article` インターフェース (`src/shared/types.ts`)

```typescript
export interface Article {
  id: string; // URLのSHA-256ハッシュ (先頭16文字)
  title: string; // 記事タイトル
  url: string; // 記事URL
  source_name: string; // フィード名 (例: "Zenn", "Hacker News")
  summary: string; // 概要・抜粋テキスト (RSS description または og:description)
  score: number; // 0〜100 の興味関心スコア (ローカル埋め込み類似度ベース)
  published_at: string; // ISO 8601 形式の公開日時
}
```

* **互換性:** `summary` カラムはそのまま「概要・抜粋テキスト」を保持するため、既存の SQLite DB 構造や Wasm クライアントとの互換性を完全維持。

---

## 4. フロントエンド UI & ブラウザ翻訳最適化 (Frontend UI)

### 4.1 `ArticleCard` コンポーネント (`src/web/components/ArticleCard.tsx`)

* **レイアウト:**
  * **Header:** `source_name` バッジ / 検索時の一致度バッジ（`Sparkles`） / スコアバッジ（80点以上: 🟢高重要度, 60点以上: 🔵注目, 40点以上: 🟡標準, 40点未満: ⚪参考）
  * **Title:** 大きめのフォント（`text-base font-semibold`）とゆったりした行間。外部リンクアイコン付き。
  * **Snippet:** 抜粋が存在する場合、最大2行（`line-clamp-2`）で落ち着いたテキスト色（`text-zinc-600 dark:text-zinc-400`）で表示。
  * **Footer:** 公開日時の表示（`YYYY/MM/DD HH:mm`）。
* **ブラウザ翻訳親和性:**
  * タイトルや抜粋の文中に余計な装飾タグを挿入せず、Google Chrome や Safari の「日本語に翻訳」機能で文脈が途切れずに自然に全文翻訳されるマークアップ構造。

---

## 5. ワークフローと依存関係の変更 (Workflows & Dependencies)

1. **パッケージ依存:**
   * `package.json` から `@google/genai` を削除。
2. **GitHub Actions ワークフロー:**
   * `.github/workflows/fetch-and-score-pipeline.yml` から `GEMINI_API_KEY` の環境変数を完全削除。
3. **ドキュメント更新:**
   * `README.md` のシークレット一覧から `GEMINI_API_KEY` を削除し、Gemini API 制限に関する記載をローカル多言語スコアリングの説明に更新。
   * `AGENTS.md` の 15 RPM / 4.2s スリープ規定を更新。

---

## 6. テスト計画 (Testing Strategy)

* **`tests/pipeline/scorer.test.ts` (新規):**
  * 各種関心キーワード（TypeScript, React, LLM 等）に対する類似度計算と 0〜100 点へのスケーリング検証
  * 除外キーワードによる減点（10点以下）の動作検証
  * 日本語・英語双方の記事に対するスコアリング検証
* **`tests/pipeline/fetcher.test.ts`:**
  * `og:description` / `meta description` の抽出およびフォールバック処理の検証
* **`tests/pipeline/pipeline.test.ts`:**
  * Gemini API 呼び出しなしでのパイプライン全体の実行（高速化、DB保存、R2同期）検証
* **`tests/web/components.test.tsx` & `tests/web/App.test.tsx`:**
  * 「AI 3行要約」のない新しいカードレイアウト、スニペット表示、スコアバッジのレンダリング検証
* **E2E テスト (`tests/e2e/news-site.spec.ts`):**
  * Playwright による記事一覧の表示、セマンティック検索、レスポンシブ表示の検証
