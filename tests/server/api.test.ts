import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import app, { Bindings } from "../../src/server/index.ts";
import {
  upsertArticles,
  ArticleInput,
  ArticleRecord,
  D1DatabaseLike,
} from "../../src/server/db/articles.ts";

/**
 * テスト用インメモリ Mock D1Database (Pure JS)
 */
function createInMemoryD1(): D1DatabaseLike & { _articles: ArticleRecord[] } {
  const articles: ArticleRecord[] = [];
  return {
    _articles: articles,
    prepare(query: string) {
      let boundValues: unknown[] = [];
      const stmt = {
        _sql: query,
        _params: boundValues,
        bind(...values: unknown[]) {
          boundValues = values;
          stmt._params = values;
          return stmt;
        },
        async all<T = unknown>() {
          if (query.includes("WHERE published_date_jst = ?")) {
            const [dateJst, limit, offset] = boundValues as [string, number, number];
            const filtered = articles
              .filter((a) => a.published_date_jst === dateJst)
              .sort((a, b) => b.score - a.score);
            const paged = filtered.slice(offset, offset + limit);
            return { results: paged as T[], success: true, meta: {} };
          }
          if (query.includes("WHERE embedding IS NOT NULL")) {
            const filtered = articles.filter((a) => a.embedding != null);
            return { results: filtered as T[], success: true, meta: {} };
          }
          return { results: articles as T[], success: true, meta: {} };
        },
        async run() {
          if (query.includes("INSERT INTO articles")) {
            const [
              id,
              title,
              url,
              source_name,
              summary,
              score,
              published_at,
              published_date_jst,
              serializedEmbedding,
            ] = boundValues as any[];
            const existingIndex = articles.findIndex((a) => a.url === url);
            const record: ArticleRecord = {
              id,
              title,
              url,
              source_name,
              summary,
              score,
              published_at,
              published_date_jst,
              embedding: serializedEmbedding ?? null,
            };
            if (existingIndex >= 0) {
              articles[existingIndex] = {
                ...record,
                embedding: serializedEmbedding ?? articles[existingIndex].embedding,
              };
            } else {
              articles.push(record);
            }
          }
          return { success: true, meta: {} };
        },
        async first<T = unknown>() {
          return null as T | null;
        },
      };
      return stmt;
    },
    async batch(statements: any[]) {
      for (const s of statements) {
        await s.run();
      }
      return [];
    },
  };
}

describe("Hono バックエンド API サーバー (src/server/index.ts) のテスト", () => {
  let mockD1: ReturnType<typeof createInMemoryD1>;
  let mockAI: { run: ReturnType<typeof vi.fn> };
  let mockEnv: Bindings;

  beforeEach(() => {
    mockD1 = createInMemoryD1();

    mockAI = {
      run: vi.fn().mockImplementation(async (_model: string, { text }: { text: string }) => {
        const vec = new Float32Array(1024);
        if (text.includes("TypeScript")) {
          vec[0] = 0.9;
          vec[1] = 0.1;
        } else {
          vec[0] = 0.1;
          vec[1] = 0.9;
        }
        return { data: [Array.from(vec)] };
      }),
    };

    mockEnv = {
      DB: mockD1 as any,
      AI: mockAI,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /health (ヘルスチェック)", () => {
    it("ステータス 200 と { status: 'ok' } を返却すること", async () => {
      const res = await app.request("/health", {}, mockEnv);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toEqual({ status: "ok" });
    });
  });

  describe("GET /api/articles (日別記事一覧取得 API)", () => {
    beforeEach(async () => {
      const articles: ArticleInput[] = [
        {
          id: "art-1",
          title: "記事1 (スコア80)",
          url: "https://example.com/1",
          source_name: "Source A",
          summary: "要約1",
          score: 80,
          published_at: "2026-08-20T01:00:00.000Z",
          published_date_jst: "2026-08-20",
        },
        {
          id: "art-2",
          title: "記事2 (スコア95)",
          url: "https://example.com/2",
          source_name: "Source B",
          summary: "要約2",
          score: 95,
          published_at: "2026-08-20T02:00:00.000Z",
          published_date_jst: "2026-08-20",
        },
        {
          id: "art-3",
          title: "記事3 (前日)",
          url: "https://example.com/3",
          source_name: "Source C",
          summary: "要約3",
          score: 90,
          published_at: "2026-08-19T01:00:00.000Z",
          published_date_jst: "2026-08-19",
        },
      ];
      await upsertArticles(mockD1, articles);
    });

    it("指定した日付 (date=2026-08-20) の記事をスコア降順で取得できること", async () => {
      const res = await app.request("/api/articles?date=2026-08-20", {}, mockEnv);
      expect(res.status).toBe(200);

      const data = (await res.json()) as any;
      expect(data.date).toBe("2026-08-20");
      expect(data.total).toBe(2);
      expect(data.articles).toHaveLength(2);
      expect(data.articles[0].id).toBe("art-2");
      expect(data.articles[0].score).toBe(95);
      expect(data.articles[1].id).toBe("art-1");
      expect(data.articles[1].score).toBe(80);
    });

    it("date パラメータが未指定の場合は本日の JST 日付で取得されること", async () => {
      const res = await app.request("/api/articles", {}, mockEnv);
      expect(res.status).toBe(200);

      const data = (await res.json()) as any;
      expect(data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Array.isArray(data.articles)).toBe(true);
    });

    it("limit と offset によるページネーションが正しく動作すること", async () => {
      const res = await app.request("/api/articles?date=2026-08-20&limit=1&offset=1", {}, mockEnv);
      expect(res.status).toBe(200);

      const data = (await res.json()) as any;
      expect(data.total).toBe(1);
      expect(data.articles).toHaveLength(1);
      expect(data.articles[0].id).toBe("art-1");
    });

    it("記事が存在しない日付が指定された場合は空配列と total: 0 を返却すること", async () => {
      const res = await app.request("/api/articles?date=2099-01-01", {}, mockEnv);
      expect(res.status).toBe(200);

      const data = (await res.json()) as any;
      expect(data.date).toBe("2099-01-01");
      expect(data.total).toBe(0);
      expect(data.articles).toEqual([]);
    });
  });

  describe("GET /api/search (セマンティック検索 API)", () => {
    beforeEach(async () => {
      const vecTS = new Float32Array(1024);
      vecTS[0] = 0.9;
      vecTS[1] = 0.1;

      const vecPython = new Float32Array(1024);
      vecPython[0] = 0.1;
      vecPython[1] = 0.9;

      const articles: ArticleInput[] = [
        {
          id: "search-ts",
          title: "TypeScript の最新機能紹介",
          url: "https://example.com/ts",
          source_name: "Tech News",
          summary: "TypeScript 5.x について",
          score: 85,
          published_at: "2026-08-20T00:00:00.000Z",
          published_date_jst: "2026-08-20",
          embedding: vecTS,
        },
        {
          id: "search-py",
          title: "Python 機械学習入門",
          url: "https://example.com/py",
          source_name: "Tech News",
          summary: "Python による機械学習",
          score: 80,
          published_at: "2026-08-20T00:00:00.000Z",
          published_date_jst: "2026-08-20",
          embedding: vecPython,
        },
      ];
      await upsertArticles(mockD1, articles);
    });

    it("クエリ 'TypeScript' を指定した場合に Workers AI でベクトル化して類似度順に検索結果を返却すること", async () => {
      const res = await app.request("/api/search?q=TypeScript", {}, mockEnv);
      expect(res.status).toBe(200);
      expect(mockAI.run).toHaveBeenCalledWith("@cf/baai/bge-m3", { text: "TypeScript" });

      const data = (await res.json()) as any;
      expect(data.query).toBe("TypeScript");
      expect(data.total).toBe(2);
      expect(data.results[0].id).toBe("search-ts");
      expect(data.results[0].similarity).toBeGreaterThan(0.9);
      expect(data.results[1].id).toBe("search-py");
    });

    it("limit パラメータを指定した場合に件数が制限されること", async () => {
      const res = await app.request("/api/search?q=TypeScript&limit=1", {}, mockEnv);
      expect(res.status).toBe(200);

      const data = (await res.json()) as any;
      expect(data.total).toBe(1);
      expect(data.results).toHaveLength(1);
      expect(data.results[0].id).toBe("search-ts");
    });

    it("検索クエリ q が未指定の場合は 400 エラーとエラーメッセージを返却すること", async () => {
      const res = await app.request("/api/search", {}, mockEnv);
      expect(res.status).toBe(400);

      const data = (await res.json()) as any;
      expect(data.error).toBe("検索クエリ 'q' は必須です");
    });

    it("検索クエリ q が空文字または空白文字のみの場合は 400 エラーを返却すること", async () => {
      const res = await app.request("/api/search?q=   ", {}, mockEnv);
      expect(res.status).toBe(400);

      const data = (await res.json()) as any;
      expect(data.error).toBe("検索クエリ 'q' は必須です");
    });
  });

  describe("グローバルエラーハンドリング (app.onError)", () => {
    it("D1 データベースクエリ実行時にエラーが発生した場合は 500 エラーを返却すること", async () => {
      const failingD1: D1DatabaseLike = {
        prepare: () => {
          throw new Error("D1 接続エラー");
        },
      };

      const res = await app.request(
        "/api/articles?date=2026-08-20",
        {},
        { DB: failingD1 as any, AI: mockAI },
      );
      expect(res.status).toBe(500);

      const data = (await res.json()) as any;
      expect(data.error).toBe("D1 接続エラー");
    });

    it("Workers AI 実行時にエラーが発生した場合は 500 エラーを返却すること", async () => {
      const failingAI = {
        run: vi.fn().mockRejectedValue(new Error("Workers AI レート制限エラー")),
      };

      const res = await app.request(
        "/api/search?q=TypeScript",
        {},
        { DB: mockD1 as any, AI: failingAI },
      );
      expect(res.status).toBe(500);

      const data = (await res.json()) as any;
      expect(data.error).toBe("Workers AI レート制限エラー");
    });
  });
});
