# ローカル多言語埋め込みスコアリング & UI 刷新 実装計画書 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gemini API を完全撤廃し、ローカル多言語埋め込みモデル（`multilingual-e5-small`）による興味関心スコアリング、URLからの `og:description` 補完、およびブラウザ翻訳に最適化した UI 刷新を実装する。

**Architecture:** 外部 API を一切使わず、すでに検索機能で活用している `@huggingface/transformers` (`intfloat/multilingual-e5-small`) でユーザーの関心キーワード（`profile.interests`）と記事のコサイン類似度を計算して 0〜100 点のスコアを瞬時に算出する。スニペットのない RSS 記事は URL から `og:description` を自動抽出し、UI はセマンティックな HTML でブラウザ自動翻訳に最適化する。

**Tech Stack:** TypeScript, Node.js 24 LTS, `@huggingface/transformers` (ONNX Runtime), `rss-parser`, React 19, Tailwind CSS 4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-19-local-embedding-scoring-and-ui-redesign.md`

## Global Constraints

- すべてのコマンド実行・テスト・ビルドには必ず `pnpm` のみを使用すること（`npm`, `npx` 等は使用禁止）。
- すべてのテストケース名（`describe`, `it`, `test` の第1引数）およびアサーションメッセージは **すべて日本語** で記述すること。
- TDD（テスト駆動開発）を徹底し、失敗するテスト（Red）を作成してから実装（Green）すること。
- コマンド実行は標準サンドボックスモード（`BypassSandbox: false`）で行うこと。

---

### Task 1: ローカル多言語埋め込みスコアリングモジュール (`src/pipeline/scorer.ts`) の実装

**Files:**
- Create: `src/pipeline/scorer.ts`
- Test: `tests/pipeline/scorer.test.ts`

**Interfaces:**
- Consumes: `src/pipeline/embedder.ts` (`getExtractor`, `formatPassageText`, `l2Normalize`), `src/shared/types.ts` (`UserProfile`)
- Produces: `scoreArticleWithProfile(title: string, snippet: string, profile: UserProfile, precomputedInterestVectors?: Map<string, Float32Array>, extractor?: any): Promise<{ score: number; maxSimilarity: number }>`, `precomputeInterestVectors(interests: string[], extractor?: any): Promise<Map<string, Float32Array>>`, `calculateScoreFromSimilarity(maxSimilarity: number, hasExcludeKeyword: boolean): number`

- [ ] **Step 1: 失敗するユニットテストを作成する**

Create `tests/pipeline/scorer.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import {
  calculateScoreFromSimilarity,
  precomputeInterestVectors,
  scoreArticleWithProfile,
} from "../../src/pipeline/scorer";
import { UserProfile } from "../../src/shared/types";

describe("ローカル多言語埋め込みスコアリングモジュール", () => {
  const mockProfile: UserProfile = {
    interests: ["TypeScript", "React", "Cloudflare", "AI Agents"],
    exclude_keywords: ["PR記事", "スポンサード", "セール"],
    scoring_guidelines: "",
  };

  describe("calculateScoreFromSimilarity - 類似度からスコアへのスケーリング", () => {
    it("類似度が 0.85 以上のとき、85〜100 点を返すこと", () => {
      expect(calculateScoreFromSimilarity(0.85, false)).toBe(85);
      expect(calculateScoreFromSimilarity(0.95, false)).toBeGreaterThanOrEqual(90);
      expect(calculateScoreFromSimilarity(1.0, false)).toBe(100);
    });

    it("類似度が 0.80〜0.84 のとき、65〜84 点を返すこと", () => {
      const score = calculateScoreFromSimilarity(0.82, false);
      expect(score).toBeGreaterThanOrEqual(65);
      expect(score).toBeLessThanOrEqual(84);
    });

    it("類似度が 0.73〜0.79 のとき、40〜64 点を返すこと", () => {
      const score = calculateScoreFromSimilarity(0.75, false);
      expect(score).toBeGreaterThanOrEqual(40);
      expect(score).toBeLessThanOrEqual(64);
    });

    it("類似度が 0.73 未満のとき、0〜39 点を返すこと", () => {
      const score = calculateScoreFromSimilarity(0.60, false);
      expect(score).toBeLessThanOrEqual(39);
      expect(score).toBeGreaterThanOrEqual(0);
    });

    it("除外キーワードが含まれる場合、類似度が高くても 10 点以下に減点されること", () => {
      expect(calculateScoreFromSimilarity(0.95, true)).toBeLessThanOrEqual(10);
    });
  });

  describe("scoreArticleWithProfile - 記事スコアリングの統合動作", () => {
    it("関心トピックに合致する記事が高いスコアを獲得すること", async () => {
      const mockExtractor = async (text: string) => {
        // TypeScript や React を含む場合は類似するベクトルを返すモック
        const isTs = text.includes("TypeScript") || text.includes("React");
        const vector = new Float32Array(384).fill(isTs ? 0.5 : 0.01);
        return { data: vector };
      };

      const result = await scoreArticleWithProfile(
        "TypeScript 5.5 新機能まとめ",
        "React との親和性が向上しました",
        mockProfile,
        undefined,
        mockExtractor,
      );

      expect(result.score).toBeGreaterThanOrEqual(65);
    });

    it("除外キーワードが含まれる記事は低スコアになること", async () => {
      const mockExtractor = async () => ({
        data: new Float32Array(384).fill(0.5),
      });

      const result = await scoreArticleWithProfile(
        "【PR記事】最新ツールの紹介",
        "スポンサードコンテンツです",
        mockProfile,
        undefined,
        mockExtractor,
      );

      expect(result.score).toBeLessThanOrEqual(10);
    });
  });
});
```

- [ ] **Step 2: テストを実行して失敗（Red）を確認する**

Run: `pnpm vitest run tests/pipeline/scorer.test.ts`
Expected: FAIL（モジュールが存在しないため）

- [ ] **Step 3: `src/pipeline/scorer.ts` を実装する**

Create `src/pipeline/scorer.ts`:
```typescript
import { UserProfile } from "../shared/types";
import { getExtractor, l2Normalize } from "./embedder";

/**
 * コサイン類似度（内積）を計算する
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * コサイン類似度と除外キーワード有無から 0〜100 点のスコアを算出する
 */
export function calculateScoreFromSimilarity(
  maxSimilarity: number,
  hasExcludeKeyword: boolean,
): number {
  if (hasExcludeKeyword) {
    return Math.min(10, Math.max(0, Math.round(maxSimilarity * 10)));
  }

  let score: number;
  if (maxSimilarity >= 0.85) {
    const ratio = Math.min(1, (maxSimilarity - 0.85) / 0.15);
    score = 85 + 15 * ratio;
  } else if (maxSimilarity >= 0.8) {
    const ratio = (maxSimilarity - 0.8) / 0.05;
    score = 65 + 19 * ratio;
  } else if (maxSimilarity >= 0.73) {
    const ratio = (maxSimilarity - 0.73) / 0.07;
    score = 40 + 24 * ratio;
  } else {
    const ratio = Math.max(0, (maxSimilarity - 0.5) / 0.23);
    score = 39 * ratio;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * ユーザー関心キーワード群の query ベクトルを事前計算する
 */
export async function precomputeInterestVectors(
  interests: string[],
  extractorParam?: any,
): Promise<Map<string, Float32Array>> {
  const extractor = extractorParam ?? (await getExtractor());
  const vectorMap = new Map<string, Float32Array>();

  for (const interest of interests) {
    if (!interest || !interest.trim()) continue;
    const text = `query: ${interest.trim()}`;
    const output = await extractor(text, { pooling: "mean", normalize: true });
    const rawData = output?.data ?? output;
    vectorMap.set(interest.trim(), l2Normalize(new Float32Array(rawData)));
  }

  return vectorMap;
}

/**
 * 記事のテキスト（タイトル＋抜粋）とユーザープロファイルを照合してスコアリングを行う
 */
export async function scoreArticleWithProfile(
  title: string,
  snippet: string,
  profile: UserProfile,
  precomputedVectors?: Map<string, Float32Array>,
  extractorParam?: any,
): Promise<{ score: number; maxSimilarity: number; articleVector: Float32Array }> {
  const extractor = extractorParam ?? (await getExtractor());

  // 1. 記事ベクトルの生成
  const passageText = `passage: ${title.trim()}\n${(snippet || "").trim()}`;
  const output = await extractor(passageText, { pooling: "mean", normalize: true });
  const rawData = output?.data ?? output;
  const articleVector = l2Normalize(new Float32Array(rawData));

  // 2. 関心ベクトルの準備
  const interestVectors =
    precomputedVectors ?? (await precomputeInterestVectors(profile.interests, extractor));

  // 3. 最大コサイン類似度の算出
  let maxSimilarity = 0;
  for (const [, targetVector] of interestVectors) {
    const sim = cosineSimilarity(articleVector, targetVector);
    if (sim > maxSimilarity) {
      maxSimilarity = sim;
    }
  }

  // 4. 除外キーワードの検出
  const fullText = `${title} ${snippet}`.toLowerCase();
  const hasExclude = profile.exclude_keywords.some(
    (kw) => kw.trim() && fullText.includes(kw.trim().toLowerCase()),
  );

  // 5. スコア計算
  const score = calculateScoreFromSimilarity(maxSimilarity, hasExclude);

  return { score, maxSimilarity, articleVector };
}
```

- [ ] **Step 4: テストを実行して成功（Green）を確認する**

Run: `pnpm vitest run tests/pipeline/scorer.test.ts`
Expected: PASS

- [ ] **Step 5: コミットする**

```bash
git add src/pipeline/scorer.ts tests/pipeline/scorer.test.ts
git commit -m "feat(pipeline): add local multilingual embedding scorer"
```

---

### Task 2: RSS フェッチャーにおける URL メタデータ (`og:description`) 自動補完の実装

**Files:**
- Modify: `src/pipeline/fetcher.ts`
- Modify: `tests/pipeline/fetcher.test.ts`

**Interfaces:**
- Consumes: `fetchFeedArticles(source, parser, customFetch?: typeof fetch)`
- Produces: `extractMetaDescription(html: string): string`, `fetchPageDescription(url: string, customFetch?: typeof fetch): Promise<string>`

- [ ] **Step 1: 失敗するユニットテストを作成する**

Update `tests/pipeline/fetcher.test.ts` to add tests for `extractMetaDescription` and `fetchPageDescription`:
```typescript
import {
  extractMetaDescription,
  fetchPageDescription,
  fetchFeedArticles,
} from "../../src/pipeline/fetcher";

describe("fetchPageDescription & extractMetaDescription", () => {
  it("og:description メタタグからコンテンツを抽出できること", () => {
    const html = `<html><head><meta property="og:description" content="This is an article about AI Agents and TypeScript."></head></html>`;
    expect(extractMetaDescription(html)).toBe("This is an article about AI Agents and TypeScript.");
  });

  it("meta name='description' からコンテンツを抽出できること", () => {
    const html = `<html><head><meta name="description" content="A comprehensive guide to Cloudflare Workers."></head></html>`;
    expect(extractMetaDescription(html)).toBe("A comprehensive guide to Cloudflare Workers.");
  });

  it("メタタグが存在しない場合は空文字を返すこと", () => {
    const html = `<html><head><title>No Description</title></head></html>`;
    expect(extractMetaDescription(html)).toBe("");
  });

  it("ネットワークエラーやタイムアウト時は安全に空文字を返すこと", async () => {
    const failingFetch: typeof fetch = async () => {
      throw new Error("Network timeout");
    };
    const desc = await fetchPageDescription("https://example.com/timeout", failingFetch);
    expect(desc).toBe("");
  });
});
```

- [ ] **Step 2: テストを実行して失敗（Red）を確認する**

Run: `pnpm vitest run tests/pipeline/fetcher.test.ts`
Expected: FAIL

- [ ] **Step 3: `src/pipeline/fetcher.ts` に実装を追加する**

Update `src/pipeline/fetcher.ts`:
```typescript
/**
 * HTML 文字列から og:description または meta description を抽出する
 */
export function extractMetaDescription(html: string): string {
  if (!html || typeof html !== "string") return "";

  // 1. og:description の抽出
  const ogMatch = html.match(
    /<meta\s+[^>]*?(?:property|name)=["'](?:og:description|twitter:description)["'][^>]*?content=["']([\s\S]*?)["'][^>]*?>/i,
  ) || html.match(
    /<meta\s+[^>]*?content=["']([\s\S]*?)["'][^>]*?(?:property|name)=["'](?:og:description|twitter:description)["'][^>]*?>/i,
  );
  if (ogMatch && ogMatch[1]) {
    return cleanText(ogMatch[1]);
  }

  // 2. meta name="description" の抽出
  const metaMatch = html.match(
    /<meta\s+[^>]*?name=["']description["'][^>]*?content=["']([\s\S]*?)["'][^>]*?>/i,
  ) || html.match(
    /<meta\s+[^>]*?content=["']([\s\S]*?)["'][^>]*?name=["']description["'][^>]*?>/i,
  );
  if (metaMatch && metaMatch[1]) {
    return cleanText(metaMatch[1]);
  }

  return "";
}

/**
 * 指定された URL の HTML を取得し、メタディスクリプションを抽出する（タイムアウト 5 秒）
 */
export async function fetchPageDescription(
  url: string,
  customFetch: typeof fetch = fetch,
): Promise<string> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await customFetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timeoutId);

    if (!response.ok) return "";
    const html = await response.text();
    return extractMetaDescription(html);
  } catch {
    return "";
  }
}
```

And in `fetchFeedArticles`, when `article.snippet` is empty, optionally enrich with `fetchPageDescription(article.url)`:
```typescript
export async function fetchFeedArticles(
  source: FeedSource,
  parser: Parser = defaultParser,
  customFetch?: typeof fetch,
): Promise<RawArticle[]> {
  try {
    const feed = await parser.parseURL(source.url);
    const items = feed?.items ?? [];
    const articles = items
      .map((item) => normalizeFeedItem(item, source.name))
      .filter((article) => Boolean(article.url && article.url.trim()));

    // snippet が空の記事について og:description の補完を試行
    for (const article of articles) {
      if (!article.snippet && article.url) {
        article.snippet = await fetchPageDescription(article.url, customFetch);
      }
    }

    return articles;
  } catch (error) {
    console.error(`フィード取得失敗 [${source.name} - ${source.url}]:`, error);
    return [];
  }
}
```

- [ ] **Step 4: テストを実行して成功（Green）を確認する**

Run: `pnpm vitest run tests/pipeline/fetcher.test.ts`
Expected: PASS

- [ ] **Step 5: コミットする**

```bash
git add src/pipeline/fetcher.ts tests/pipeline/fetcher.test.ts
git commit -m "feat(pipeline): add og:description metadata enrichment for RSS articles"
```

---

### Task 3: パイプライン統合と Gemini API 依存の完全削除

**Files:**
- Modify: `src/pipeline/index.ts`
- Delete: `src/pipeline/gemini.ts`
- Delete: `tests/pipeline/gemini.test.ts`
- Modify: `tests/pipeline/pipeline.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/fetch-and-score-pipeline.yml`

**Interfaces:**
- Consumes: `src/pipeline/scorer.ts`, `src/pipeline/fetcher.ts`, `src/pipeline/db.ts`, `src/pipeline/storage.ts`
- Produces: `runPipeline(options?: PipelineOptions): Promise<PipelineResult>`（`geminiApiKey` 依存完全削除、4.2s スリープ削除）

- [ ] **Step 1: `@google/genai` パッケージの削除**

Run: `pnpm remove @google/genai`

- [ ] **Step 2: `src/pipeline/index.ts` を Gemini API なし・ローカルスコアラー構成に更新**

Update `src/pipeline/index.ts`:
- Import `scoreArticleWithProfile`, `precomputeInterestVectors` from `./scorer`
- Remove `summarizeAndScoreArticle` and `gemini.ts` imports
- Precompute interest vectors at pipeline start: `const interestVectors = await precomputeInterestVectors(config.profile.interests, extractor);`
- In loop: calculate `{ score, articleVector } = await scoreArticleWithProfile(raw.title, raw.snippet, config.profile, interestVectors, extractor);`
- `article.summary = raw.snippet;`
- Remove all `sleep(4200)` calls!

- [ ] **Step 3: `tests/pipeline/pipeline.test.ts` を更新しテストする**

Update `tests/pipeline/pipeline.test.ts` to remove Gemini mocks and verify local scoring.
Run: `pnpm vitest run tests/pipeline/pipeline.test.ts`
Expected: PASS

- [ ] **Step 4: `src/pipeline/gemini.ts` と `tests/pipeline/gemini.test.ts` を削除**

Run: `rm -f src/pipeline/gemini.ts tests/pipeline/gemini.test.ts`

- [ ] **Step 5: `.github/workflows/fetch-and-score-pipeline.yml` から `GEMINI_API_KEY` を削除**

- [ ] **Step 6: コミットする**

```bash
git add .
git commit -m "refactor(pipeline): replace Gemini API with local multilingual-e5 scoring"
```

---

### Task 4: フロントエンド UI の刷新（`ArticleCard.tsx` / `App.tsx`）とブラウザ翻訳最適化

**Files:**
- Modify: `src/web/components/ArticleCard.tsx`
- Modify: `tests/web/components.test.tsx`
- Modify: `tests/web/App.test.tsx`

**Interfaces:**
- Consumes: `Article`, `SearchResultItem`
- Produces: UI component rendering clean title, source badge, score badge, snippet (line-clamp-2), and date without AI 3-line summary boxes.

- [ ] **Step 1: 失敗するコンポーネントテストを作成する**

Update `tests/web/components.test.tsx`:
- Test that `ArticleCard` displays `article.title`, `article.source_name`, `score`, and `article.summary` (as snippet)
- Verify "AI 3行要約" is no longer rendered

- [ ] **Step 2: `src/web/components/ArticleCard.tsx` を刷新する**

Update `ArticleCard.tsx`:
```tsx
import { Article, SearchResultItem } from "../../shared/types";
import { ExternalLink, Sparkles, Calendar, Tag } from "lucide-react";

export interface ArticleCardProps {
  article: Article | SearchResultItem;
}

function getScoreBadgeStyle(score: number): { container: string; label: string } {
  if (score >= 80) {
    return {
      container: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
      label: "高重要度",
    };
  }
  if (score >= 60) {
    return {
      container: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
      label: "注目",
    };
  }
  if (score >= 40) {
    return {
      container: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
      label: "標準",
    };
  }
  return {
    container: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30",
    label: "参考",
  };
}

function formatPublishedDate(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const mins = String(d.getMinutes()).padStart(2, "0");
    return `${year}/${month}/${day} ${hours}:${mins}`;
  } catch {
    return isoStr;
  }
}

export function ArticleCard({ article }: ArticleCardProps) {
  const isSearchResult =
    "similarity" in article && typeof (article as SearchResultItem).similarity === "number";
  const searchItem = isSearchResult ? (article as SearchResultItem) : null;
  const scoreStyle = getScoreBadgeStyle(article.score);

  return (
    <article
      data-testid="article-card"
      className="group relative flex flex-col justify-between rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 p-5 shadow-sm hover:shadow-md transition-all duration-200 hover:border-zinc-300 dark:hover:border-zinc-700"
    >
      <div>
        {/* メタ情報ヘッダー */}
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
              <Tag className="w-3 h-3 text-zinc-500" />
              {article.source_name}
            </span>

            {searchItem && searchItem.date && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                <Calendar className="w-3 h-3" />
                {searchItem.date}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* 類似度バッジ（検索時） */}
            {searchItem && (
              <span
                data-testid="similarity-badge"
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/30"
              >
                <Sparkles className="w-3 h-3" />
                一致度 {Math.round(searchItem.similarity * 100)}%
              </span>
            )}

            {/* スコアバッジ */}
            <span
              data-testid="score-badge"
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${scoreStyle.container}`}
            >
              スコア: {article.score}点
            </span>
          </div>
        </div>

        {/* 記事タイトル */}
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 leading-snug mb-2">
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group-hover:text-blue-600 dark:group-hover:text-blue-400 inline-flex items-start gap-1.5 transition-colors"
          >
            <span>{article.title}</span>
            <ExternalLink className="w-4 h-4 mt-0.5 flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" />
          </a>
        </h3>

        {/* 抜粋テキスト（スニペット） */}
        {article.summary && article.summary.trim().length > 0 && (
          <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-relaxed mb-3">
            {article.summary}
          </p>
        )}
      </div>

      {/* フッター（公開日時） */}
      <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/60 flex items-center justify-between text-xs text-zinc-400 dark:text-zinc-500">
        <span className="flex items-center gap-1">
          <Calendar className="w-3.5 h-3.5" />
          {formatPublishedDate(article.published_at)}
        </span>
      </div>
    </article>
  );
}
```

- [ ] **Step 3: テストを実行して成功（Green）を確認する**

Run: `pnpm vitest run tests/web/components.test.tsx tests/web/App.test.tsx`
Expected: PASS

- [ ] **Step 4: コミットする**

```bash
git add src/web/components/ArticleCard.tsx tests/web/components.test.tsx tests/web/App.test.tsx
git commit -m "feat(web): redesign ArticleCard for clean typography and browser translation"
```

---

### Task 5: ドキュメント更新と全体の品質・E2E検証

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `tests/workflows.test.ts`
- Test: `tests/e2e/news-site.spec.ts`

- [ ] **Step 1: `README.md` と `AGENTS.md` の更新**
  - `README.md`: `GEMINI_API_KEY` の記載を削除、ローカル多言語埋め込みスコアリングの説明に更新。
  - `AGENTS.md`: Gemini 15 RPM / 4.2s スリープのルールをローカル埋め込みスコアリングのルールに更新。

- [ ] **Step 2: `tests/workflows.test.ts` の更新**
  - `fetch-and-score-pipeline.yml` から `GEMINI_API_KEY` が削除されたことを反映。

- [ ] **Step 3: 全体品質チェックの実行**

Run: `pnpm check`
Expected: All typechecks, linters, and unit tests pass.

- [ ] **Step 4: Playwright E2E テストの実行**

Run: `pnpm test:e2e`
Expected: All E2E test scenarios pass.

- [ ] **Step 5: コミットする**

```bash
git add README.md AGENTS.md tests/workflows.test.ts
git commit -m "docs: update README and AGENTS.md for local embedding scoring"
```
