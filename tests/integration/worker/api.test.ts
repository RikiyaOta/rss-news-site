import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach, vi } from "vitest";
import app, { Bindings } from "../../../src/server/index";
import { upsertArticles, ArticleInput } from "../../../src/server/db/articles";

/**
 * Hono API の結合テスト。
 *
 * 本番と同じ workerd 上で、実 D1 (Miniflare) に対して実際の SQL を発行する。
 * Workers AI だけはローカルでエミュレートできず、
 * 呼び出すと実アカウントへリクエストが飛んで課金対象になるためスタブする。
 */

/** クエリ文字列に応じて決定論的なベクトルを返す Workers AI スタブ */
function createAiStub() {
  return {
    run: vi.fn(async (_model: string, { text }: { text: string }) => {
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
}

let ai: ReturnType<typeof createAiStub>;

/** 実 D1 と AI スタブを束ねた Worker 環境 */
function bindings(overrides: Partial<Bindings> = {}): Bindings {
  return { DB: env.DB, AI: ai, ...overrides };
}

describe("Hono バックエンド API (src/server/index) の結合テスト", () => {
  beforeEach(async () => {
    ai = createAiStub();
    await env.DB.prepare("DELETE FROM articles").run();
  });

  describe("GET /health", () => {
    it("ステータス 200 と { status: 'ok' } を返すこと", async () => {
      const res = await app.request("/health", {}, bindings());
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok" });
    });
  });

  describe("GET /api/articles", () => {
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
        },
        {
          id: "art-2",
          title: "記事2 (スコア95)",
          url: "https://example.com/2",
          source_name: "Source B",
          summary: "要約2",
          score: 95,
          published_at: "2026-08-20T02:00:00.000Z",
        },
        {
          id: "art-3",
          title: "記事3 (前日)",
          url: "https://example.com/3",
          source_name: "Source C",
          summary: "要約3",
          score: 90,
          published_at: "2026-08-19T01:00:00.000Z",
        },
      ];
      await upsertArticles(env.DB, articles);
    });

    it("指定日の記事をスコア降順で返すこと", async () => {
      const res = await app.request("/api/articles?date=2026-08-20", {}, bindings());
      expect(res.status).toBe(200);

      const data = (await res.json()) as any;
      expect(data.date).toBe("2026-08-20");
      expect(data.total).toBe(2);
      expect(data.articles.map((a: any) => a.id)).toEqual(["art-2", "art-1"]);
    });

    it("記事本文に embedding を含めず、必要な項目のみ返すこと", async () => {
      const res = await app.request("/api/articles?date=2026-08-20", {}, bindings());
      const data = (await res.json()) as any;

      expect(data.articles[0]).not.toHaveProperty("embedding");
      expect(data.articles[0]).toMatchObject({
        id: expect.any(String),
        title: expect.any(String),
        url: expect.any(String),
        source_name: expect.any(String),
        score: expect.any(Number),
        published_at: expect.any(String),
        published_date_jst: "2026-08-20",
      });
    });

    it("date 未指定の場合は本日の JST 日付で取得すること", async () => {
      vi.useFakeTimers();
      // UTC 15:00 は JST では翌日 00:00
      vi.setSystemTime(new Date("2026-08-19T15:00:00.000Z"));
      try {
        const res = await app.request("/api/articles", {}, bindings());
        const data = (await res.json()) as any;
        expect(data.date).toBe("2026-08-20");
        expect(data.total).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("記事が存在しない日付では空配列と total: 0 を返すこと", async () => {
      const res = await app.request("/api/articles?date=2099-01-01", {}, bindings());
      const data = (await res.json()) as any;
      expect(data).toMatchObject({ date: "2099-01-01", total: 0, articles: [] });
    });

    it("total はページ内件数ではなくその日の全件数を返すこと", async () => {
      const res = await app.request("/api/articles?date=2026-08-20&limit=1", {}, bindings());
      const data = (await res.json()) as any;
      expect(data.articles).toHaveLength(1);
      expect(data.total).toBe(2);
    });

    describe("limit / offset の境界値と異常値", () => {
      it.each([
        { query: "", expectedIds: ["art-2", "art-1"], note: "既定値 (limit=50, offset=0)" },
        { query: "&limit=1", expectedIds: ["art-2"], note: "先頭 1 件" },
        { query: "&limit=1&offset=1", expectedIds: ["art-1"], note: "2 件目" },
        { query: "&offset=2", expectedIds: [], note: "全件を超える offset" },
        { query: "&limit=abc", expectedIds: ["art-2", "art-1"], note: "非数値は既定値へ" },
        { query: "&offset=abc", expectedIds: ["art-2", "art-1"], note: "非数値 offset は 0 へ" },
        { query: "&limit=0", expectedIds: [], note: "limit=0" },
      ])("date=2026-08-20$query は $note として扱われること", async ({ query, expectedIds }) => {
        const res = await app.request(`/api/articles?date=2026-08-20${query}`, {}, bindings());
        expect(res.status).toBe(200);

        const data = (await res.json()) as any;
        expect(data.articles.map((a: any) => a.id)).toEqual(expectedIds);
        // total は limit / offset に影響されない
        expect(data.total).toBe(2);
      });
    });
  });

  describe("GET /api/search", () => {
    beforeEach(async () => {
      const vecTs = new Float32Array(1024);
      vecTs[0] = 0.9;
      vecTs[1] = 0.1;
      const vecPy = new Float32Array(1024);
      vecPy[0] = 0.1;
      vecPy[1] = 0.9;

      await upsertArticles(env.DB, [
        {
          id: "search-ts",
          title: "TypeScript の最新機能紹介",
          url: "https://example.com/ts",
          source_name: "Tech News",
          summary: "TypeScript 5.x について",
          score: 85,
          published_at: "2026-08-20T00:00:00.000Z",
          embedding: vecTs,
        },
        {
          id: "search-py",
          title: "Python 機械学習入門",
          url: "https://example.com/py",
          source_name: "Tech News",
          summary: "Python による機械学習",
          score: 80,
          published_at: "2026-08-20T00:00:00.000Z",
          embedding: vecPy,
        },
      ]);
    });

    it("クエリを Workers AI でベクトル化し、類似度順に結果を返すこと", async () => {
      const res = await app.request("/api/search?q=TypeScript", {}, bindings());
      expect(res.status).toBe(200);
      expect(ai.run).toHaveBeenCalledWith("@cf/baai/bge-m3", { text: "TypeScript" });

      const data = (await res.json()) as any;
      expect(data.query).toBe("TypeScript");
      expect(data.results.map((r: any) => r.id)).toEqual(["search-ts", "search-py"]);
      expect(data.results[0].similarity).toBeGreaterThan(0.9);
    });

    it("検索クエリは前後の空白がトリムされてベクトル化されること", async () => {
      await app.request("/api/search?q=%20%20TypeScript%20%20", {}, bindings());
      expect(ai.run).toHaveBeenCalledWith("@cf/baai/bge-m3", { text: "TypeScript" });
    });

    it("limit で件数が制限されること", async () => {
      const res = await app.request("/api/search?q=TypeScript&limit=1", {}, bindings());
      const data = (await res.json()) as any;
      expect(data.total).toBe(1);
      expect(data.results.map((r: any) => r.id)).toEqual(["search-ts"]);
    });

    it.each([
      { query: "", note: "q 未指定" },
      { query: "?q=", note: "q が空文字" },
      { query: "?q=%20%20%20", note: "q が空白のみ" },
    ])("$note の場合は 400 とエラーメッセージを返すこと", async ({ query }) => {
      const res = await app.request(`/api/search${query}`, {}, bindings());
      expect(res.status).toBe(400);
      expect((await res.json()) as any).toEqual({ error: "検索クエリ 'q' は必須です" });
      // 不正なリクエストで Workers AI を呼ばないこと (課金対象のため)
      expect(ai.run).not.toHaveBeenCalled();
    });
  });

  describe("エラーハンドリング", () => {
    it("D1 でエラーが発生した場合に 500 とエラーメッセージを返すこと", async () => {
      const failingDb = {
        prepare: () => {
          throw new Error("D1 接続エラー");
        },
      } as unknown as Bindings["DB"];

      const res = await app.request(
        "/api/articles?date=2026-08-20",
        {},
        bindings({ DB: failingDb }),
      );
      expect(res.status).toBe(500);
      expect((await res.json()) as any).toEqual({ error: "D1 接続エラー" });
    });

    it("Workers AI でエラーが発生した場合に 500 とエラーメッセージを返すこと", async () => {
      const failingAi = { run: vi.fn().mockRejectedValue(new Error("Workers AI レート制限")) };

      const res = await app.request("/api/search?q=TypeScript", {}, bindings({ AI: failingAi }));
      expect(res.status).toBe(500);
      expect((await res.json()) as any).toEqual({ error: "Workers AI レート制限" });
    });

    it("Workers AI が想定外の形式を返した場合に 500 を返すこと", async () => {
      const brokenAi = { run: vi.fn().mockResolvedValue({ unexpected: true }) };

      const res = await app.request("/api/search?q=TypeScript", {}, bindings({ AI: brokenAi }));
      expect(res.status).toBe(500);
      expect(((await res.json()) as any).error).toMatch(/Invalid AI embedding response format/);
    });
  });
});
