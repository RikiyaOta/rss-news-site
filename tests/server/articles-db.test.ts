import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  computePublishedDateJst,
  serializeVector,
  deserializeVector,
  cosineSimilarity,
  upsertArticles,
  getArticlesByPublishedDate,
  searchArticlesByVector,
  ArticleInput,
  D1DatabaseLike,
  D1PreparedStatementLike,
} from "../../src/server/db/articles.ts";

/**
 * better-sqlite3 をラップして Cloudflare D1Database ライクなインターフェースを提供するテスト用ヘルパー
 */
function createMockD1Database(sqliteDb: Database.Database): D1DatabaseLike {
  function createStatement(query: string, values: unknown[] = []): D1PreparedStatementLike {
    return {
      _sql: query,
      _params: values,
      bind(...newValues: unknown[]) {
        return createStatement(query, newValues);
      },
      async all<T = unknown>() {
        const stmt = sqliteDb.prepare(query);
        const results = stmt.all(...values) as T[];
        return { results, success: true, meta: {} };
      },
      async run() {
        const stmt = sqliteDb.prepare(query);
        stmt.run(...values);
        return { success: true, meta: {} };
      },
      async first<T = unknown>(colName?: string) {
        const stmt = sqliteDb.prepare(query);
        const row = stmt.get(...values) as Record<string, unknown> | undefined;
        if (!row) return null;
        if (colName) return (row[colName] ?? null) as T;
        return row as T;
      },
    };
  }

  return {
    prepare(query: string) {
      return createStatement(query);
    },
    async batch(statements: any[]) {
      const results: { results: unknown[]; success: boolean; meta: Record<string, unknown> }[] = [];
      const tx = sqliteDb.transaction(() => {
        for (const s of statements) {
          const sql = s._sql;
          const params = s._params ?? [];
          const stmt = sqliteDb.prepare(sql);
          stmt.run(...params);
          results.push({ results: [], success: true, meta: {} });
        }
      });
      tx();
      return results;
    },
    async exec(query: string) {
      sqliteDb.exec(query);
      return { count: 0, duration: 0 };
    },
  };
}

describe("D1 データベーススキーマ & クエリレイヤー (src/server/db/articles) のテスト", () => {
  describe("computePublishedDateJst (公開日時のJST変換)", () => {
    it("UTC 14:59:59 は日本時間で同日（+9時間で23:59:59）として日付文字列を返すこと", () => {
      const result = computePublishedDateJst("2026-08-19T14:59:59.000Z");
      expect(result).toBe("2026-08-19");
    });

    it("UTC 15:00:00 は日本時間で翌日 00:00:00 となり翌日の日付文字列を返すこと", () => {
      const result = computePublishedDateJst("2026-08-19T15:00:00.000Z");
      expect(result).toBe("2026-08-20");
    });

    it("年末の UTC 15:00:00 が翌年の 01-01 に正しく繰り上がること", () => {
      const result = computePublishedDateJst("2025-12-31T15:00:00.000Z");
      expect(result).toBe("2026-01-01");
    });

    it("不正な日時文字列が渡された場合は例外をスローすること", () => {
      expect(() => computePublishedDateJst("invalid-date-string")).toThrow(/Invalid date string/);
    });
  });

  describe("ベクトル変換ヘルパー (serializeVector / deserializeVector)", () => {
    it("1024次元の Float32Array を 4096バイトの Uint8Array にシリアライズし完全復元できること", () => {
      const original = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        original[i] = Math.sin(i * 0.1);
      }

      const serialized = serializeVector(original);
      expect(serialized).toBeInstanceOf(Uint8Array);
      expect(serialized.byteLength).toBe(4096);

      const deserialized = deserializeVector(serialized);
      expect(deserialized).toBeInstanceOf(Float32Array);
      expect(deserialized.length).toBe(1024);

      for (let i = 0; i < 1024; i++) {
        expect(deserialized[i]).toBeCloseTo(original[i], 6);
      }
    });

    it("ArrayBuffer またはオフセット付きバッファから正しくデシリアライズできること", () => {
      const original = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        original[i] = i * 0.5;
      }

      // ArrayBuffer からの直接デシリアライズ
      const deserializedFromBuffer = deserializeVector(original.buffer);
      expect(deserializedFromBuffer.length).toBe(1024);
      expect(deserializedFromBuffer[10]).toBeCloseTo(5.0, 6);

      // オフセット付き Uint8Array
      const largeBuffer = new ArrayBuffer(8192);
      const subU8 = new Uint8Array(largeBuffer, 4096, 4096);
      const subF32 = new Float32Array(largeBuffer, 4096, 1024);
      subF32.set(original);

      const deserializedFromSub = deserializeVector(subU8);
      expect(deserializedFromSub.length).toBe(1024);
      expect(deserializedFromSub[10]).toBeCloseTo(5.0, 6);
    });
  });

  describe("コサイン類似度計算 (cosineSimilarity)", () => {
    it("同一ベクトルのコサイン類似度が 1.0 であること", () => {
      const vec = new Float32Array([1, 2, 3, 4]);
      const sim = cosineSimilarity(vec, vec);
      expect(sim).toBeCloseTo(1.0, 6);
    });

    it("直交ベクトルのコサイン類似度が 0.0 であること", () => {
      const vecA = new Float32Array([1, 0, 0]);
      const vecB = new Float32Array([0, 1, 0]);
      const sim = cosineSimilarity(vecA, vecB);
      expect(sim).toBeCloseTo(0.0, 6);
    });

    it("逆向きベクトルのコサイン類似度が -1.0 であること", () => {
      const vecA = new Float32Array([1, 2, 3]);
      const vecB = new Float32Array([-1, -2, -3]);
      const sim = cosineSimilarity(vecA, vecB);
      expect(sim).toBeCloseTo(-1.0, 6);
    });

    it("次元が異なるベクトルの場合は例外をスローすること", () => {
      const vecA = new Float32Array([1, 2]);
      const vecB = new Float32Array([1, 2, 3]);
      expect(() => cosineSimilarity(vecA, vecB)).toThrow(/Vector dimensions do not match/);
    });

    it("ゼロベクトルが含まれる場合は 0.0 を返すこと", () => {
      const vecA = new Float32Array([0, 0, 0]);
      const vecB = new Float32Array([1, 2, 3]);
      expect(cosineSimilarity(vecA, vecB)).toBe(0);
    });
  });

  describe("D1 データベース操作 (upsertArticles, getArticlesByPublishedDate, searchArticlesByVector)", () => {
    let sqliteDb: Database.Database;
    let mockD1: D1DatabaseLike;

    beforeEach(() => {
      if (!sqliteDb) {
        sqliteDb = new Database(":memory:");
        const schemaSqlPath = path.resolve(__dirname, "../../src/server/db/schema.sql");
        if (fs.existsSync(schemaSqlPath)) {
          const schemaSql = fs.readFileSync(schemaSqlPath, "utf-8");
          sqliteDb.exec(schemaSql);
        }
        mockD1 = createMockD1Database(sqliteDb);
      } else {
        sqliteDb.exec("DELETE FROM articles;");
      }
    });

    it("空の記事配列を渡した場合に 0 を返し安全に完了すること", async () => {
      const count = await upsertArticles(mockD1, []);
      expect(count).toBe(0);
    });

    it("記事配列を一括 upsert し、getArticlesByPublishedDate でスコア降順に取得できること", async () => {
      const sampleVec = new Float32Array(1024).fill(0.1);

      const articles: ArticleInput[] = [
        {
          id: "art-1",
          title: "低スコア記事",
          url: "https://example.com/1",
          source_name: "Source A",
          summary: "要約1",
          score: 40,
          published_at: "2026-08-20T01:00:00.000Z", // JST 2026-08-20
          embedding: sampleVec,
        },
        {
          id: "art-2",
          title: "高スコア記事",
          url: "https://example.com/2",
          source_name: "Source B",
          summary: "要約2",
          score: 95,
          published_at: "2026-08-19T20:00:00.000Z", // JST 2026-08-20
          embedding: sampleVec,
        },
        {
          id: "art-3",
          title: "前日記事",
          url: "https://example.com/3",
          source_name: "Source C",
          summary: "要約3",
          score: 80,
          published_at: "2026-08-19T10:00:00.000Z", // JST 2026-08-19
          embedding: sampleVec,
        },
      ];

      const insertedCount = await upsertArticles(mockD1, articles);
      expect(insertedCount).toBe(3);

      // 2026-08-20 の記事を取得
      const results20 = await getArticlesByPublishedDate(mockD1, "2026-08-20");
      expect(results20).toHaveLength(2);
      expect(results20[0].id).toBe("art-2");
      expect(results20[0].score).toBe(95);
      expect(results20[0].published_date_jst).toBe("2026-08-20");
      expect(results20[1].id).toBe("art-1");
      expect(results20[1].score).toBe(40);

      // 2026-08-19 の記事を取得
      const results19 = await getArticlesByPublishedDate(mockD1, "2026-08-19");
      expect(results19).toHaveLength(1);
      expect(results19[0].id).toBe("art-3");
    });

    it("同一 URL の記事を再 upsert した場合に情報が更新され重複しないこと", async () => {
      const initialArticle: ArticleInput = {
        id: "art-orig",
        title: "初回タイトル",
        url: "https://example.com/same-url",
        source_name: "Source Initial",
        summary: "初回要約",
        score: 60,
        published_at: "2026-08-20T00:00:00.000Z",
        embedding: new Float32Array(1024).fill(0.2),
      };

      await upsertArticles(mockD1, [initialArticle]);

      const updatedArticle: ArticleInput = {
        id: "art-updated",
        title: "更新後タイトル",
        url: "https://example.com/same-url",
        source_name: "Source Updated",
        summary: "更新後要約",
        score: 99,
        published_at: "2026-08-20T02:00:00.000Z",
        // embedding が省略/null の場合でも既存 embedding を維持
      };

      await upsertArticles(mockD1, [updatedArticle]);

      const results = await getArticlesByPublishedDate(mockD1, "2026-08-20");
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("更新後タイトル");
      expect(results[0].score).toBe(99);
      expect(results[0].summary).toBe("更新後要約");
    });

    it("getArticlesByPublishedDate で limit と offset によるページネーションが動作すること", async () => {
      const articles: ArticleInput[] = Array.from({ length: 5 }, (_, i) => ({
        id: `page-art-${i}`,
        title: `記事 ${i}`,
        url: `https://example.com/p/${i}`,
        source_name: "Source",
        score: (i + 1) * 10,
        published_at: "2026-08-20T03:00:00.000Z",
      }));

      await upsertArticles(mockD1, articles);

      // 上位2件 (スコア 50, 40)
      const page1 = await getArticlesByPublishedDate(mockD1, "2026-08-20", {
        limit: 2,
        offset: 0,
      });
      expect(page1).toHaveLength(2);
      expect(page1[0].score).toBe(50);
      expect(page1[1].score).toBe(40);

      // 次の2件 (スコア 30, 20)
      const page2 = await getArticlesByPublishedDate(mockD1, "2026-08-20", {
        limit: 2,
        offset: 2,
      });
      expect(page2).toHaveLength(2);
      expect(page2[0].score).toBe(30);
      expect(page2[1].score).toBe(20);
    });

    it("searchArticlesByVector で類似度上位の記事を検索・ソートして取得できること", async () => {
      // 3つの異なるベクトルを用意
      const queryVec = new Float32Array(1024);
      queryVec[0] = 1.0; // クエリベクトル: [1, 0, 0, ...]

      const targetVecHigh = new Float32Array(1024);
      targetVecHigh[0] = 0.95;
      targetVecHigh[1] = 0.05; // 類似度極めて高い

      const targetVecMid = new Float32Array(1024);
      targetVecMid[0] = 0.5;
      targetVecMid[1] = 0.5; // 類似度中程度

      const targetVecLow = new Float32Array(1024);
      targetVecLow[1] = 1.0; // 類似度 0

      const articles: ArticleInput[] = [
        {
          id: "search-mid",
          title: "類似度中記事",
          url: "https://example.com/s/mid",
          source_name: "Search Source",
          score: 70,
          published_at: "2026-08-20T00:00:00.000Z",
          embedding: targetVecMid,
        },
        {
          id: "search-high",
          title: "類似度高記事",
          url: "https://example.com/s/high",
          source_name: "Search Source",
          score: 85,
          published_at: "2026-08-20T00:00:00.000Z",
          embedding: targetVecHigh,
        },
        {
          id: "search-low",
          title: "類似度低記事",
          url: "https://example.com/s/low",
          source_name: "Search Source",
          score: 90,
          published_at: "2026-08-20T00:00:00.000Z",
          embedding: targetVecLow,
        },
        {
          id: "search-no-vec",
          title: "ベクトル未登録記事",
          url: "https://example.com/s/novec",
          source_name: "Search Source",
          score: 99,
          published_at: "2026-08-20T00:00:00.000Z",
          embedding: null,
        },
      ];

      await upsertArticles(mockD1, articles);

      // 類似度順に検索 (minSimilarity = 0.1, limit = 10)
      const results = await searchArticlesByVector(mockD1, queryVec, {
        minSimilarity: 0.1,
        limit: 10,
      });

      expect(results).toHaveLength(2); // search-low (sim 0) と search-no-vec は除外
      expect(results[0].id).toBe("search-high");
      expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
      expect(results[1].id).toBe("search-mid");
    });
  });
});
