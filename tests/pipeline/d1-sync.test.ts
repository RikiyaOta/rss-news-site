import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { syncArticlesToD1, D1SyncOptions, SCHEMA_STATEMENTS } from "../../src/pipeline/d1-sync";
import { ArticleInput, deserializeVector } from "../../src/server/db/articles";

describe("Cloudflare D1 同期モジュール (src/pipeline/d1-sync) のテスト", () => {
  const sampleArticles: ArticleInput[] = [
    {
      id: "art-111111111111",
      title: "TypeScript 5.8 の最新機能解説",
      url: "https://example.com/articles/ts-58",
      source_name: "Tech Feed 1",
      summary: "TypeScript 5.8の新機能と改善点について解説します。",
      score: 85,
      published_at: "2026-08-19T00:00:00.000Z",
      embedding: new Float32Array(1024).fill(0.05),
    },
    {
      id: "art-222222222222",
      title: "Cloudflare D1 と Hono によるエッジAPI設計",
      url: "https://example.com/articles/d1-hono",
      source_name: "Tech Feed 2",
      summary: "エッジ環境での軽量データベース配信パターンの検証。",
      score: 92,
      published_at: "2026-08-19T01:00:00.000Z",
      embedding: new Float32Array(1024).fill(0.1),
    },
    {
      id: "art-333333333333",
      title: "BGE-M3 による多言語ベクトル検索の実装",
      url: "https://example.com/articles/bge-m3",
      source_name: "Tech Feed 1",
      summary: "1024次元ベクトルによる高精度セマンティック検索。",
      score: 78,
      published_at: "2026-08-19T02:00:00.000Z",
      embedding: new Float32Array(1024).fill(0.02),
    },
  ];

  it("記事配列を D1 REST API (/raw) にバッチ送信して upsert できること", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        result: [{ success: true, meta: { changes: 3 } }],
        success: true,
        errors: [],
        messages: [],
      }),
    });

    const options: D1SyncOptions = {
      accountId: "acc-123456",
      databaseId: "db-987654",
      apiToken: "cf-token-abc",
      articles: sampleArticles,
      customFetch: mockFetch as any,
    };

    const result = await syncArticlesToD1(options);

    expect(result.total).toBe(3);
    expect(result.inserted).toBe(3);
    expect(result.errors).toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acc-123456/d1/database/db-987654/raw",
    );
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: "Bearer cf-token-abc",
      "Content-Type": "application/json",
    });

    const payload = JSON.parse(init.body);
    expect(payload.sql).toContain("INSERT INTO articles");
    expect(payload.sql).toContain("ON CONFLICT(url) DO UPDATE SET");
    expect(payload.params.length).toBe(3 * 8); // 3 articles * 8 scalar columns (embedding is native hex literal)
  });

  it("生成された D1 /raw SQL とパラメータが実際の SQLite エンジンで構文エラーなく実行され、BLOB ベクトルが正確に復元できること", async () => {
    let capturedSql = "";
    let capturedParams: any[] = [];

    const mockFetch = vi.fn().mockImplementation((_url, init) => {
      const body = JSON.parse(init.body);
      capturedSql = body.sql;
      capturedParams = body.params;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });
    });

    const options: D1SyncOptions = {
      accountId: "acc-test",
      databaseId: "db-test",
      apiToken: "tok-test",
      articles: sampleArticles,
      customFetch: mockFetch as any,
    };

    await syncArticlesToD1(options);

    // 実際の SQLite (インメモリ) で実行して検証
    const db = new Database(":memory:");
    try {
      db.exec(SCHEMA_STATEMENTS);

      // capturedSql を実行（パラメータバインド）
      const stmt = db.prepare(capturedSql);
      stmt.run(...capturedParams);

      // レコード検証
      const rows = db.prepare("SELECT * FROM articles ORDER BY score DESC").all() as any[];
      expect(rows).toHaveLength(3);
      expect(rows[0].title).toBe("Cloudflare D1 と Hono によるエッジAPI設計");
      expect(rows[0].score).toBe(92);

      // BLOB の検証
      expect(Buffer.isBuffer(rows[0].embedding)).toBe(true);
      expect(rows[0].embedding.length).toBe(1024 * 4); // 4096 bytes

      // ベクトルの復元検証
      const restoredVector = deserializeVector(rows[0].embedding);
      expect(restoredVector).toHaveLength(1024);
      expect(restoredVector[0]).toBeCloseTo(0.1, 5);
      expect(restoredVector[1023]).toBeCloseTo(0.1, 5);
    } finally {
      db.close();
    }
  });

  it("ON CONFLICT(url) による既存記事の更新が実際の SQLite エンジンで正しく動作すること", async () => {
    let capturedSql = "";
    let capturedParams: any[] = [];

    const mockFetch = vi.fn().mockImplementation((_url, init) => {
      const body = JSON.parse(init.body);
      capturedSql = body.sql;
      capturedParams = body.params;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });
    });

    const updatedArticle: ArticleInput = {
      ...sampleArticles[0],
      title: "TypeScript 5.8 の最新機能解説 (更新版)",
      score: 99,
    };

    await syncArticlesToD1({
      accountId: "acc-test",
      databaseId: "db-test",
      apiToken: "tok-test",
      articles: [updatedArticle],
      customFetch: mockFetch as any,
    });

    const db = new Database(":memory:");
    try {
      db.exec(SCHEMA_STATEMENTS);
      // 初回挿入
      const initialInsert = db.prepare(
        "INSERT INTO articles (id, title, url, source_name, summary, score, published_at, published_date_jst) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      );
      initialInsert.run(
        sampleArticles[0].id,
        sampleArticles[0].title,
        sampleArticles[0].url,
        sampleArticles[0].source_name,
        sampleArticles[0].summary,
        sampleArticles[0].score,
        sampleArticles[0].published_at,
        "2026-08-19",
      );

      // syncArticlesToD1 が生成した UPSERT SQL を実行
      const stmt = db.prepare(capturedSql);
      stmt.run(...capturedParams);

      const rows = db
        .prepare("SELECT * FROM articles WHERE url = ?")
        .all(sampleArticles[0].url) as any[];
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe("TypeScript 5.8 の最新機能解説 (更新版)");
      expect(rows[0].score).toBe(99);
    } finally {
      db.close();
    }
  });

  it("batchSize に応じて複数回のリクエストに分割して送信されること", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        result: [{ success: true }],
        success: true,
        errors: [],
      }),
    });

    const options: D1SyncOptions = {
      accountId: "acc-123456",
      databaseId: "db-987654",
      apiToken: "cf-token-abc",
      articles: sampleArticles,
      batchSize: 2,
      customFetch: mockFetch as any,
    };

    const result = await syncArticlesToD1(options);

    expect(result.total).toBe(3);
    expect(result.inserted).toBe(3);
    expect(mockFetch).toHaveBeenCalledTimes(2); // 1回目: 2件, 2回目: 1件

    const firstPayload = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(firstPayload.params.length).toBe(2 * 8);

    const secondPayload = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(secondPayload.params.length).toBe(1 * 8);
  });

  it("published_date_jst が未指定の場合に自動計算され、embedding (Float32Array) が SQLite の 16進数 BLOB リテラル (X'...') としてクエリに埋め込まれること", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
      }),
    });

    const options: D1SyncOptions = {
      accountId: "acc-123456",
      databaseId: "db-987654",
      apiToken: "cf-token-abc",
      articles: [sampleArticles[0]],
      customFetch: mockFetch as any,
    };

    await syncArticlesToD1(options);

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    const params = payload.params;

    expect(params[0]).toBe(sampleArticles[0].id);
    expect(params[1]).toBe(sampleArticles[0].title);
    expect(params[2]).toBe(sampleArticles[0].url);
    expect(params[3]).toBe(sampleArticles[0].source_name);
    expect(params[4]).toBe(sampleArticles[0].summary);
    expect(params[5]).toBe(sampleArticles[0].score);
    expect(params[6]).toBe("2026-08-19T00:00:00.000Z");
    expect(params[7]).toBe("2026-08-19"); // JST: UTC 00:00 + 9h -> 2026-08-19 09:00 -> 2026-08-19
    expect(params.length).toBe(8);
    expect(payload.sql).toMatch(/X'[0-9a-f]{8192}'/i); // 1024 * 4 bytes * 2 hex chars = 8192 chars
  });

  it("空の記事配列が渡された場合、リクエストを送信せず total: 0, inserted: 0 を返すこと", async () => {
    const mockFetch = vi.fn();

    const options: D1SyncOptions = {
      accountId: "acc-123456",
      databaseId: "db-987654",
      apiToken: "cf-token-abc",
      articles: [],
      customFetch: mockFetch as any,
    };

    const result = await syncArticlesToD1(options);

    expect(result).toEqual({ total: 0, inserted: 0 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("accountId, databaseId, apiToken のいずれかが欠けている場合に例外をスローすること", async () => {
    await expect(
      syncArticlesToD1({
        accountId: "",
        databaseId: "db-id",
        apiToken: "token",
        articles: sampleArticles,
      }),
    ).rejects.toThrow("Cloudflare D1 設定エラー: accountId, databaseId, apiToken が必要です");

    await expect(
      syncArticlesToD1({
        accountId: "acc-id",
        databaseId: "",
        apiToken: "token",
        articles: sampleArticles,
      }),
    ).rejects.toThrow("Cloudflare D1 設定エラー: accountId, databaseId, apiToken が必要です");

    await expect(
      syncArticlesToD1({
        accountId: "acc-id",
        databaseId: "db-id",
        apiToken: "",
        articles: sampleArticles,
      }),
    ).rejects.toThrow("Cloudflare D1 設定エラー: accountId, databaseId, apiToken が必要です");
  });

  it("D1 REST API がエラー (HTTP 500 や success: false) を返した場合にエラー情報を errors に格納すること", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => JSON.stringify({ errors: [{ code: 1000, message: "Internal Error" }] }),
    });

    const options: D1SyncOptions = {
      accountId: "acc-123456",
      databaseId: "db-987654",
      apiToken: "cf-token-abc",
      articles: [sampleArticles[0]],
      customFetch: mockFetch as any,
    };

    const result = await syncArticlesToD1(options);

    expect(result.total).toBe(1);
    expect(result.inserted).toBe(0);
    expect(result.errors).toBeDefined();
    expect(result.errors?.length).toBeGreaterThan(0);
  });

  describe("fetchExistingUrlsFromD1", () => {
    it("D1 REST API から登録済みの URL 一覧を Set として取得できること", async () => {
      const { fetchExistingUrlsFromD1 } = await import("../../src/pipeline/d1-sync");
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          result: [
            {
              results: [
                { url: "https://example.com/articles/1" },
                { url: "https://example.com/articles/2" },
              ],
            },
          ],
          success: true,
        }),
      });

      const urlSet = await fetchExistingUrlsFromD1({
        accountId: "acc-123",
        databaseId: "db-456",
        apiToken: "token-789",
        sinceDateJst: "2026-08-17",
        customFetch: mockFetch as any,
      });

      expect(urlSet.size).toBe(2);
      expect(urlSet.has("https://example.com/articles/1")).toBe(true);
      expect(urlSet.has("https://example.com/articles/2")).toBe(true);
      expect(urlSet.has("https://example.com/articles/unknown")).toBe(false);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(
        "https://api.cloudflare.com/client/v4/accounts/acc-123/d1/database/db-456/raw",
      );
      const body = JSON.parse(init.body);
      expect(body.sql).toContain("SELECT url FROM articles WHERE published_date_jst >= ?");
      expect(body.params).toEqual(["2026-08-17"]);
    });

    it("設定が不足している場合や API エラー発生時に安全に空の Set を返すこと", async () => {
      const { fetchExistingUrlsFromD1 } = await import("../../src/pipeline/d1-sync");
      const emptySet = await fetchExistingUrlsFromD1({
        accountId: "",
        databaseId: "",
        apiToken: "",
      });
      expect(emptySet.size).toBe(0);

      const mockErrorFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
      const errorSet = await fetchExistingUrlsFromD1({
        accountId: "acc-123",
        databaseId: "db-456",
        apiToken: "token-789",
        customFetch: mockErrorFetch as any,
      });
      expect(errorSet.size).toBe(0);
    });
  });
});
