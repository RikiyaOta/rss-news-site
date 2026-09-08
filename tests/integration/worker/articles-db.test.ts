import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import {
  upsertArticles,
  getArticlesByPublishedDate,
  countArticlesByPublishedDate,
  searchArticlesByVector,
  deserializeVector,
  ArticleInput,
} from "../../../src/server/db/articles";

/**
 * D1 クエリレイヤーの結合テスト。
 *
 * 手書きの偽装 D1 ではなく、workerd 上の実 D1 (Miniflare) に対して
 * 本物の SQL を発行する。ON CONFLICT の MIN() や ORDER BY / LIMIT / OFFSET が
 * 実際に意図どおり動くことを確認できる。
 */
describe("D1 クエリレイヤー (src/server/db/articles) の結合テスト", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM articles").run();
  });

  /** テスト用の記事を組み立てる */
  function article(overrides: Partial<ArticleInput> & Pick<ArticleInput, "id" | "url">) {
    return {
      title: `記事 ${overrides.id}`,
      source_name: "Test Source",
      summary: null,
      score: 50,
      published_at: "2026-08-20T01:00:00.000Z",
      ...overrides,
    } satisfies ArticleInput;
  }

  describe("upsertArticles と日別取得", () => {
    it("空の記事配列を渡した場合に 0 を返し、クエリを発行しないこと", async () => {
      expect(await upsertArticles(env.DB, [])).toBe(0);
      expect(await countArticlesByPublishedDate(env.DB, "2026-08-20")).toBe(0);
    });

    it("一括 upsert した記事を published_date_jst 単位でスコア降順に取得できること", async () => {
      await upsertArticles(env.DB, [
        article({ id: "a1", url: "https://example.com/1", score: 40 }),
        article({
          id: "a2",
          url: "https://example.com/2",
          score: 95,
          published_at: "2026-08-19T20:00:00.000Z", // JST では 2026-08-20
        }),
        article({
          id: "a3",
          url: "https://example.com/3",
          score: 80,
          published_at: "2026-08-19T10:00:00.000Z", // JST では 2026-08-19
        }),
      ]);

      const day20 = await getArticlesByPublishedDate(env.DB, "2026-08-20");
      expect(day20.map((a) => a.id)).toEqual(["a2", "a1"]);
      expect(day20[0].published_date_jst).toBe("2026-08-20");

      const day19 = await getArticlesByPublishedDate(env.DB, "2026-08-19");
      expect(day19.map((a) => a.id)).toEqual(["a3"]);
    });

    it("同一 URL の再 upsert で内容が更新され、行が重複しないこと", async () => {
      await upsertArticles(env.DB, [
        article({
          id: "orig",
          url: "https://example.com/same",
          title: "初回タイトル",
          score: 60,
          embedding: new Float32Array(1024).fill(0.2),
        }),
      ]);
      await upsertArticles(env.DB, [
        article({
          id: "updated",
          url: "https://example.com/same",
          title: "更新後タイトル",
          score: 99,
          published_at: "2026-08-20T02:00:00.000Z",
        }),
      ]);

      const results = await getArticlesByPublishedDate(env.DB, "2026-08-20");
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("更新後タイトル");
      expect(results[0].score).toBe(99);
    });

    it("再 upsert で公開日時が後の日付へ前進せず、同じ記事が複数日に現れないこと", async () => {
      const base = article({
        id: "keep",
        url: "https://example.com/keep",
        published_at: "2026-08-25T01:00:00.000Z",
      });
      await upsertArticles(env.DB, [base]);
      // 再巡回でフィード側の日付が更新日時などで後ろへずれたケース
      await upsertArticles(env.DB, [
        { ...base, title: "再巡回後タイトル", published_at: "2026-08-28T01:00:00.000Z" },
      ]);

      const day25 = await getArticlesByPublishedDate(env.DB, "2026-08-25");
      expect(day25).toHaveLength(1);
      expect(day25[0].title).toBe("再巡回後タイトル");
      expect(day25[0].published_at).toBe("2026-08-25T01:00:00.000Z");

      expect(await getArticlesByPublishedDate(env.DB, "2026-08-28")).toHaveLength(0);
    });

    it("再 upsert でより古い公開日時が判明した場合は正しい日付へ補正されること", async () => {
      const base = article({
        id: "fix",
        url: "https://example.com/fix",
        published_at: "2026-08-28T05:00:00.000Z",
      });
      await upsertArticles(env.DB, [base]);
      await upsertArticles(env.DB, [{ ...base, published_at: "2026-08-26T05:00:00.000Z" }]);

      const day26 = await getArticlesByPublishedDate(env.DB, "2026-08-26");
      expect(day26).toHaveLength(1);
      expect(day26[0].published_at).toBe("2026-08-26T05:00:00.000Z");
      expect(await getArticlesByPublishedDate(env.DB, "2026-08-28")).toHaveLength(0);
    });

    it("embedding が省略された再 upsert では既存のベクトルが維持されること", async () => {
      const vec = new Float32Array(1024);
      vec[0] = 1;
      await upsertArticles(env.DB, [
        article({ id: "vec", url: "https://example.com/vec", embedding: vec }),
      ]);
      await upsertArticles(env.DB, [
        article({ id: "vec", url: "https://example.com/vec", title: "更新", embedding: null }),
      ]);

      const results = await searchArticlesByVector(env.DB, vec, { limit: 10 });
      expect(results).toHaveLength(1);
      expect(results[0].similarity).toBeCloseTo(1.0, 5);
    });
  });

  describe("ページネーション", () => {
    beforeEach(async () => {
      await upsertArticles(
        env.DB,
        Array.from({ length: 5 }, (_, i) =>
          article({ id: `p${i}`, url: `https://example.com/p/${i}`, score: (i + 1) * 10 }),
        ),
      );
    });

    it.each([
      { limit: 2, offset: 0, expected: [50, 40] },
      { limit: 2, offset: 2, expected: [30, 20] },
      { limit: 2, offset: 4, expected: [10] },
      { limit: 2, offset: 5, expected: [] },
      { limit: 2, offset: 99, expected: [] },
      { limit: 99, offset: 0, expected: [50, 40, 30, 20, 10] },
      { limit: 0, offset: 0, expected: [] },
    ])(
      "limit=$limit offset=$offset のときスコア $expected の記事が返ること",
      async ({ limit, offset, expected }) => {
        const results = await getArticlesByPublishedDate(env.DB, "2026-08-20", { limit, offset });
        expect(results.map((a) => a.score)).toEqual(expected);
      },
    );

    it("countArticlesByPublishedDate はページングに関わらずその日の全件数を返すこと", async () => {
      const paged = await getArticlesByPublishedDate(env.DB, "2026-08-20", { limit: 1 });
      expect(paged).toHaveLength(1);
      expect(await countArticlesByPublishedDate(env.DB, "2026-08-20")).toBe(5);
    });

    it("記事が存在しない日付の件数は 0 になること", async () => {
      expect(await countArticlesByPublishedDate(env.DB, "2099-01-01")).toBe(0);
    });
  });

  describe("searchArticlesByVector", () => {
    const queryVec = new Float32Array(1024);
    queryVec[0] = 1.0;

    beforeEach(async () => {
      const high = new Float32Array(1024);
      high[0] = 0.95;
      high[1] = 0.05;
      const mid = new Float32Array(1024);
      mid[0] = 0.5;
      mid[1] = 0.5;
      const orthogonal = new Float32Array(1024);
      orthogonal[1] = 1.0;

      await upsertArticles(env.DB, [
        article({ id: "mid", url: "https://example.com/s/mid", score: 70, embedding: mid }),
        article({ id: "high", url: "https://example.com/s/high", score: 85, embedding: high }),
        article({ id: "low", url: "https://example.com/s/low", score: 90, embedding: orthogonal }),
        article({ id: "novec", url: "https://example.com/s/novec", score: 99, embedding: null }),
      ]);
    });

    it("類似度降順に並び、minSimilarity 未満とベクトル未登録の記事が除外されること", async () => {
      const results = await searchArticlesByVector(env.DB, queryVec, {
        minSimilarity: 0.1,
        limit: 10,
      });

      expect(results.map((r) => r.id)).toEqual(["high", "mid"]);
      expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
    });

    it("limit で件数が制限されること", async () => {
      const results = await searchArticlesByVector(env.DB, queryVec, { limit: 1 });
      expect(results.map((r) => r.id)).toEqual(["high"]);
    });

    it.each([[0], [-1]])(
      "limit が %s のときは空配列を返し、クエリを発行しないこと",
      async (limit) => {
        expect(await searchArticlesByVector(env.DB, queryVec, { limit })).toEqual([]);
      },
    );

    it("レスポンスに created_at を含めないこと", async () => {
      const results = await searchArticlesByVector(env.DB, queryVec, { limit: 10 });
      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result).not.toHaveProperty("created_at");
      }
    });

    it("類似度が同値の場合はスコア降順になること", async () => {
      await env.DB.prepare("DELETE FROM articles").run();

      const shared = new Float32Array(1024);
      shared[0] = 1.0;
      await upsertArticles(env.DB, [
        article({ id: "tie-low", url: "https://example.com/t/1", score: 10, embedding: shared }),
        article({ id: "tie-high", url: "https://example.com/t/2", score: 90, embedding: shared }),
        article({ id: "tie-mid", url: "https://example.com/t/3", score: 50, embedding: shared }),
      ]);

      const results = await searchArticlesByVector(env.DB, queryVec, { limit: 10 });
      expect(results.map((r) => r.id)).toEqual(["tie-high", "tie-mid", "tie-low"]);
    });

    it("上位のみを保持する実装が、全件ソートした結果と一致すること", async () => {
      await env.DB.prepare("DELETE FROM articles").run();

      // 決定論的な擬似乱数で 60 件のベクトルを作る
      let seed = 12345;
      const random = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };

      const seeded = Array.from({ length: 60 }, (_, i) => {
        const vec = new Float32Array(1024);
        for (let d = 0; d < 1024; d++) vec[d] = random() * 2 - 1;
        return article({
          id: `rand-${i}`,
          url: `https://example.com/r/${i}`,
          score: Math.floor(random() * 100),
          embedding: vec,
        });
      });
      await upsertArticles(env.DB, seeded);

      // 全件取得して素朴に並べ替えたものを期待値とする
      const all = await searchArticlesByVector(env.DB, queryVec, { limit: seeded.length });
      const expected = [...all]
        .sort((a, b) =>
          b.similarity !== a.similarity ? b.similarity - a.similarity : b.score - a.score,
        )
        .slice(0, 5)
        .map((r) => r.id);

      const topFive = await searchArticlesByVector(env.DB, queryVec, { limit: 5 });
      expect(topFive.map((r) => r.id)).toEqual(expected);
    });

    it("D1 が BLOB をバイト配列で返し、deserializeVector が 1024 次元へ復元できること", async () => {
      const row = await env.DB.prepare("SELECT embedding FROM articles WHERE id = 'high'").first<{
        embedding: number[];
      }>();

      // D1 は BLOB を「バイト値の配列」として返す。4096 バイト = Float32 × 1024。
      // 偽装 D1 では再現されない実挙動であり、deserializeVector の分岐はこれを前提にしている。
      expect(Array.isArray(row?.embedding)).toBe(true);
      expect(row?.embedding).toHaveLength(4096);

      const restored = deserializeVector(row!.embedding);
      expect(restored).toBeInstanceOf(Float32Array);
      expect(restored.length).toBe(1024);
      expect(restored[0]).toBeCloseTo(0.95, 5);
    });
  });
});
