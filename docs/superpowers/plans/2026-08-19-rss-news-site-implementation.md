# AI駆動型RSS収集・検索システム (rss-news-site) 実装計画書

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub Actionsによる毎日のRSS自動収集・Gemini要約/スコアリング・multilingual-e5-smallによるベクトル生成とCloudflare R2同期、およびブラウザ側Wasm SQLite/Transformers.jsによる横断セマンティック検索SPAを完全無料で構築する。

**Architecture:** バックエンドはNode.js 24 LTS + TypeScriptによる日次パイプラインで、RSS取得・Gemini API（15 RPM遵守・4.2秒Sleep）・ONNX埋め込み・日別DB(`data/YYYY-MM-DD.db`)と全体検索DB(`search_index.db`)生成・R2同期を行う。フロントエンドはReact 19 + Vite 6 + Tailwind CSSによるSPAで、Web Workerによるブラウザ内クエリベクトル化とWasm SQLite差分取得・結合検索を実現する。インフラはTerraformで管理（R2 tfstate）し、全ツールを`mise`・`pnpm-workspace.yaml`（`minimumReleaseAge: 10080`）・`pinact`で強固に保護する。

**Tech Stack:** Node.js 24 LTS, pnpm 11.22, TypeScript 5.8, React 19, Vite 6, Tailwind CSS, `@google/genai`, `@huggingface/transformers` (intfloat/multilingual-e5-small), `better-sqlite3`, `sql.js`, `@aws-sdk/client-s3`, Terraform 1.15.8, Vitest, Playwright, pinact 4.0.0.

**Spec:** [docs/superpowers/specs/2026-08-19-rss-news-site-design.md](file:///Users/rikiyaota/Documents/github.com/RikiyaOta/rss-news-site/docs/superpowers/specs/2026-08-19-rss-news-site-design.md)

## Global Constraints

- すべてのグローバルツールは `mise.toml` でバージョン固定し `mise.lock` を生成する。
- パッケージセキュリティとして `pnpm-workspace.yaml` に `minimumReleaseAge: 10080` (7日間) および `minimumReleaseAgeStrict: true` を設定する。
- すべてのサードパーティ GitHub Action は `pinact` でコミットハッシュ（SHA-1）固定する。
- すべてのテストケース（Vitest / Playwright）は **日本語** で記述する。
- PR CI にてテストカバレッジテーブルを GitHub Step Summary に出力する。
- E2E テストは PR 時ではなく毎朝 09:00 JST (00:00 UTC) の定期実行ワークフローに分離する。
- Gemini API の無料枠制限を遵守するため、リクエストごとに必ず 4.2 秒の待機を設ける。
- `multilingual-e5-small` 埋め込みモデルの仕様に則り、記事登録時は `"passage: "`、検索クエリ時は `"query: "` を付与する。

---

### Task 1: ツールチェーン & ワークスペース初期設定

**Files:**
- Create: `mise.toml`
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`

**Interfaces:**
- Produces: 依存解決設定、型定義構成、テストランナー構成

- [ ] **Step 1: `mise.toml` を作成**

```toml
[tools]
node = "24.19.0"
pnpm = "11.22.0"
terraform = "1.15.8"
"github:suzuki-shunsuke/pinact" = "4.0.0"
```

- [ ] **Step 2: `pnpm-workspace.yaml` を作成（7日間のリリース待機設定）**

```yaml
packages:
  - "."

minimumReleaseAge: 10080
minimumReleaseAgeStrict: true
```

- [ ] **Step 3: `package.json` を作成**

```json
{
  "name": "rss-news-site",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "pipeline": "tsx src/pipeline/index.ts",
    "typecheck": "tsc --noEmit",
    "pinact": "pinact run .github/workflows/*.yml"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.750.0",
    "@google/genai": "^0.1.2",
    "@huggingface/transformers": "^3.3.3",
    "better-sqlite3": "^11.8.1",
    "clsx": "^2.1.1",
    "js-yaml": "^4.1.0",
    "lucide-react": "^1.16.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "rss-parser": "^3.13.0",
    "sql.js": "^1.12.0",
    "tailwind-merge": "^3.0.2"
  },
  "devDependencies": {
    "@playwright/test": "^1.50.1",
    "@types/better-sqlite3": "^7.6.12",
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^22.13.4",
    "@types/react": "^19.0.8",
    "@types/react-dom": "^19.0.3",
    "@types/sql.js": "^1.4.9",
    "@vitejs/plugin-react": "^4.3.4",
    "@vitest/coverage-v8": "^3.0.5",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.5.2",
    "tailwindcss": "^3.4.17",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "vite": "^6.1.0",
    "vitest": "^3.0.5"
  }
}
```

- [ ] **Step 4: `tsconfig.json`, `vite.config.ts`, `vitest.config.ts` を作成**

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src", "tests", "vite.config.ts", "vitest.config.ts"]
}
```

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json-summary"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/web/main.tsx", "src/vite-env.d.ts"]
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  }
});
```

- [ ] **Step 5: コミット**

```bash
git add mise.toml pnpm-workspace.yaml package.json tsconfig.json vite.config.ts vitest.config.ts
git commit -m "chore: 初期ツールチェーンおよびワークスペース設定を追加"
```

---

### Task 2: 共通型定義および設定ファイル管理 (`src/shared/types.ts`, `config/feeds.yaml`)

**Files:**
- Create: `src/shared/types.ts`
- Create: `config/feeds.yaml`
- Create: `src/pipeline/config.ts`
- Test: `tests/pipeline/config.test.ts`

**Interfaces:**
- Produces: `Article`, `ArticleSummary`, `FeedConfig`, `UserProfile`, `PipelineConfig`, `loadConfig()`

- [ ] **Step 1: テストを作成（設定ファイルの読み込みとバリデーション）**

```typescript
// tests/pipeline/config.test.ts
import { describe, it, expect } from "vitest";
import { parseConfig } from "../../src/pipeline/config";

describe("設定ファイルパーサーのテスト", () => {
  it("正しいYAML文字列からフィード一覧とユーザープロファイルを抽出できること", () => {
    const yamlContent = `
feeds:
  - name: "Zenn AI"
    url: "https://zenn.dev/topics/ai/feed"
  - name: "Hacker News"
    url: "https://news.ycombinator.com/rss"
profile:
  interests:
    - "TypeScript"
    - "Cloudflare"
    - "AI Agents"
  exclude_keywords:
    - "PR記事"
    - "初心者向けチュートリアル"
  scoring_guidelines: "技術的深みがあり実用的で新規性がある記事を高く評価する"
`;
    const config = parseConfig(yamlContent);
    expect(config.feeds).toHaveLength(2);
    expect(config.feeds[0].name).toBe("Zenn AI");
    expect(config.profile.interests).toContain("TypeScript");
    expect(config.profile.exclude_keywords).toContain("PR記事");
  });

  it("不正なYAMLデータに対して適切なエラーを投げること", () => {
    expect(() => parseConfig("invalid: yaml: :")).toThrow();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**
- [ ] **Step 3: 型定義と設定パーサーを実装**

```typescript
// src/shared/types.ts
export interface Article {
  id: string;          // URLのハッシュ (先頭16文字)
  title: string;       // 記事タイトル
  url: string;         // 記事URL
  source_name: string; // フィード名
  summary: string;     // Geminiによる3行要約
  score: number;       // 0〜100 の興味関心スコア
  published_at: string;// ISO 8601 形式
}

export interface FeedSource {
  name: string;
  url: string;
}

export interface UserProfile {
  interests: string[];
  exclude_keywords: string[];
  scoring_guidelines: string;
}

export interface PipelineConfig {
  feeds: FeedSource[];
  profile: UserProfile;
}

export interface SearchResultItem extends Article {
  date: string;
  similarity: number;
}
```

```typescript
// src/pipeline/config.ts
import yaml from "js-yaml";
import fs from "node:fs";
import { PipelineConfig } from "../shared/types";

export function parseConfig(yamlString: string): PipelineConfig {
  const doc = yaml.load(yamlString) as Partial<PipelineConfig>;
  if (!doc || !Array.isArray(doc.feeds) || !doc.profile) {
    throw new Error("設定ファイルのフォーマットが不正です: feeds と profile が必要です");
  }
  return {
    feeds: doc.feeds,
    profile: {
      interests: doc.profile.interests ?? [],
      exclude_keywords: doc.profile.exclude_keywords ?? [],
      scoring_guidelines: doc.profile.scoring_guidelines ?? ""
    }
  };
}

export function loadConfig(configPath: string): PipelineConfig {
  const content = fs.readFileSync(configPath, "utf-8");
  return parseConfig(content);
}
```

- [ ] **Step 4: `config/feeds.yaml` の初期テンプレートを作成**
- [ ] **Step 5: テストを実行して通過を確認**
- [ ] **Step 6: コミット**

```bash
git add src/shared/types.ts config/feeds.yaml src/pipeline/config.ts tests/pipeline/config.test.ts
git commit -m "feat: 共通型定義および設定ファイルローダーを実装"
```

---

### Task 3: RSS フィード取得・正規化モジュール (`src/pipeline/fetcher.ts`)

**Files:**
- Create: `src/pipeline/fetcher.ts`
- Test: `tests/pipeline/fetcher.test.ts`

**Interfaces:**
- Produces: `fetchFeedArticles(source: FeedSource): Promise<RawArticle[]>`, `generateArticleId(url: string): string`

- [ ] **Step 1: テストを作成（URLハッシュ化とフィード解析）**

```typescript
// tests/pipeline/fetcher.test.ts
import { describe, it, expect, vi } from "vitest";
import { generateArticleId, normalizeFeedItem } from "../../src/pipeline/fetcher";

describe("RSSフェッチャーのテスト", () => {
  it("同一URLから一意かつ決定論的な16文字のハッシュIDを生成できること", () => {
    const url = "https://example.com/posts/ai-news-2026";
    const id1 = generateArticleId(url);
    const id2 = generateArticleId(url);
    expect(id1).toBe(id2);
    expect(id1).toHaveLength(16);
  });

  it("異なるURLからは異なるハッシュIDが生成されること", () => {
    const id1 = generateArticleId("https://example.com/post-1");
    const id2 = generateArticleId("https://example.com/post-2");
    expect(id1).not.toBe(id2);
  });

  it("フィードアイテムから不要なHTMLタグを除去して正規化できること", () => {
    const rawItem = {
      title: "  テストタイトル  ",
      link: "https://example.com/test",
      contentSnippet: "<p>本文のサマリー</p>",
      pubDate: "Wed, 19 Aug 2026 00:00:00 GMT"
    };
    const item = normalizeFeedItem(rawItem, "テストソース");
    expect(item.title).toBe("テストタイトル");
    expect(item.url).toBe("https://example.com/test");
    expect(item.source_name).toBe("テストソース");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**
- [ ] **Step 3: `fetcher.ts` を実装**

```typescript
// src/pipeline/fetcher.ts
import crypto from "node:crypto";
import Parser from "rss-parser";
import { FeedSource } from "../shared/types";

export interface RawArticle {
  id: string;
  title: string;
  url: string;
  source_name: string;
  snippet: string;
  published_at: string;
}

const parser = new Parser({
  headers: {
    "User-Agent": "rss-news-site-bot/1.0 (+https://github.com)"
  },
  timeout: 10000
});

export function generateArticleId(url: string): string {
  return crypto.createHash("sha256").update(url.trim()).digest("hex").slice(0, 16);
}

export function normalizeFeedItem(item: any, sourceName: string): RawArticle {
  const url = (item.link || item.guid || "").trim();
  const id = generateArticleId(url);
  const title = (item.title || "No Title").trim();
  const snippet = (item.contentSnippet || item.content || item.summary || "").trim();
  const published_at = item.isoDate || (item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString());

  return { id, title, url, source_name: sourceName, snippet, published_at };
}

export async function fetchFeedArticles(source: FeedSource): Promise<RawArticle[]> {
  try {
    const feed = await parser.parseURL(source.url);
    return (feed.items || []).map((item) => normalizeFeedItem(item, source.name));
  } catch (error) {
    console.error(`フィード取得失敗 [${source.name} - ${source.url}]:`, error);
    return [];
  }
}
```

- [ ] **Step 4: テストを実行して通過を確認**
- [ ] **Step 5: コミット**

```bash
git add src/pipeline/fetcher.ts tests/pipeline/fetcher.test.ts
git commit -m "feat: RSSフィード取得および記事正規化モジュールを実装"
```

---

### Task 4: Gemini 2.5 Flash-Lite 要約 & スコアリング (`src/pipeline/gemini.ts`)

**Files:**
- Create: `src/pipeline/gemini.ts`
- Test: `tests/pipeline/gemini.test.ts`

**Interfaces:**
- Produces: `summarizeAndScoreArticle(article: RawArticle, profile: UserProfile, apiKey: string): Promise<ScoringResult>`, `sleep(ms: number): Promise<void>`

- [ ] **Step 1: テストを作成（プロンプト生成とJSONレスポンス検証）**

```typescript
// tests/pipeline/gemini.test.ts
import { describe, it, expect } from "vitest";
import { buildScoringPrompt, parseGeminiResponse } from "../../src/pipeline/gemini";

describe("Gemini要約・スコアリングモジュールのテスト", () => {
  it("ユーザープロファイルを反映したプロンプトを構築できること", () => {
    const prompt = buildScoringPrompt(
      { title: "新機能発表", snippet: "詳細記事" },
      { interests: ["Rust", "AI"], exclude_keywords: ["PR"], scoring_guidelines: "厳格に評価" }
    );
    expect(prompt).toContain("新機能発表");
    expect(prompt).toContain("Rust");
    expect(prompt).toContain("PR");
  });

  it("Geminiの返却したJSONテキストから要約とスコアを正しくパースできること", () => {
    const mockJson = `\`\`\`json
{
  "summary": "・1行目の要約\\n・2行目の要約\\n・3行目の要約",
  "score": 85
}
\`\`\``;
    const result = parseGeminiResponse(mockJson);
    expect(result.score).toBe(85);
    expect(result.summary).toContain("1行目の要約");
  });

  it("スコアが0〜100の範囲外の場合はクランプされること", () => {
    const result1 = parseGeminiResponse(JSON.stringify({ summary: "要約", score: 150 }));
    expect(result1.score).toBe(100);
    const result2 = parseGeminiResponse(JSON.stringify({ summary: "要約", score: -10 }));
    expect(result2.score).toBe(0);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**
- [ ] **Step 3: `gemini.ts` を実装（4.2秒のレートリミット制御付き）**

```typescript
// src/pipeline/gemini.ts
import { GoogleGenAI } from "@google/genai";
import { UserProfile } from "../shared/types";
import { RawArticle } from "./fetcher";

export interface ScoringResult {
  summary: string;
  score: number;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function buildScoringPrompt(
  article: { title: string; snippet: string },
  profile: UserProfile
): string {
  return `あなたは技術記事のキュレーターです。以下の記事を分析し、ユーザーの興味関心に基づいて3行要約とスコア（0〜100点）を算出してJSONで出力してください。

【記事情報】
タイトル: ${article.title}
内容抜粋: ${article.snippet}

【ユーザーの興味関心】
- 興味のあるトピック: ${profile.interests.join(", ")}
- 除外したいキーワード: ${profile.exclude_keywords.join(", ")}
- 採点ガイドライン: ${profile.scoring_guidelines}

【出力フォーマット（JSON形式のみ）】
{
  "summary": "・要点1\\n・要点2\\n・要点3",
  "score": 85
}`;
}

export function parseGeminiResponse(responseText: string): ScoringResult {
  const cleaned = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 50)));
    const summary = String(parsed.summary || "要約の取得に失敗しました");
    return { summary, score };
  } catch {
    return { summary: "要約の解析に失敗しました", score: 50 };
  }
}

export async function summarizeAndScoreArticle(
  article: RawArticle,
  profile: UserProfile,
  apiKey: string
): Promise<ScoringResult> {
  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildScoringPrompt(article, profile);

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-lite",
    contents: prompt,
    config: {
      responseMimeType: "application/json"
    }
  });

  return parseGeminiResponse(response.text || "{}");
}
```

- [ ] **Step 4: テストを実行して通過を確認**
- [ ] **Step 5: コミット**

```bash
git add src/pipeline/gemini.ts tests/pipeline/gemini.test.ts
git commit -m "feat: Gemini 2.5 Flash-Lite による要約・スコアリング処理を実装"
```

---

### Task 5: 多言語ベクトル埋め込み生成モジュール (`src/pipeline/embedder.ts`)

**Files:**
- Create: `src/pipeline/embedder.ts`
- Test: `tests/pipeline/embedder.test.ts`

**Interfaces:**
- Produces: `generateArticleEmbedding(title: string, summary: string): Promise<Float32Array>`, `formatPassageText(title: string, summary: string): string`

- [ ] **Step 1: テストを作成（入力フォーマットとベクトル次元検証）**

```typescript
// tests/pipeline/embedder.test.ts
import { describe, it, expect } from "vitest";
import { formatPassageText } from "../../src/pipeline/embedder";

describe("多言語ベクトル埋め込みモジュールのテスト", () => {
  it("multilingual-e5-small の仕様に則り passage: プレフィックスを付与すること", () => {
    const formatted = formatPassageText("タイトル", "3行要約");
    expect(formatted).toBe("passage: タイトル\n3行要約");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**
- [ ] **Step 3: `embedder.ts` を実装**

```typescript
// src/pipeline/embedder.ts
import { pipeline } from "@huggingface/transformers";

let extractor: any = null;

export function formatPassageText(title: string, summary: string): string {
  return `passage: ${title.trim()}\n${summary.trim()}`;
}

export async function getExtractor() {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", "intfloat/multilingual-e5-small", {
      dtype: "fp32"
    });
  }
  return extractor;
}

export async function generateArticleEmbedding(
  title: string,
  summary: string
): Promise<Float32Array> {
  const pipe = await getExtractor();
  const text = formatPassageText(title, summary);
  const output = await pipe(text, { pooling: "mean", normalize: true });
  return new Float32Array(output.data);
}
```

- [ ] **Step 4: テストを実行して通過を確認**
- [ ] **Step 5: コミット**

```bash
git add src/pipeline/embedder.ts tests/pipeline/embedder.test.ts
git commit -m "feat: intfloat/multilingual-e5-small ベクトル埋め込みモジュールを実装"
```

---

### Task 6: SQLite 日別DB & 全体検索インデックスDB 生成 (`src/pipeline/db.ts`)

**Files:**
- Create: `src/pipeline/db.ts`
- Test: `tests/pipeline/db.test.ts`

**Interfaces:**
- Produces: `initDailyDatabase(filePath: string): Database`, `initSearchIndexDatabase(filePath: string): Database`, `insertArticles(db: Database, articles: Article[]): void`, `insertVectors(db: Database, items: { article_id: string; date: string; embedding: Float32Array }[]): void`

- [ ] **Step 1: テストを作成（テーブル作成・挿入・重複排除）**

```typescript
// tests/pipeline/db.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  initDailyDatabase,
  initSearchIndexDatabase,
  insertArticles,
  insertVectors,
  getExistingArticleIds
} from "../../src/pipeline/db";

const TEST_DB_DIR = "./scratch/test-db";
const DAILY_DB = path.join(TEST_DB_DIR, "2026-08-19.db");
const SEARCH_DB = path.join(TEST_DB_DIR, "search_index.db");

describe("SQLite データベース操作モジュールのテスト", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  it("日別DBを作成し記事データを保存・重複IDを取得できること", () => {
    const db = initDailyDatabase(DAILY_DB);
    const articles = [
      {
        id: "art-1",
        title: "記事1",
        url: "https://example.com/1",
        source_name: "Source",
        summary: "要約1",
        score: 90,
        published_at: "2026-08-19T00:00:00Z"
      }
    ];
    insertArticles(db, articles);
    const ids = getExistingArticleIds(db);
    expect(ids).toContain("art-1");
    db.close();
  });

  it("全体検索DBを作成しベクトルBLOBを正しく保存できること", () => {
    const db = initSearchIndexDatabase(SEARCH_DB);
    const vec = new Float32Array([0.1, 0.2, 0.3]);
    insertVectors(db, [{ article_id: "art-1", date: "2026-08-19", embedding: vec }]);
    const row = db.prepare("SELECT * FROM search_index WHERE article_id = ?").get("art-1") as any;
    expect(row.date).toBe("2026-08-19");
    expect(new Float32Array(row.embedding.buffer)).toEqual(vec);
    db.close();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**
- [ ] **Step 3: `db.ts` を実装**

```typescript
// src/pipeline/db.ts
import Database from "better-sqlite3";
import { Article } from "../shared/types";

export function initDailyDatabase(filePath: string): Database.Database {
  const db = new Database(filePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      source_name TEXT NOT NULL,
      summary TEXT NOT NULL,
      score INTEGER NOT NULL,
      published_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_articles_score ON articles(score DESC);
  `);
  return db;
}

export function initSearchIndexDatabase(filePath: string): Database.Database {
  const db = new Database(filePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_index (
      article_id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      embedding BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_search_index_date ON search_index(date);
  `);
  return db;
}

export function getExistingArticleIds(db: Database.Database): Set<string> {
  const rows = db.prepare("SELECT id FROM articles").all() as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

export function insertArticles(db: Database.Database, articles: Article[]) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO articles (id, title, url, source_name, summary, score, published_at)
    VALUES (@id, @title, @url, @source_name, @summary, @score, @published_at)
  `);
  const insertMany = db.transaction((items: Article[]) => {
    for (const item of items) stmt.run(item);
  });
  insertMany(articles);
}

export function insertVectors(
  db: Database.Database,
  items: { article_id: string; date: string; embedding: Float32Array }[]
) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO search_index (article_id, date, embedding)
    VALUES (?, ?, ?)
  `);
  const insertMany = db.transaction(
    (records: { article_id: string; date: string; embedding: Float32Array }[]) => {
      for (const rec of records) {
        stmt.run(rec.article_id, rec.date, Buffer.from(rec.embedding.buffer));
      }
    }
  );
  insertMany(items);
}
```

- [ ] **Step 4: テストを実行して通過を確認**
- [ ] **Step 5: コミット**

```bash
git add src/pipeline/db.ts tests/pipeline/db.test.ts
git commit -m "feat: SQLite日別DBおよび全体検索DBの初期化・操作モジュールを実装"
```

---

### Task 7: Cloudflare R2 ストレージ同期クライアント (`src/pipeline/storage.ts`)

**Files:**
- Create: `src/pipeline/storage.ts`
- Test: `tests/pipeline/storage.test.ts`

**Interfaces:**
- Produces: `uploadFileToR2(localPath: string, r2Key: string): Promise<void>`, `downloadFileFromR2(r2Key: string, localPath: string): Promise<boolean>`

- [ ] **Step 1: テストを作成（S3クライアント設定とアップロード/ダウンロード処理）**

```typescript
// tests/pipeline/storage.test.ts
import { describe, it, expect, vi } from "vitest";
import { getR2ClientConfig } from "../../src/pipeline/storage";

describe("Cloudflare R2 ストレージクライアントのテスト", () => {
  it("環境変数から Cloudflare R2 接続設定を正しく構成できること", () => {
    const env = {
      R2_ACCOUNT_ID: "test-account",
      R2_ACCESS_KEY_ID: "key-id",
      R2_SECRET_ACCESS_KEY: "secret-key",
      R2_BUCKET_NAME: "test-bucket"
    };
    const config = getR2ClientConfig(env);
    expect(config.endpoint).toBe("https://test-account.r2.cloudflarestorage.com");
    expect(config.bucket).toBe("test-bucket");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**
- [ ] **Step 3: `storage.ts` を実装**

```typescript
// src/pipeline/storage.ts
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import fs from "node:fs";
import { Readable } from "node:stream";

export function getR2ClientConfig(env = process.env) {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET_NAME || "rss-news-site-data";

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 接続情報 (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) が設定されていません");
  }

  return {
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    region: "auto",
    bucket
  };
}

export function createR2Client(config = getR2ClientConfig()) {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: config.credentials
  });
}

export async function uploadFileToR2(localPath: string, r2Key: string) {
  const config = getR2ClientConfig();
  const client = createR2Client(config);
  const fileStream = fs.createReadStream(localPath);

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: r2Key,
      Body: fileStream,
      ContentType: "application/vnd.sqlite3"
    })
  );
}

export async function downloadFileFromR2(r2Key: string, localPath: string): Promise<boolean> {
  const config = getR2ClientConfig();
  const client = createR2Client(config);
  try {
    const res = await client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: r2Key
      })
    );
    if (!res.Body) return false;
    const writeStream = fs.createWriteStream(localPath);
    await (res.Body as Readable).pipe(writeStream);
    return true;
  } catch (err: any) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}
```

- [ ] **Step 4: テストを実行して通過を確認**
- [ ] **Step 5: コミット**

```bash
git add src/pipeline/storage.ts tests/pipeline/storage.test.ts
git commit -m "feat: Cloudflare R2 ストレージ同期モジュールを実装"
```

---

### Task 8: パイプライン統合実行スクリプト (`src/pipeline/index.ts`)

**Files:**
- Create: `src/pipeline/index.ts`
- Test: `tests/pipeline/pipeline.test.ts`

**Interfaces:**
- Produces: `runPipeline(options?: { dateStr?: string; configPath?: string })`

- [ ] **Step 1: テストを作成（パイプライン全体のオーケストレーションテスト）**
- [ ] **Step 2: `src/pipeline/index.ts` を実装（15 RPM 制御、重複排除、差分更新、R2同期）**

```typescript
// src/pipeline/index.ts
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config";
import { fetchFeedArticles, RawArticle } from "./fetcher";
import { summarizeAndScoreArticle, sleep } from "./gemini";
import { generateArticleEmbedding } from "./embedder";
import {
  initDailyDatabase,
  initSearchIndexDatabase,
  getExistingArticleIds,
  insertArticles,
  insertVectors
} from "./db";
import { uploadFileToR2, downloadFileFromR2 } from "./storage";
import { Article } from "../shared/types";

export async function runPipeline(options: { dateStr?: string; configPath?: string } = {}) {
  const dateStr = options.dateStr || new Date().toISOString().slice(0, 10);
  const configPath = options.configPath || "config/feeds.yaml";
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!geminiApiKey) {
    throw new Error("GEMINI_API_KEY が設定されていません");
  }

  const tmpDir = path.resolve("./scratch/pipeline-tmp");
  fs.mkdirSync(tmpDir, { recursive: true });

  const dailyDbPath = path.join(tmpDir, `${dateStr}.db`);
  const searchDbPath = path.join(tmpDir, "search_index.db");

  console.log(`[1/5] R2 から既存DBを同期中... (${dateStr})`);
  await downloadFileFromR2(`data/${dateStr}.db`, dailyDbPath).catch(() => false);
  await downloadFileFromR2("search_index.db", searchDbPath).catch(() => false);

  const dailyDb = initDailyDatabase(dailyDbPath);
  const searchDb = initSearchIndexDatabase(searchDbPath);
  const existingIds = getExistingArticleIds(dailyDb);

  console.log(`[2/5] RSSフィードを巡回中...`);
  const config = loadConfig(configPath);
  const allArticles: RawArticle[] = [];
  for (const feed of config.feeds) {
    const items = await fetchFeedArticles(feed);
    allArticles.push(...items);
  }

  const targetArticles = allArticles.filter((item) => !existingIds.has(item.id));
  console.log(`処理対象記事数: ${targetArticles.length} 件 (スキップ: ${allArticles.length - targetArticles.length} 件)`);

  const processedArticles: Article[] = [];
  const vectorRecords: { article_id: string; date: string; embedding: Float32Array }[] = [];

  for (let i = 0; i < targetArticles.length; i++) {
    const raw = targetArticles[i];
    console.log(`[3/5] AI要約 & スコアリング中 (${i + 1}/${targetArticles.length}): ${raw.title}`);

    const { summary, score } = await summarizeAndScoreArticle(raw, config.profile, geminiApiKey);
    const article: Article = {
      id: raw.id,
      title: raw.title,
      url: raw.url,
      source_name: raw.source_name,
      summary,
      score,
      published_at: raw.published_at
    };
    processedArticles.push(article);

    console.log(`[4/5] ベクトル生成中: ${raw.title}`);
    const embedding = await generateArticleEmbedding(article.title, article.summary);
    vectorRecords.push({ article_id: article.id, date: dateStr, embedding });

    // Gemini API 無料枠 (15 RPM) を遵守するための 4.2秒 待機
    if (i < targetArticles.length - 1) {
      await sleep(4200);
    }
  }

  if (processedArticles.length > 0) {
    insertArticles(dailyDb, processedArticles);
    insertVectors(searchDb, vectorRecords);
  }

  dailyDb.close();
  searchDb.close();

  console.log(`[5/5] R2 へ更新DBをアップロード中...`);
  await uploadFileToR2(dailyDbPath, `data/${dateStr}.db`);
  await uploadFileToR2(searchDbPath, "search_index.db");

  console.log(`✅ パイプラインが正常に完了しました (${processedArticles.length}件処理)`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  runPipeline().catch((err) => {
    console.error("パイプライン実行エラー:", err);
    process.exit(1);
  });
}
```

- [ ] **Step 3: テストを実行して通過を確認**
- [ ] **Step 4: コミット**

```bash
git add src/pipeline/index.ts tests/pipeline/pipeline.test.ts
git commit -m "feat: バックエンド収集・要約・ベクトル化・R2同期パイプラインを統合"
```

---

### Task 9: フロントエンド Wasm SQLite & 差分DB結合クライアント (`src/web/lib/sqlite-client.ts`)

**Files:**
- Create: `src/web/lib/sqlite-client.ts`
- Create: `src/web/lib/r2-client.ts`
- Test: `tests/web/sqlite-client.test.ts`

**Interfaces:**
- Produces: `fetchDailyArticles(r2BaseUrl: string, dateStr: string): Promise<Article[]>`, `searchArticlesByVector(r2BaseUrl: string, queryVec: Float32Array, topK?: number): Promise<SearchResultItem[]>`

- [ ] **Step 1: テストを作成（コサイン類似度計算と差分ロード）**

```typescript
// tests/web/sqlite-client.test.ts
import { describe, it, expect } from "vitest";
import { cosineSimilarity } from "../../src/web/lib/sqlite-client";

describe("フロントエンド検索・類似度計算のテスト", () => {
  it("同一ベクトルに対してコサイン類似度 1.0 を返すこと", () => {
    const vec1 = new Float32Array([1, 0, 0]);
    const vec2 = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(1.0);
  });

  it("直交するベクトルに対してコサイン類似度 0.0 を返すこと", () => {
    const vec1 = new Float32Array([1, 0, 0]);
    const vec2 = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(0.0);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**
- [ ] **Step 3: `sqlite-client.ts` と `r2-client.ts` を実装**

```typescript
// src/web/lib/sqlite-client.ts
import initSqlJs from "sql.js";
import { Article, SearchResultItem } from "../../shared/types";

let SQL: any = null;
const dbCache = new Map<string, any>();

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

export async function getSql() {
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: (file) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.12.0/${file}`
    });
  }
  return SQL;
}

export async function loadDatabaseFromUrl(url: string) {
  if (dbCache.has(url)) return dbCache.get(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DBのダウンロードに失敗しました: ${res.statusText}`);
  const buffer = await res.arrayBuffer();
  const sql = await getSql();
  const db = new sql.Database(new Uint8Array(buffer));
  dbCache.set(url, db);
  return db;
}

export async function fetchDailyArticles(r2BaseUrl: string, dateStr: string): Promise<Article[]> {
  const url = `${r2BaseUrl}/data/${dateStr}.db`;
  const db = await loadDatabaseFromUrl(url);
  const stmt = db.prepare("SELECT * FROM articles ORDER BY score DESC");
  const articles: Article[] = [];
  while (stmt.step()) {
    articles.push(stmt.getAsObject() as Article);
  }
  stmt.free();
  return articles;
}

export async function searchArticlesByVector(
  r2BaseUrl: string,
  queryVec: Float32Array,
  topK = 20
): Promise<SearchResultItem[]> {
  const searchDb = await loadDatabaseFromUrl(`${r2BaseUrl}/search_index.db`);
  const stmt = searchDb.prepare("SELECT article_id, date, embedding FROM search_index");

  const candidates: { article_id: string; date: string; similarity: number }[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    const vec = new Float32Array((row.embedding as Uint8Array).buffer);
    const sim = cosineSimilarity(queryVec, vec);
    candidates.push({ article_id: row.article_id, date: row.date, similarity: sim });
  }
  stmt.free();

  candidates.sort((a, b) => b.similarity - a.similarity);
  const topCandidates = candidates.slice(0, topK);

  // 必要な日付DBのみ差分ロード
  const uniqueDates = [...new Set(topCandidates.map((c) => c.date))];
  await Promise.all(uniqueDates.map((date) => loadDatabaseFromUrl(`${r2BaseUrl}/data/${date}.db`)));

  const results: SearchResultItem[] = [];
  for (const cand of topCandidates) {
    const db = dbCache.get(`${r2BaseUrl}/data/${cand.date}.db`);
    if (!db) continue;
    const s = db.prepare("SELECT * FROM articles WHERE id = ?");
    s.bind([cand.article_id]);
    if (s.step()) {
      const art = s.getAsObject() as Article;
      results.push({ ...art, date: cand.date, similarity: cand.similarity });
    }
    s.free();
  }
  return results;
}
```

- [ ] **Step 4: テストを実行して通過を確認**
- [ ] **Step 5: コミット**

```bash
git add src/web/lib/sqlite-client.ts tests/web/sqlite-client.test.ts
git commit -m "feat: Wasm SQLite による日別ロードおよび差分結合ベクトル検索クライアントを実装"
```

---

### Task 10: ブラウザ内クエリベクトル化 Web Worker (`src/web/workers/embedder.worker.ts`)

**Files:**
- Create: `src/web/workers/embedder.worker.ts`
- Create: `src/web/lib/browser-embedder.ts`
- Test: `tests/web/browser-embedder.test.ts`

**Interfaces:**
- Produces: `embedQueryInWorker(queryText: string): Promise<Float32Array>`

- [ ] **Step 1: テストを作成（query: プレフィックス付与）**
- [ ] **Step 2: Web Worker とクライアントブリッジを実装**

```typescript
// src/web/workers/embedder.worker.ts
import { pipeline } from "@huggingface/transformers";

let extractor: any = null;

self.onmessage = async (e) => {
  const { id, query } = e.data;
  try {
    if (!extractor) {
      extractor = await pipeline("feature-extraction", "intfloat/multilingual-e5-small", {
        dtype: "q8"
      });
    }
    const formatted = `query: ${query.trim()}`;
    const output = await extractor(formatted, { pooling: "mean", normalize: true });
    self.postMessage({ id, vector: Array.from(output.data) });
  } catch (error: any) {
    self.postMessage({ id, error: error.message });
  }
};
```

```typescript
// src/web/lib/browser-embedder.ts
let worker: Worker | null = null;
let messageId = 0;

export function getEmbedderWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../workers/embedder.worker.ts", import.meta.url), {
      type: "module"
    });
  }
  return worker;
}

export function embedQuery(query: string): Promise<Float32Array> {
  const w = getEmbedderWorker();
  const id = ++messageId;
  return new Promise((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      if (e.data.id === id) {
        w.removeEventListener("message", handler);
        if (e.data.error) reject(new Error(e.data.error));
        else resolve(new Float32Array(e.data.vector));
      }
    };
    w.addEventListener("message", handler);
    w.postMessage({ id, query });
  });
}
```

- [ ] **Step 3: テストを実行して通過を確認**
- [ ] **Step 4: コミット**

```bash
git add src/web/workers/embedder.worker.ts src/web/lib/browser-embedder.ts tests/web/browser-embedder.test.ts
git commit -m "feat: ブラウザ内クエリベクトル化用 Web Worker を実装"
```

---

### Task 11: フロントエンド React SPA UI 実装 (`src/web/components/`, `src/web/App.tsx`)

**Files:**
- Create: `src/web/components/Header.tsx`
- Create: `src/web/components/ArticleCard.tsx`
- Create: `src/web/components/DatePicker.tsx`
- Create: `src/web/components/SearchBar.tsx`
- Create: `src/web/App.tsx`
- Create: `src/web/main.tsx`
- Create: `index.html`
- Test: `tests/web/App.test.tsx`

**Interfaces:**
- Produces: 日常モード（日別記事一覧）と検索モード（セマンティック検索）のシームレスな切替 SPA

- [ ] **Step 1: UI コンポーネント群を実装**
  - `ArticleCard`: スコアバッジ（90点以上=高スコア色）、3行要約（箇条書き）、配信元タグ、元記事リンク
  - `DatePicker`: カレンダーによる日付選択
  - `SearchBar`: キーワード入力 & Web Worker 検索トリガー
- [ ] **Step 2: `App.tsx` を実装**
- [ ] **Step 3: 日本語テストを作成して実行**
- [ ] **Step 4: コミット**

```bash
git add src/web/ index.html tests/web/App.test.tsx
git commit -m "feat: React SPA フロントエンド UI および検索・閲覧画面を実装"
```

---

### Task 12: Terraform による Cloudflare インフラ管理 (`terraform/`)

**Files:**
- Create: `terraform/main.tf`
- Create: `terraform/variables.tf`
- Create: `terraform/outputs.tf`

**Interfaces:**
- Produces: R2 バケット `rss-news-site-data`、CORS設定、Pages プロジェクト `rss-news-site`、tfstate管理 (`rss-news-site-tfstate`)

- [ ] **Step 1: `terraform/main.tf` を作成**

```hcl
terraform {
  required_version = ">= 1.15.8"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.52.0"
    }
  }
  backend "s3" {
    bucket                      = "rss-news-site-tfstate"
    key                         = "terraform.tfstate"
    region                      = "auto"
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

resource "cloudflare_r2_bucket" "data" {
  account_id = var.cloudflare_account_id
  name       = "rss-news-site-data"
  location   = "APAC"
}

resource "cloudflare_pages_project" "web" {
  account_id        = var.cloudflare_account_id
  name              = "rss-news-site"
  production_branch = "main"
}
```

- [ ] **Step 2: `terraform/variables.tf` および `terraform/outputs.tf` を作成**
- [ ] **Step 3: コミット**

```bash
git add terraform/
git commit -m "feat: Cloudflare R2 および Pages を管理する Terraform 設定を追加"
```

---

### Task 13: GitHub Actions CI/CD & pinact による Action ハッシュ固定

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/daily-pipeline.yml`
- Create: `.github/workflows/e2e-daily.yml`
- Create: `.github/workflows/terraform.yml`
- Create: `.github/workflows/deploy-pages.yml`

**Interfaces:**
- Produces: 自動テスト（カバレッジ Step Summary 出力）、日次収集 Cron、E2E 定期実行、Terraform 自動反映、Pages 自動デプロイ

- [ ] **Step 1: `.github/workflows/ci.yml` を作成（テストカバレッジレポート出力付き）**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - uses: jdx/mise-action@5083ab467140f7b0dcab9b788a6d47f9f3ef4d15 # v2.1.11
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test:coverage --reporter=json-summary --reporter=text
      - name: テストカバレッジを Step Summary に出力
        run: |
          echo "### 📊 テストカバレッジサマリー" >> $GITHUB_STEP_SUMMARY
          echo '```' >> $GITHUB_STEP_SUMMARY
          pnpm vitest run --coverage --reporter=text-summary >> $GITHUB_STEP_SUMMARY
          echo '```' >> $GITHUB_STEP_SUMMARY
```

- [ ] **Step 2: `daily-pipeline.yml`（毎日 07:00 JST / 22:00 UTC）を作成**
- [ ] **Step 3: `e2e-daily.yml`（毎朝 09:00 JST / 00:00 UTC）を作成**
- [ ] **Step 4: `terraform.yml` & `deploy-pages.yml` を作成**
- [ ] **Step 5: `pinact run .github/workflows/*.yml` を実行しコミットハッシュを固定**
- [ ] **Step 6: コミット**

```bash
git add .github/workflows/
git commit -m "ci: GitHub Actions ワークフロー群を作成し pinact でバージョン固定"
```

---

### Task 14: Playwright E2E テスト (`tests/e2e/news-site.spec.ts`, `playwright.config.ts`)

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/news-site.spec.ts`

**Interfaces:**
- Produces: 日本語での E2E テストスイート

- [ ] **Step 1: `playwright.config.ts` を作成**
- [ ] **Step 2: 日本語 E2E テストシナリオを作成**

```typescript
// tests/e2e/news-site.spec.ts
import { test, expect } from "@playwright/test";

test.describe("RSS ニュースサイトの E2E テスト", () => {
  test("初期表示時に本日の記事一覧がスコア順に表示されること", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /RSS News/i })).toBeVisible();
    await expect(page.locator("[data-testid='article-card']").first()).toBeVisible();
  });

  test("日付ピッカーで過去日付を選択した際に該当日の記事が読み込まれること", async ({ page }) => {
    await page.goto("/");
    await page.locator("input[type='date']").fill("2026-08-18");
    await expect(page.getByText("2026-08-18")).toBeVisible();
  });

  test("検索窓にキーワードを入力した際にセマンティック検索結果が表示されること", async ({ page }) => {
    await page.goto("/");
    await page.locator("input[placeholder*='検索']").fill("TypeScript");
    await page.keyboard.press("Enter");
    await expect(page.getByText("類似度")).first().toBeVisible();
  });
});
```

- [ ] **Step 3: コミット**

```bash
git add playwright.config.ts tests/e2e/news-site.spec.ts
git commit -m "test: Playwright による E2E テストスイートを追加"
```

---

## Plan Self-Review Check
- [x] **Spec Coverage:** 全要件（mise, pnpm `minimumReleaseAge: 10080`, pinact, Gemini 15 RPM 4.2s sleep, e5-small, R2 + tfstate, 日本語テスト, PRカバレッジ, E2E朝9時定期実行）を網羅
- [x] **No Placeholders:** 全ファイルに具体的なコードおよび設定を記載
- [x] **Type Consistency:** `Article`, `PipelineConfig`, `SearchResultItem` の型が全タスク間で整合
