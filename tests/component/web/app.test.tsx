// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { App } from "../../../src/web/App";
import { adjustDateString } from "../../../src/shared/date";
import * as apiClient from "../../../src/web/lib/api-client";
import { Article, SearchResultItem } from "../../../src/shared/types";

vi.mock("../../../src/web/lib/api-client");

describe("フロントエンド App コンポーネントのテスト", () => {
  const mockDailyArticles: Article[] = [
    {
      id: "art-today-1",
      title: "本日のおすすめAIニュース",
      url: "https://example.com/today-1",
      source_name: "Tech News",
      summary: "・本日の重要AI動向\n・主要機能のアップデート\n・次期リリースの予告",
      score: 95,
      published_at: "2026-08-19T06:00:00.000Z",
    },
    {
      id: "art-today-2",
      title: "TypeScript 5.8の注目変更点",
      url: "https://example.com/today-2",
      source_name: "Dev Portal",
      summary: "・型チェック速度の向上\n・モジュール解決の改善\n・新しいコンパイラオプション",
      score: 75,
      published_at: "2026-08-19T07:00:00.000Z",
    },
  ];

  const mockSearchResults: SearchResultItem[] = [
    {
      id: "art-search-1",
      title: "Workers AI と BGE-M3 による高速推論検証",
      url: "https://example.com/search-1",
      source_name: "AI Lab",
      summary: "・Workers AI での推論\n・高速な多言語ベクトル類似度検索",
      score: 88,
      published_at: "2026-08-18T12:00:00.000Z",
      published_date_jst: "2026-08-18",
      similarity: 0.94,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.fetchDailyArticles).mockResolvedValue({
      articles: mockDailyArticles,
      total: mockDailyArticles.length,
    });
    vi.mocked(apiClient.searchArticles).mockResolvedValue(mockSearchResults);
  });

  it("初期レンダリング時に当日付の記事一覧が API 経由で取得され表示されること", async () => {
    render(<App initialDate="2026-08-19" />);

    await waitFor(() => {
      expect(apiClient.fetchDailyArticles).toHaveBeenCalledWith(
        "2026-08-19",
        expect.objectContaining({
          limit: 30,
          offset: 0,
        }),
      );
    });

    expect(await screen.findByText("本日のおすすめAIニュース")).toBeDefined();
    expect(screen.getByText("TypeScript 5.8の注目変更点")).toBeDefined();
    expect(screen.getByText("RSS News for Me")).toBeDefined();
  });

  it("フッターが描画されず、ヘッダーと記事一覧のみで構成されること", async () => {
    const { container } = render(<App initialDate="2026-08-19" />);

    await screen.findByText("本日のおすすめAIニュース");

    expect(container.querySelector("footer")).toBeNull();
    expect(screen.queryByText(/Powered by/i)).toBeNull();
  });

  it("前日ボタンをクリックすると日付が1日戻り、該当日の記事が読み込まれること", async () => {
    render(<App initialDate="2026-08-19" />);

    await screen.findByText("本日のおすすめAIニュース");

    const prevButton = screen.getByRole("button", { name: /前日/i });
    fireEvent.click(prevButton);

    await waitFor(() => {
      expect(apiClient.fetchDailyArticles).toHaveBeenCalledWith(
        "2026-08-18",
        expect.objectContaining({
          limit: 30,
          offset: 0,
        }),
      );
    });
  });

  it("日付入力欄から日付を変更した際に該当日の記事が読み込まれること", async () => {
    render(<App initialDate="2026-08-19" />);

    await screen.findByText("本日のおすすめAIニュース");

    const dateInput = screen.getByTestId("date-picker-input");
    fireEvent.change(dateInput, { target: { value: "2026-08-15" } });

    await waitFor(() => {
      expect(apiClient.fetchDailyArticles).toHaveBeenCalledWith(
        "2026-08-15",
        expect.objectContaining({
          limit: 30,
          offset: 0,
        }),
      );
    });
  });

  it("検索キーワードを入力して検索を実行すると、API 経由で検索結果が取得され表示されること", async () => {
    render(<App initialDate="2026-08-19" />);

    await screen.findByText("本日のおすすめAIニュース");

    const searchModeBtn = screen.getByRole("button", { name: /セマンティック検索/i });
    fireEvent.click(searchModeBtn);

    const searchInput = screen.getByPlaceholderText(/検索/);
    fireEvent.change(searchInput, { target: { value: "bge-m3" } });

    const searchBtn = screen.getByRole("button", { name: /^検索$/ });
    fireEvent.click(searchBtn);

    await waitFor(() => {
      expect(apiClient.searchArticles).toHaveBeenCalledWith(
        "bge-m3",
        expect.objectContaining({ limit: 30 }),
      );
    });

    expect(await screen.findByText("Workers AI と BGE-M3 による高速推論検証")).toBeDefined();
    expect(screen.getByText(/94%/)).toBeDefined();
  });

  it("検索結果表示中にクリアボタンを押すと日別一覧表示に戻ること", async () => {
    render(<App initialDate="2026-08-19" />);

    await screen.findByText("本日のおすすめAIニュース");

    const searchModeBtn = screen.getByRole("button", { name: /セマンティック検索/i });
    fireEvent.click(searchModeBtn);

    const searchInput = screen.getByPlaceholderText(/検索/);
    fireEvent.change(searchInput, { target: { value: "bge-m3" } });
    fireEvent.click(screen.getByRole("button", { name: /^検索$/ }));

    expect(await screen.findByText("Workers AI と BGE-M3 による高速推論検証")).toBeDefined();

    const clearBtn = screen.getByRole("button", { name: /クリア/i });
    fireEvent.click(clearBtn);

    expect(await screen.findByText("本日のおすすめAIニュース")).toBeDefined();
  });

  it("該当日の記事が0件の場合に空状態メッセージが表示されること", async () => {
    vi.mocked(apiClient.fetchDailyArticles).mockResolvedValueOnce({ articles: [], total: 0 });

    render(<App initialDate="2026-08-19" />);

    expect(await screen.findByText(/記事はまだありません|見つかりませんでした/)).toBeDefined();
  });

  it("記事取得失敗時にエラーメッセージと再試行ボタンが表示され、再試行できること", async () => {
    vi.mocked(apiClient.fetchDailyArticles).mockRejectedValueOnce(
      new Error("ネットワーク接続エラー"),
    );

    render(<App initialDate="2026-08-19" />);

    expect(await screen.findByText(/ネットワーク接続エラー/)).toBeDefined();

    vi.mocked(apiClient.fetchDailyArticles).mockResolvedValueOnce({
      articles: mockDailyArticles,
      total: mockDailyArticles.length,
    });
    const retryBtn = screen.getByRole("button", { name: /再試行/i });
    fireEvent.click(retryBtn);

    expect(await screen.findByText("本日のおすすめAIニュース")).toBeDefined();
  });

  it("さらに読み込むボタンをクリックすると次ページの記事が取得されてリストに追加されること", async () => {
    // 初回30件
    const initialArticles: Article[] = Array.from({ length: 30 }, (_, i) => ({
      id: `art-initial-${i}`,
      title: `記事 ${i + 1}`,
      url: `https://example.com/art-${i}`,
      source_name: "Source",
      summary: `要約 ${i + 1}`,
      score: 80,
      published_at: "2026-08-19T00:00:00.000Z",
    }));

    // 追加10件
    const moreArticles: Article[] = Array.from({ length: 10 }, (_, i) => ({
      id: `art-more-${i}`,
      title: `追加記事 ${i + 1}`,
      url: `https://example.com/more-${i}`,
      source_name: "Source",
      summary: `追加要約 ${i + 1}`,
      score: 70,
      published_at: "2026-08-19T00:00:00.000Z",
    }));

    // 前後日の先読みが挟まるため、日付とオフセットに応じて応答を返す
    const totalForDate = initialArticles.length + moreArticles.length;
    vi.mocked(apiClient.fetchDailyArticles).mockImplementation(async (date, options) => {
      if (date !== "2026-08-19") return { articles: [], total: 0 };
      return {
        articles: (options?.offset ?? 0) === 0 ? initialArticles : moreArticles,
        total: totalForDate,
      };
    });

    render(<App initialDate="2026-08-19" />);

    expect(await screen.findByText("記事 1")).toBeDefined();

    // 「さらに読み込む」ボタン
    const loadMoreBtn = await screen.findByRole("button", { name: /さらに読み込む/i });
    fireEvent.click(loadMoreBtn);

    await waitFor(() => {
      expect(apiClient.fetchDailyArticles).toHaveBeenCalledWith(
        "2026-08-19",
        expect.objectContaining({
          limit: 30,
          offset: 30,
        }),
      );
    });

    expect(await screen.findByText("追加記事 1")).toBeDefined();
    expect(screen.getByText("記事 1")).toBeDefined();
  });

  it("件数表示は読み込み済み件数ではなく、その日の全件数を最初から示すこと", async () => {
    const initialArticles: Article[] = Array.from({ length: 30 }, (_, i) => ({
      id: `art-initial-${i}`,
      title: `記事 ${i + 1}`,
      url: `https://example.com/art-${i}`,
      source_name: "Source",
      summary: `要約 ${i + 1}`,
      score: 80,
      published_at: "2026-08-19T00:00:00.000Z",
    }));

    const moreArticles: Article[] = Array.from({ length: 10 }, (_, i) => ({
      id: `art-more-${i}`,
      title: `追加記事 ${i + 1}`,
      url: `https://example.com/more-${i}`,
      source_name: "Source",
      summary: `追加要約 ${i + 1}`,
      score: 70,
      published_at: "2026-08-19T00:00:00.000Z",
    }));

    vi.mocked(apiClient.fetchDailyArticles).mockImplementation(async (date, options) => {
      if (date !== "2026-08-19") return { articles: [], total: 0 };
      return {
        articles: (options?.offset ?? 0) === 0 ? initialArticles : moreArticles,
        total: 40,
      };
    });

    render(<App initialDate="2026-08-19" />);

    // 30 件しか読み込んでいない時点で全 40 件と表示される
    expect(await screen.findByText("全 40 件の記事")).toBeDefined();

    fireEvent.click(await screen.findByRole("button", { name: /さらに読み込む/i }));

    // 追加読み込み後も件数表示は変わらない
    expect(await screen.findByText("追加記事 1")).toBeDefined();
    expect(screen.getByText("全 40 件の記事")).toBeDefined();
  });

  it("全件を読み込み終えると「さらに読み込む」が表示されなくなること", async () => {
    const articles: Article[] = Array.from({ length: 30 }, (_, i) => ({
      id: `art-${i}`,
      title: `記事 ${i + 1}`,
      url: `https://example.com/art-${i}`,
      source_name: "Source",
      summary: `要約 ${i + 1}`,
      score: 80,
      published_at: "2026-08-19T00:00:00.000Z",
    }));

    // ちょうど 30 件（= ページサイズ）で全件。余分な追加リクエストは発生しない
    vi.mocked(apiClient.fetchDailyArticles).mockImplementation(async (date) =>
      date === "2026-08-19" ? { articles, total: 30 } : { articles: [], total: 0 },
    );

    render(<App initialDate="2026-08-19" />);

    expect(await screen.findByText("全 30 件の記事")).toBeDefined();
    expect(screen.queryByRole("button", { name: /さらに読み込む/i })).toBeNull();
  });

  describe("モバイルのページめくりによる日付移動", () => {
    /** 日付ごとに区別できる記事を返すモックを設定する */
    function mockArticlesByDate() {
      vi.mocked(apiClient.fetchDailyArticles).mockImplementation(async (date) => ({
        articles: [
          {
            id: `art-${date}`,
            title: `${date} の記事`,
            url: `https://example.com/${date}`,
            source_name: "Source",
            summary: `${date} の要約`,
            score: 80,
            published_at: `${date}T00:00:00.000Z`,
          },
        ],
        total: 1,
      }));
    }

    function drag(fromX: number, toX: number, y = 400) {
      const area = screen.getByTestId("daily-swipe-area");
      fireEvent.touchStart(area, { touches: [{ clientX: fromX, clientY: y }] });
      fireEvent.touchMove(area, { touches: [{ clientX: toX, clientY: y }] });
      fireEvent.touchEnd(area, { changedTouches: [{ clientX: toX, clientY: y }] });
    }

    function currentDateValue() {
      return screen.getByTestId("date-picker-input").getAttribute("value");
    }

    it("指を右から左へ動かすと翌日のページへ遷移すること", async () => {
      mockArticlesByDate();
      render(<App initialDate="2026-08-19" />);

      await screen.findByText("2026-08-19 の記事");

      drag(320, 100);

      await waitFor(() => {
        expect(currentDateValue()).toBe("2026-08-20");
      });
      expect(await screen.findByText("2026-08-20 の記事")).toBeDefined();
    });

    it("指を左から右へ動かすと前日のページへ遷移すること", async () => {
      mockArticlesByDate();
      render(<App initialDate="2026-08-19" />);

      await screen.findByText("2026-08-19 の記事");

      drag(100, 320);

      await waitFor(() => {
        expect(currentDateValue()).toBe("2026-08-18");
      });
      expect(await screen.findByText("2026-08-18 の記事")).toBeDefined();
    });

    it("めくっている最中は遷移元と遷移先の記事が同時に表示されること", async () => {
      mockArticlesByDate();
      render(<App initialDate="2026-08-19" />);

      await screen.findByText("2026-08-19 の記事");
      // 先読みの完了を待つ
      await waitFor(() => {
        expect(apiClient.fetchDailyArticles).toHaveBeenCalledWith(
          "2026-08-20",
          expect.objectContaining({ offset: 0 }),
        );
      });

      // 指を離さずドラッグ途中で止める
      const area = screen.getByTestId("daily-swipe-area");
      fireEvent.touchStart(area, { touches: [{ clientX: 320, clientY: 400 }] });
      fireEvent.touchMove(area, { touches: [{ clientX: 220, clientY: 400 }] });

      expect(screen.getByText("2026-08-18 の記事")).toBeDefined();
      expect(screen.getByText("2026-08-19 の記事")).toBeDefined();
      expect(screen.getByText("2026-08-20 の記事")).toBeDefined();
    });

    it("表示中の日付に加えて前日と翌日が先読みされること", async () => {
      render(<App initialDate="2026-08-19" />);

      await screen.findByText("本日のおすすめAIニュース");

      await waitFor(() => {
        expect(apiClient.fetchDailyArticles).toHaveBeenCalledWith(
          "2026-08-18",
          expect.objectContaining({ limit: 30, offset: 0 }),
        );
        expect(apiClient.fetchDailyArticles).toHaveBeenCalledWith(
          "2026-08-20",
          expect.objectContaining({ limit: 30, offset: 0 }),
        );
      });
    });

    it("先読み済みの日付へ遷移した際に再取得が発生しないこと", async () => {
      mockArticlesByDate();
      render(<App initialDate="2026-08-19" />);

      await screen.findByText("2026-08-19 の記事");
      await waitFor(() => {
        expect(apiClient.fetchDailyArticles).toHaveBeenCalledWith(
          "2026-08-18",
          expect.objectContaining({ offset: 0 }),
        );
      });
      vi.mocked(apiClient.fetchDailyArticles).mockClear();

      drag(100, 320);

      await waitFor(() => {
        expect(currentDateValue()).toBe("2026-08-18");
      });
      // 遷移先はキャッシュ済みのため、新たに取得されるのはその前日のみ
      await waitFor(() => {
        const requestedDates = vi
          .mocked(apiClient.fetchDailyArticles)
          .mock.calls.map((call) => call[0]);
        expect(requestedDates).toContain("2026-08-17");
      });
      const requestedDates = vi
        .mocked(apiClient.fetchDailyArticles)
        .mock.calls.map((call) => call[0]);
      expect(requestedDates).not.toContain("2026-08-18");
    });

    it("縦スクロール操作では日付が変更されないこと", async () => {
      render(<App initialDate="2026-08-19" />);

      await screen.findByText("本日のおすすめAIニュース");

      const area = screen.getByTestId("daily-swipe-area");
      fireEvent.touchStart(area, { touches: [{ clientX: 300, clientY: 600 }] });
      fireEvent.touchMove(area, { touches: [{ clientX: 240, clientY: 200 }] });
      fireEvent.touchEnd(area, { changedTouches: [{ clientX: 240, clientY: 200 }] });

      await waitFor(() => {
        expect(currentDateValue()).toBe("2026-08-19");
      });
    });

    it("当日を表示中は翌日方向へめくっても日付が進まないこと", async () => {
      // initialDate を渡さない場合は当日が表示され、翌日への移動が無効となる
      render(<App />);

      await screen.findByText("本日のおすすめAIニュース");
      const todayValue = currentDateValue();

      drag(320, 100);

      await waitFor(() => {
        expect(screen.getByTestId("daily-pager-track").getAttribute("data-pager-phase")).toBe(
          "idle",
        );
      });
      expect(currentDateValue()).toBe(todayValue);
    });

    it("当日を表示中は存在しない翌日の先読みを行わないこと", async () => {
      render(<App />);

      await screen.findByText("本日のおすすめAIニュース");

      await waitFor(() => {
        expect(apiClient.fetchDailyArticles).toHaveBeenCalledTimes(2);
      });
      const requestedDates = vi
        .mocked(apiClient.fetchDailyArticles)
        .mock.calls.map((call) => call[0]);
      const today = requestedDates[0];
      expect(requestedDates).toEqual([today, adjustDateString(today, -1)]);
    });

    it("セマンティック検索モードではめくり操作を受け付けないこと", async () => {
      render(<App initialDate="2026-08-19" />);

      await screen.findByText("本日のおすすめAIニュース");
      fireEvent.click(screen.getByRole("button", { name: /セマンティック検索/i }));

      drag(320, 100);

      expect(screen.getByTestId("daily-pager-track").getAttribute("data-pager-phase")).toBe("idle");

      // 日別一覧へ戻しても日付は変わっていない
      fireEvent.click(screen.getByRole("button", { name: /日別一覧/i }));
      await waitFor(() => {
        expect(currentDateValue()).toBe("2026-08-19");
      });
    });
  });
});
