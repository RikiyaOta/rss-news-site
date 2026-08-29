import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { syncArticlesToD1, D1SyncOptions } from "../../src/pipeline/d1-sync";
import { ArticleInput } from "../../src/server/db/articles";

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

  it("再同期時に公開日時が前進しないよう ON CONFLICT 句で MIN() による日付保持が指定されること", async () => {
    let capturedPayload: any;

    const mockFetch = vi.fn().mockImplementation((_url, init) => {
      capturedPayload = JSON.parse(init.body);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });
    });

    await syncArticlesToD1({
      accountId: "acc-test",
      databaseId: "db-test",
      apiToken: "token-test",
      articles: [sampleArticles[0]],
      customFetch: mockFetch as unknown as typeof fetch,
    });

    expect(capturedPayload.sql).toContain(
      "published_at = MIN(excluded.published_at, articles.published_at)",
    );
    expect(capturedPayload.sql).toContain(
      "published_date_jst = MIN(excluded.published_date_jst, articles.published_date_jst)",
    );
  });

  it("D1 REST API の制約に則り、送信される SQL が単一ステートメントであり、プレースホルダー (?) の個数と params.length が完全一致すること", async () => {
    let capturedPayload: any;

    const mockFetch = vi.fn().mockImplementation((_url, init) => {
      capturedPayload = JSON.parse(init.body);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });
    });

    await syncArticlesToD1({
      accountId: "acc-test",
      databaseId: "db-test",
      apiToken: "tok-test",
      articles: sampleArticles,
      customFetch: mockFetch as any,
    });

    const trimmedSql = capturedPayload.sql.trim();
    const statements = trimmedSql.split(";").filter((s: string) => s.trim().length > 0);
    expect(statements.length).toBe(1);

    const placeholderCount = (capturedPayload.sql.match(/\?/g) || []).length;
    expect(placeholderCount).toBe(capturedPayload.params.length);
    expect(placeholderCount).toBe(sampleArticles.length * 8);
  });

  it("SQL インジェクション攻撃文字列を含む記事データが安全にパラメータ化されること", async () => {
    let capturedPayload: any;

    const mockFetch = vi.fn().mockImplementation((_url, init) => {
      capturedPayload = JSON.parse(init.body);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });
    });

    const maliciousArticles: ArticleInput[] = [
      {
        id: "art-sql-inject-1",
        title: "Normal Title'); DROP TABLE articles; --",
        url: "https://example.com/attack?p=1'; DELETE FROM articles WHERE '1'='1",
        source_name: "Evil Feed' OR '1'='1",
        summary: "Summary with quotes: ' \" ` and special chars; DROP TABLE articles; --",
        score: 99,
        published_at: "2026-08-19T00:00:00.000Z",
        embedding: new Float32Array(1024).fill(0.5),
      },
    ];

    await syncArticlesToD1({
      accountId: "acc-test",
      databaseId: "db-test",
      apiToken: "tok-test",
      articles: maliciousArticles,
      customFetch: mockFetch as any,
    });

    // 悪意ある文字列が SQL 文字列に直接埋め込まれず、params 配列に安全に隔離されていること
    expect(capturedPayload.sql).not.toContain("DROP TABLE");
    expect(capturedPayload.sql).not.toContain("DELETE FROM");
    expect(capturedPayload.params).toContain("Normal Title'); DROP TABLE articles; --");
    expect(capturedPayload.params).toContain("Evil Feed' OR '1'='1");
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

  it("デフォルト batchSize = 5 で送信される SQL 文字列長が SQLite の SQLITE_MAX_SQL_LENGTH (100KB) を下回ること (SQLITE_TOOBIG 回避)", async () => {
    let capturedPayloads: any[] = [];

    const mockFetch = vi.fn().mockImplementation((_url, init) => {
      capturedPayloads.push(JSON.parse(init.body));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });
    });

    const articles12: ArticleInput[] = Array.from({ length: 12 }, (_, i) => ({
      id: `art-${i.toString().padStart(12, "0")}`,
      title: `記事タイトル ${i}`,
      url: `https://example.com/articles/${i}`,
      source_name: "Tech Source",
      summary: "記事の要約スニペットです。".repeat(5),
      score: 80 + (i % 20),
      published_at: "2026-08-19T00:00:00.000Z",
      embedding: new Float32Array(1024).fill(0.01 * (i + 1)),
    }));

    const result = await syncArticlesToD1({
      accountId: "acc-test",
      databaseId: "db-test",
      apiToken: "tok-test",
      articles: articles12,
      customFetch: mockFetch as any,
    });

    expect(result.total).toBe(12);
    expect(result.inserted).toBe(12);
    expect(mockFetch).toHaveBeenCalledTimes(3); // 12件を 5件, 5件, 2件 に分割

    for (const payload of capturedPayloads) {
      const sqlByteLength = Buffer.byteLength(payload.sql, "utf8");
      // 100KB (102400 bytes) の SQLite 上限に対して、5件なら ~42KB で安全
      expect(sqlByteLength).toBeLessThan(50000);
    }
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
    const hexMatch = payload.sql.match(/X'([0-9a-f]+)'/i);
    expect(hexMatch).not.toBeNull();
    expect(hexMatch?.[1].length).toBe(1024 * 4 * 2); // 8192 chars
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

  describe("repairPublishedDatesInD1 (既存記事の公開日補正)", () => {
    const repairInputs = [
      {
        url: "https://example.com/articles/wrong-date",
        published_at: "2026-08-25T01:00:00.000Z",
        published_date_jst: "2026-08-25",
      },
      {
        url: "https://example.com/articles/correct-date",
        published_at: "2026-08-27T01:00:00.000Z",
        published_date_jst: "2026-08-27",
      },
    ];

    it("生成される補正 SQL が実際の SQLite 上で、より古い公開日時を持つ行のみを更新すること", async () => {
      const { buildPublishedDateRepairStatement } = await import("../../src/pipeline/d1-sync");
      const db = new Database(":memory:");

      try {
        db.exec(`
          CREATE TABLE articles (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL UNIQUE,
            published_at TEXT NOT NULL,
            published_date_jst TEXT NOT NULL
          );
        `);
        // 収集時刻で誤登録された記事（本来の公開日は 2026-08-25）
        db.prepare("INSERT INTO articles VALUES (?, ?, ?, ?)").run(
          "art-wrong",
          "https://example.com/articles/wrong-date",
          "2026-08-28T09:00:00.000Z",
          "2026-08-28",
        );
        // 既に正しい公開日を持つ記事（更新されないこと）
        db.prepare("INSERT INTO articles VALUES (?, ?, ?, ?)").run(
          "art-correct",
          "https://example.com/articles/correct-date",
          "2026-08-26T01:00:00.000Z",
          "2026-08-26",
        );

        const { sql, params } = buildPublishedDateRepairStatement(repairInputs);
        const info = db.prepare(sql).run(...(params as string[]));

        expect(info.changes).toBe(1);

        const rows = db
          .prepare("SELECT id, published_at, published_date_jst FROM articles ORDER BY id")
          .all() as Array<{ id: string; published_at: string; published_date_jst: string }>;

        expect(rows[0]).toEqual({
          id: "art-correct",
          published_at: "2026-08-26T01:00:00.000Z",
          published_date_jst: "2026-08-26",
        });
        expect(rows[1]).toEqual({
          id: "art-wrong",
          published_at: "2026-08-25T01:00:00.000Z",
          published_date_jst: "2026-08-25",
        });
      } finally {
        db.close();
      }
    });

    it("D1 REST API へ補正 SQL をバッチ送信し、更新件数を返却すること", async () => {
      const { repairPublishedDatesInD1 } = await import("../../src/pipeline/d1-sync");
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ result: [{ meta: { changes: 1 } }], success: true }),
      });

      const result = await repairPublishedDatesInD1({
        accountId: "acc-123",
        databaseId: "db-456",
        apiToken: "token-789",
        articles: repairInputs,
        customFetch: mockFetch as any,
      });

      expect(result.total).toBe(2);
      expect(result.repaired).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.sql).toContain("UPDATE articles");
      expect(body.params).toHaveLength(repairInputs.length * 3);
    });

    it("補正対象が空、または API エラー時に例外を投げず安全に完了すること", async () => {
      const { repairPublishedDatesInD1 } = await import("../../src/pipeline/d1-sync");

      const emptyResult = await repairPublishedDatesInD1({
        accountId: "acc-123",
        databaseId: "db-456",
        apiToken: "token-789",
        articles: [],
      });
      expect(emptyResult).toEqual({ total: 0, repaired: 0 });

      const mockErrorFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "internal error",
      });
      const errorResult = await repairPublishedDatesInD1({
        accountId: "acc-123",
        databaseId: "db-456",
        apiToken: "token-789",
        articles: repairInputs,
        customFetch: mockErrorFetch as any,
      });
      expect(errorResult.repaired).toBe(0);
      expect(errorResult.errors?.length).toBeGreaterThan(0);
    });
  });
});
