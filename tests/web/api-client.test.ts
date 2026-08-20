import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchDailyArticles, searchArticles } from "../../src/web/lib/api-client";
import { Article, SearchResultItem } from "../../src/shared/types";

describe("API クライアント (api-client.ts) のテスト", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("fetchDailyArticles (日別記事一覧取得)", () => {
    const mockArticles: Article[] = [
      {
        id: "art-1",
        title: "Workers AI と D1 による超高速検索",
        url: "https://example.com/1",
        source_name: "Tech News",
        summary: "Workers AI と D1 を活用したアーキテクチャの解説",
        score: 90,
        published_at: "2026-08-20T00:00:00.000Z",
      },
    ];

    it("指定した日付のデフォルトパラメータ（limit=30, offset=0）で GET リクエストを送信し記事一覧を取得できること", async () => {
      const mockResponse = {
        date: "2026-08-20",
        total: 1,
        articles: mockArticles,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await fetchDailyArticles("2026-08-20");

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const callUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(callUrl).toContain("/api/articles");
      expect(callUrl).toContain("date=2026-08-20");
      expect(callUrl).toContain("limit=30");
      expect(callUrl).toContain("offset=0");

      expect(result).toEqual(mockArticles);
    });

    it("カスタムオプション（limit, offset, baseUrl）が正しく URL に反映されること", async () => {
      const mockResponse = {
        date: "2026-08-20",
        total: 1,
        articles: mockArticles,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await fetchDailyArticles("2026-08-20", {
        limit: 10,
        offset: 20,
        baseUrl: "https://api.example.com",
      });

      const callUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(callUrl).toBe(
        "https://api.example.com/api/articles?date=2026-08-20&limit=10&offset=20",
      );
      expect(result).toEqual(mockArticles);
    });

    it("レスポンスの articles フィールドが空または存在しない場合に空配列を返却すること", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ date: "2026-08-20", total: 0 }),
      });

      const result = await fetchDailyArticles("2026-08-20");
      expect(result).toEqual([]);
    });

    it("HTTP エラーレスポンス（ステータス 500）の場合にエラーメッセージ付きで例外をスローすること", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({ error: "データベース接続に失敗しました" }),
      });

      await expect(fetchDailyArticles("2026-08-20")).rejects.toThrow(
        "データベース接続に失敗しました",
      );
    });

    it("エラーレスポンスに JSON ボディが含まれない場合でもステータス情報付きで例外をスローすること", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      await expect(fetchDailyArticles("2026-08-20")).rejects.toThrow("API エラー: 502 Bad Gateway");
    });

    it("ネットワーク障害発生時に例外をスローすること", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("ネットワーク接続が切断されました"));

      await expect(fetchDailyArticles("2026-08-20")).rejects.toThrow(
        "ネットワーク接続が切断されました",
      );
    });
  });

  describe("searchArticles (セマンティック検索)", () => {
    const mockSearchResults: SearchResultItem[] = [
      {
        id: "art-s1",
        title: "BGE-M3 による多言語セマンティック検索",
        url: "https://example.com/s1",
        source_name: "AI Lab",
        summary: "BGE-M3 モデルの多言語検索精度の検証レポート",
        score: 92,
        published_at: "2026-08-20T00:00:00.000Z",
        date: "2026-08-20",
        similarity: 0.88,
      },
    ];

    it("検索クエリを正しく URL エンコードして GET リクエストを送信し検索結果を取得できること", async () => {
      const mockResponse = {
        query: "機械学習 & AI",
        total: 1,
        results: mockSearchResults,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await searchArticles("機械学習 & AI");

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const callUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(callUrl).toContain("/api/search");
      expect(callUrl).toContain("q=" + encodeURIComponent("機械学習 & AI"));
      expect(callUrl).toContain("limit=30");

      expect(result).toEqual(mockSearchResults);
    });

    it("カスタムオプション（limit, baseUrl）が正しく URL に反映されること", async () => {
      const mockResponse = {
        query: "TypeScript",
        total: 1,
        results: mockSearchResults,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await searchArticles("TypeScript", {
        limit: 15,
        baseUrl: "https://api.example.com",
      });

      const callUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(callUrl).toBe(
        `https://api.example.com/api/search?q=${encodeURIComponent("TypeScript")}&limit=15`,
      );
      expect(result).toEqual(mockSearchResults);
    });

    it("空クエリの場合はリクエストを送信せず即座に空配列を返却すること", async () => {
      globalThis.fetch = vi.fn();

      const result = await searchArticles("   ");
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it("検索エラーレスポンス（ステータス 400）の場合にエラーメッセージ付きで例外をスローすること", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () => ({ error: "検索クエリ 'q' は必須です" }),
      });

      await expect(searchArticles("test")).rejects.toThrow("検索クエリ 'q' は必須です");
    });

    it("ネットワーク障害発生時に例外をスローすること", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("接続タイムアウト"));

      await expect(searchArticles("test")).rejects.toThrow("接続タイムアウト");
    });
  });
});
