import { describe, it, expect, beforeEach, vi } from "vitest";
import initSqlJs from "sql.js";
import {
  cosineSimilarity,
  getSql,
  loadDatabaseFromUrl,
  clearDatabaseCache,
  fetchDailyArticles,
  searchArticlesByVector,
} from "../../src/web/lib/sqlite-client";
import { getR2PublicBaseUrl } from "../../src/web/lib/r2-client";

describe("R2 公開ベースURL取得 (getR2PublicBaseUrl)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  it("VITE_R2_PUBLIC_URL が設定されている場合、そのURLを返却すること", () => {
    process.env.VITE_R2_PUBLIC_URL = "https://r2.example.com";
    expect(getR2PublicBaseUrl()).toBe("https://r2.example.com");
  });

  it("R2_PUBLIC_URL のフォールバック環境変数を認識すること", () => {
    delete process.env.VITE_R2_PUBLIC_URL;
    process.env.R2_PUBLIC_URL = "https://r2-fallback.example.com";
    expect(getR2PublicBaseUrl()).toBe("https://r2-fallback.example.com");
  });

  it("末尾にスラッシュがある場合、末尾スラッシュを除去して返却すること", () => {
    process.env.VITE_R2_PUBLIC_URL = "https://r2.example.com///";
    expect(getR2PublicBaseUrl()).toBe("https://r2.example.com");
  });

  it("環境変数が未設定の場合、空文字を返却すること", () => {
    delete process.env.VITE_R2_PUBLIC_URL;
    delete process.env.R2_PUBLIC_URL;
    expect(getR2PublicBaseUrl()).toBe("");
  });
});

describe("コサイン類似度計算 (cosineSimilarity)", () => {
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

  it("逆向きのベクトルに対してコサイン類似度 -1.0 を返すこと", () => {
    const vec1 = new Float32Array([1, 0, 0]);
    const vec2 = new Float32Array([-1, 0, 0]);
    expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(-1.0);
  });

  it("384次元の正規化済みベクトル間で正しいコサイン類似度を計算できること", () => {
    const vecA = new Float32Array(384);
    const vecB = new Float32Array(384);
    const val = 1 / Math.sqrt(384);
    for (let i = 0; i < 384; i++) {
      vecA[i] = val;
      vecB[i] = val;
    }
    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0);
  });

  it("ベクトルの次元数が一致しない場合はエラーを投げること", () => {
    const vec1 = new Float32Array([1, 0]);
    const vec2 = new Float32Array([1, 0, 0]);
    expect(() => cosineSimilarity(vec1, vec2)).toThrow("ベクトルの次元数が一致しません");
  });

  it("ベクトルが null や undefined の場合はエラーを投げること", () => {
    const vec1 = new Float32Array([1, 0]);
    expect(() => cosineSimilarity(vec1, null as any)).toThrow("ベクトルの次元数が一致しません");
    expect(() => cosineSimilarity(undefined as any, vec1)).toThrow(
      "ベクトルの次元数が一致しません",
    );
  });
});

describe("Wasm SQLite クライアント & 差分DB結合 (sqlite-client)", () => {
  let SQL: any;
  let dailyDbBuffer1: Uint8Array;
  let dailyDbBuffer2: Uint8Array;
  let searchDbBuffer: Uint8Array;

  beforeEach(async () => {
    clearDatabaseCache();
    SQL = await initSqlJs();

    // 日別DB 1 (2026-08-18.db) の作成
    const db1 = new SQL.Database();
    db1.run(`
      CREATE TABLE articles (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        source_name TEXT NOT NULL,
        summary TEXT NOT NULL,
        score INTEGER NOT NULL,
        published_at TEXT NOT NULL
      );
    `);
    db1.run(`
      INSERT INTO articles VALUES
        ('id-1', '過去記事1: TypeScript入門', 'https://example.com/1', 'Zenn', 'TS基礎要約', 70, '2026-08-18T10:00:00Z'),
        ('id-2', '過去記事2: Rust入門', 'https://example.com/2', 'Hacker News', 'Rust基礎要約', 85, '2026-08-18T12:00:00Z');
    `);
    dailyDbBuffer1 = db1.export();
    db1.close();

    // 日別DB 2 (2026-08-19.db) の作成
    const db2 = new SQL.Database();
    db2.run(`
      CREATE TABLE articles (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        source_name TEXT NOT NULL,
        summary TEXT NOT NULL,
        score INTEGER NOT NULL,
        published_at TEXT NOT NULL
      );
    `);
    db2.run(`
      INSERT INTO articles VALUES
        ('id-3', '本日記事1: AI Agents最新動向', 'https://example.com/3', 'Zenn', 'AIエージェント要約', 95, '2026-08-19T08:00:00Z'),
        ('id-4', '本日記事2: Cloudflare Workers解説', 'https://example.com/4', 'DevelopersIO', 'Workers要約', 90, '2026-08-19T09:00:00Z');
    `);
    dailyDbBuffer2 = db2.export();
    db2.close();

    // 検索インデックスDB (search_index.db) の作成
    const sDb = new SQL.Database();
    sDb.run(`
      CREATE TABLE search_index (
        article_id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        embedding BLOB NOT NULL
      );
    `);

    // 384次元ベクトル作成
    const createVector = (primaryIdx: number): Float32Array => {
      const vec = new Float32Array(384);
      vec[primaryIdx] = 1.0;
      return vec;
    };

    const stmt = sDb.prepare("INSERT INTO search_index VALUES (?, ?, ?)");
    // id-1: index 0 に近いベクトル (date: 2026-08-18)
    stmt.run(["id-1", "2026-08-18", new Uint8Array(createVector(0).buffer)]);
    // id-2: index 1 に近いベクトル (date: 2026-08-18)
    stmt.run(["id-2", "2026-08-18", new Uint8Array(createVector(1).buffer)]);
    // id-3: index 0 に近いベクトル (date: 2026-08-19)
    stmt.run(["id-3", "2026-08-19", new Uint8Array(createVector(0).buffer)]);
    // id-4: index 2 に近いベクトル (date: 2026-08-19)
    stmt.run(["id-4", "2026-08-19", new Uint8Array(createVector(2).buffer)]);
    stmt.free();

    searchDbBuffer = sDb.export();
    sDb.close();
  });

  const createMockFetch = () => {
    return vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("2026-08-18.db")) {
        return new Response(dailyDbBuffer1.buffer as ArrayBuffer, { status: 200 });
      }
      if (urlStr.includes("2026-08-19.db")) {
        return new Response(dailyDbBuffer2.buffer as ArrayBuffer, { status: 200 });
      }
      if (urlStr.includes("search_index.db")) {
        return new Response(searchDbBuffer.buffer as ArrayBuffer, { status: 200 });
      }
      return new Response("Not Found", { status: 404, statusText: "Not Found" });
    }) as unknown as typeof fetch;
  };

  it("fetchDailyArticles: 日別DBからスコア降順で記事一覧を取得できること", async () => {
    const mockFetch = createMockFetch();
    const articles = await fetchDailyArticles(
      "https://r2.example.com",
      "2026-08-19",
      mockFetch,
      SQL,
    );

    expect(articles).toHaveLength(2);
    expect(articles[0].id).toBe("id-3");
    expect(articles[0].score).toBe(95);
    expect(articles[0].title).toBe("本日記事1: AI Agents最新動向");
    expect(articles[1].id).toBe("id-4");
    expect(articles[1].score).toBe(90);
  });

  it("fetchDailyArticles: 存在しない日付（404）の場合は空配列を返却すること", async () => {
    const mockFetch = createMockFetch();
    const articles = await fetchDailyArticles(
      "https://r2.example.com",
      "2026-01-01",
      mockFetch,
      SQL,
    );
    expect(articles).toEqual([]);
  });

  it("fetchDailyArticles: テーブルが存在しないなどのDBエラー時に空配列を返却すること", async () => {
    const emptyDb = new SQL.Database();
    const emptyBuffer = emptyDb.export();
    emptyDb.close();

    const mockFetch = vi.fn(
      async () => new Response(emptyBuffer.buffer as ArrayBuffer, { status: 200 }),
    ) as unknown as typeof fetch;

    const articles = await fetchDailyArticles(
      "https://r2.example.com",
      "empty-date",
      mockFetch,
      SQL,
    );
    expect(articles).toEqual([]);
  });

  it("loadDatabaseFromUrl: DBインスタンスをキャッシュし、2回目以降はfetchを行わないこと", async () => {
    const mockFetch = createMockFetch();
    const url = "https://r2.example.com/data/2026-08-19.db";

    const dbInstance1 = await loadDatabaseFromUrl(url, mockFetch, SQL);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const dbInstance2 = await loadDatabaseFromUrl(url, mockFetch, SQL);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(dbInstance1).toBe(dbInstance2);
  });

  it("loadDatabaseFromUrl: HTTPステータスがエラーの場合はエラーを投げること", async () => {
    const errorFetch = vi.fn(
      async () =>
        new Response("Server Error", { status: 500, statusText: "Internal Server Error" }),
    ) as unknown as typeof fetch;

    await expect(
      loadDatabaseFromUrl("https://r2.example.com/data/err.db", errorFetch, SQL),
    ).rejects.toThrow("DBのダウンロードに失敗しました: 500 Internal Server Error");
  });

  it("clearDatabaseCache: キャッシュをクリアすると次回再fetchが行われること", async () => {
    const mockFetch = createMockFetch();
    const url = "https://r2.example.com/data/2026-08-19.db";

    await loadDatabaseFromUrl(url, mockFetch, SQL);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    clearDatabaseCache();

    await loadDatabaseFromUrl(url, mockFetch, SQL);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("clearDatabaseCache: 既にクローズされたDBがキャッシュに含まれていても安全に処理されること", async () => {
    const mockFetch = createMockFetch();
    const url = "https://r2.example.com/data/2026-08-19.db";
    const db = await loadDatabaseFromUrl(url, mockFetch, SQL);
    db.close();
    expect(() => clearDatabaseCache()).not.toThrow();
  });

  it("searchArticlesByVector: クエリベクトルとのコサイン類似度が高い記事を全期間から横断検索し、該当差分DBのみを結合して類似度降順で返却すること", async () => {
    const mockFetch = createMockFetch();
    const queryVec = new Float32Array(384);
    queryVec[0] = 1.0;

    const results = await searchArticlesByVector("https://r2.example.com", queryVec, {
      topK: 10,
      customFetch: mockFetch,
      customSql: SQL,
    });

    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].similarity).toBeCloseTo(1.0);
    expect(results[1].similarity).toBeCloseTo(1.0);

    const resultIds = results.slice(0, 2).map((r) => r.id);
    expect(resultIds).toContain("id-1");
    expect(resultIds).toContain("id-3");

    const item1 = results.find((r) => r.id === "id-1");
    expect(item1?.date).toBe("2026-08-18");
    expect(item1?.title).toBe("過去記事1: TypeScript入門");
    expect(item1?.summary).toBe("TS基礎要約");

    const item3 = results.find((r) => r.id === "id-3");
    expect(item3?.date).toBe("2026-08-19");
    expect(item3?.title).toBe("本日記事1: AI Agents最新動向");
    expect(item3?.score).toBe(95);
  });

  it("searchArticlesByVector: topK 件数制限が正しく機能すること", async () => {
    const mockFetch = createMockFetch();
    const queryVec = new Float32Array(384);
    queryVec[0] = 1.0;

    const results = await searchArticlesByVector("https://r2.example.com", queryVec, {
      topK: 1,
      customFetch: mockFetch,
      customSql: SQL,
    });

    expect(results).toHaveLength(1);
  });

  it("searchArticlesByVector: search_index.db が 404 の場合は空配列を返却すること", async () => {
    const notFoundFetch = vi.fn(
      async () => new Response("Not Found", { status: 404 }),
    ) as unknown as typeof fetch;
    const queryVec = new Float32Array(384);
    const results = await searchArticlesByVector("https://r2.example.com", queryVec, {
      customFetch: notFoundFetch,
      customSql: SQL,
    });
    expect(results).toEqual([]);
  });

  it("searchArticlesByVector: レコードが空の search_index.db の場合は空配列を返却すること", async () => {
    const emptySearchDb = new SQL.Database();
    emptySearchDb.run(`
      CREATE TABLE search_index (
        article_id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        embedding BLOB NOT NULL
      );
    `);
    const emptyBuffer = emptySearchDb.export();
    emptySearchDb.close();

    const mockFetch = vi.fn(
      async () => new Response(emptyBuffer.buffer as ArrayBuffer, { status: 200 }),
    ) as unknown as typeof fetch;

    const queryVec = new Float32Array(384);
    const results = await searchArticlesByVector("https://r2.example.com", queryVec, {
      customFetch: mockFetch,
      customSql: SQL,
    });
    expect(results).toEqual([]);
  });

  it("searchArticlesByVector: search_index テーブルが存在しない場合は空配列を返却すること", async () => {
    const emptyDb = new SQL.Database();
    const emptyBuffer = emptyDb.export();
    emptyDb.close();

    const mockFetch = vi.fn(
      async () => new Response(emptyBuffer.buffer as ArrayBuffer, { status: 200 }),
    ) as unknown as typeof fetch;

    const queryVec = new Float32Array(384);
    const results = await searchArticlesByVector("https://r2.example.com", queryVec, {
      customFetch: mockFetch,
      customSql: SQL,
    });
    expect(results).toEqual([]);
  });

  it("searchArticlesByVector: 一部の日別DBが取得できない場合でも取得できた記事のみを返却すること", async () => {
    const partialFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("2026-08-19.db")) {
        return new Response(dailyDbBuffer2.buffer as ArrayBuffer, { status: 200 });
      }
      if (urlStr.includes("search_index.db")) {
        return new Response(searchDbBuffer.buffer as ArrayBuffer, { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    }) as unknown as typeof fetch;

    const queryVec = new Float32Array(384);
    queryVec[0] = 1.0;

    const results = await searchArticlesByVector("https://r2.example.com", queryVec, {
      topK: 10,
      customFetch: partialFetch,
      customSql: SQL,
    });

    expect(results.find((r) => r.id === "id-1")).toBeUndefined();
    expect(results.find((r) => r.id === "id-3")).toBeDefined();
    expect(results.find((r) => r.id === "id-4")).toBeDefined();
    expect(results.every((r) => r.date === "2026-08-19")).toBe(true);
  });

  it("searchArticlesByVector: 非4バイト整列オフセットを持つ Uint8Array BLOB でも RangeError を起こさずに正しく処理できること", async () => {
    // 検索インデックスDB (search_index.db) を作成し、非4バイト整列オフセットの Uint8Array でモック
    const customSDb = new SQL.Database();
    customSDb.run(`
      CREATE TABLE search_index (
        article_id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        embedding BLOB NOT NULL
      );
    `);

    // 384次元ベクトル作成
    const vec = new Float32Array(384);
    vec[0] = 1.0;

    // オフセットが奇数 (例: 1) の Uint8Array を作成
    const largerBuffer = new ArrayBuffer(vec.byteLength + 10);
    const unalignedUint8 = new Uint8Array(largerBuffer, 1, vec.byteLength);
    unalignedUint8.set(new Uint8Array(vec.buffer));

    const stmt = customSDb.prepare("INSERT INTO search_index VALUES (?, ?, ?)");
    stmt.run(["id-3", "2026-08-19", unalignedUint8]);
    stmt.free();

    const customSearchBuffer = customSDb.export();
    customSDb.close();

    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("2026-08-19.db")) {
        return new Response(dailyDbBuffer2.buffer as ArrayBuffer, { status: 200 });
      }
      if (urlStr.includes("search_index.db")) {
        return new Response(customSearchBuffer.buffer as ArrayBuffer, { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    }) as unknown as typeof fetch;

    const queryVec = new Float32Array(384);
    queryVec[0] = 1.0;

    const results = await searchArticlesByVector("https://r2.example.com", queryVec, {
      topK: 10,
      customFetch: mockFetch,
      customSql: SQL,
    });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("id-3");
    expect(results[0].similarity).toBeCloseTo(1.0);
  });

  it("getSql: シングルトンとして同じインスタンスを再利用すること", async () => {
    const sql1 = await getSql();
    const sql2 = await getSql();
    expect(sql1).toBe(sql2);
  });

  it("getSql: 不正な初期化関数が渡された場合にエラーを投げること", async () => {
    await expect(getSql({} as any)).rejects.toThrow("sql.js の初期化関数が見つかりません");
  });
});
