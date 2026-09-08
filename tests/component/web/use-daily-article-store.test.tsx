// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import {
  useDailyArticleStore,
  INITIAL_DAILY_PAGE,
} from "../../../src/web/hooks/useDailyArticleStore";
import * as apiClient from "../../../src/web/lib/api-client";
import { Article } from "../../../src/shared/types";

vi.mock("../../../src/web/lib/api-client");

function articles(count: number, prefix = "art"): Article[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    title: `${prefix} ${i + 1}`,
    url: `https://example.com/${prefix}/${i}`,
    source_name: "Source",
    summary: "要約",
    score: 80,
    published_at: "2026-08-19T00:00:00.000Z",
  }));
}

describe("useDailyArticleStore フック", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未取得の日付は読み込み中の初期状態を返すこと", () => {
    vi.mocked(apiClient.fetchDailyArticles).mockResolvedValue({ articles: [], total: 0 });
    const { result } = renderHook(() => useDailyArticleStore({ pageSize: 30 }));

    expect(result.current.getPage("2026-08-19")).toEqual(INITIAL_DAILY_PAGE);
  });

  describe("ensurePage", () => {
    it("未取得の日付を取得し、hasMore を全件数から判定すること", async () => {
      vi.mocked(apiClient.fetchDailyArticles).mockResolvedValue({
        articles: articles(30),
        total: 45,
      });
      const { result } = renderHook(() => useDailyArticleStore({ pageSize: 30 }));

      await act(async () => {
        await result.current.ensurePage("2026-08-19");
      });

      const page = result.current.getPage("2026-08-19");
      expect(page.articles).toHaveLength(30);
      expect(page.total).toBe(45);
      expect(page.hasMore).toBe(true);
      expect(page.isLoading).toBe(false);
    });

    it("取得済みの日付は再取得しないこと", async () => {
      vi.mocked(apiClient.fetchDailyArticles).mockResolvedValue({
        articles: articles(3),
        total: 3,
      });
      const { result } = renderHook(() => useDailyArticleStore({ pageSize: 30 }));

      await act(async () => {
        await result.current.ensurePage("2026-08-19");
      });
      await act(async () => {
        await result.current.ensurePage("2026-08-19");
      });

      expect(apiClient.fetchDailyArticles).toHaveBeenCalledTimes(1);
    });

    it("取得に失敗した日付は次の ensurePage で再取得すること", async () => {
      vi.mocked(apiClient.fetchDailyArticles).mockRejectedValueOnce(new Error("接続エラー"));
      const { result } = renderHook(() => useDailyArticleStore({ pageSize: 30 }));

      await act(async () => {
        await result.current.ensurePage("2026-08-19");
      });
      expect(result.current.getPage("2026-08-19").error).toBe("接続エラー");

      vi.mocked(apiClient.fetchDailyArticles).mockResolvedValue({
        articles: articles(2),
        total: 2,
      });
      await act(async () => {
        await result.current.ensurePage("2026-08-19");
      });

      expect(result.current.getPage("2026-08-19").error).toBeNull();
      expect(apiClient.fetchDailyArticles).toHaveBeenCalledTimes(2);
    });

    it("同一日付への同時リクエストを 1 回にまとめること", async () => {
      let resolveFetch: (value: { articles: Article[]; total: number }) => void = () => {};
      vi.mocked(apiClient.fetchDailyArticles).mockImplementation(
        () => new Promise((resolve) => (resolveFetch = resolve)),
      );

      const { result } = renderHook(() => useDailyArticleStore({ pageSize: 30 }));

      await act(async () => {
        void result.current.ensurePage("2026-08-19");
        void result.current.ensurePage("2026-08-19");
        void result.current.reloadPage("2026-08-19");
        resolveFetch({ articles: articles(1), total: 1 });
      });

      await waitFor(() => {
        expect(result.current.getPage("2026-08-19").isLoading).toBe(false);
      });
      expect(apiClient.fetchDailyArticles).toHaveBeenCalledTimes(1);
    });

    it("エラー時はメッセージを保持し、メッセージが無い場合は既定文言にすること", async () => {
      vi.mocked(apiClient.fetchDailyArticles).mockRejectedValueOnce({});
      const { result } = renderHook(() => useDailyArticleStore({ pageSize: 30 }));

      await act(async () => {
        await result.current.ensurePage("2026-08-19");
      });

      expect(result.current.getPage("2026-08-19").error).toBe("日別記事の取得に失敗しました");
    });
  });

  describe("loadMore", () => {
    async function setupLoaded() {
      vi.mocked(apiClient.fetchDailyArticles).mockResolvedValue({
        articles: articles(30),
        total: 45,
      });
      const rendered = renderHook(() => useDailyArticleStore({ pageSize: 30 }));
      await act(async () => {
        await rendered.result.current.ensurePage("2026-08-19");
      });
      return rendered;
    }

    it("次ページを追記し、件数表示用の total を更新すること", async () => {
      const { result } = await setupLoaded();

      vi.mocked(apiClient.fetchDailyArticles).mockResolvedValue({
        articles: articles(15, "more"),
        total: 45,
      });
      await act(async () => {
        await result.current.loadMore("2026-08-19");
      });

      const page = result.current.getPage("2026-08-19");
      expect(page.articles).toHaveLength(45);
      expect(page.total).toBe(45);
      expect(page.hasMore).toBe(false);
      expect(apiClient.fetchDailyArticles).toHaveBeenLastCalledWith(
        "2026-08-19",
        expect.objectContaining({ limit: 30, offset: 30 }),
      );
    });

    it("追加取得が 0 件だった場合は hasMore を打ち切ること", async () => {
      const { result } = await setupLoaded();

      // total が古く、実際にはもう記事が無いケース
      vi.mocked(apiClient.fetchDailyArticles).mockResolvedValue({ articles: [], total: 45 });
      await act(async () => {
        await result.current.loadMore("2026-08-19");
      });

      expect(result.current.getPage("2026-08-19").hasMore).toBe(false);
    });

    it("追加取得に失敗した場合はエラーを保持しつつ既存の記事を保つこと", async () => {
      const { result } = await setupLoaded();

      vi.mocked(apiClient.fetchDailyArticles).mockRejectedValueOnce(new Error("追加取得エラー"));
      await act(async () => {
        await result.current.loadMore("2026-08-19");
      });

      const page = result.current.getPage("2026-08-19");
      expect(page.error).toBe("追加取得エラー");
      expect(page.isLoadingMore).toBe(false);
      // 既に読み込んだ記事は消えない
      expect(page.articles).toHaveLength(30);
    });

    it("エラーオブジェクトにメッセージが無い場合は既定文言にすること", async () => {
      const { result } = await setupLoaded();

      vi.mocked(apiClient.fetchDailyArticles).mockRejectedValueOnce({});
      await act(async () => {
        await result.current.loadMore("2026-08-19");
      });

      expect(result.current.getPage("2026-08-19").error).toBe("追加記事の取得に失敗しました");
    });

    it("hasMore が false の日付では追加取得を行わないこと", async () => {
      vi.mocked(apiClient.fetchDailyArticles).mockResolvedValue({
        articles: articles(3),
        total: 3,
      });
      const { result } = renderHook(() => useDailyArticleStore({ pageSize: 30 }));
      await act(async () => {
        await result.current.ensurePage("2026-08-19");
      });
      vi.mocked(apiClient.fetchDailyArticles).mockClear();

      await act(async () => {
        await result.current.loadMore("2026-08-19");
      });

      expect(apiClient.fetchDailyArticles).not.toHaveBeenCalled();
    });

    it("未取得の日付に対する loadMore は何もしないこと", async () => {
      vi.mocked(apiClient.fetchDailyArticles).mockResolvedValue({ articles: [], total: 0 });
      const { result } = renderHook(() => useDailyArticleStore({ pageSize: 30 }));

      await act(async () => {
        await result.current.loadMore("2026-08-19");
      });

      expect(apiClient.fetchDailyArticles).not.toHaveBeenCalled();
    });
  });

  it("apiBaseUrl が API 呼び出しへ引き渡されること", async () => {
    vi.mocked(apiClient.fetchDailyArticles).mockResolvedValue({ articles: [], total: 0 });
    const { result } = renderHook(() =>
      useDailyArticleStore({ pageSize: 10, apiBaseUrl: "https://api.example.com" }),
    );

    await act(async () => {
      await result.current.ensurePage("2026-08-19");
    });

    expect(apiClient.fetchDailyArticles).toHaveBeenCalledWith("2026-08-19", {
      limit: 10,
      offset: 0,
      baseUrl: "https://api.example.com",
    });
  });
});
