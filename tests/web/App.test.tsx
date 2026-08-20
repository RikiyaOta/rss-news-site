// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { App } from "../../src/web/App";
import * as apiClient from "../../src/web/lib/api-client";
import { Article, SearchResultItem } from "../../src/shared/types";

vi.mock("../../src/web/lib/api-client");

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
      date: "2026-08-18",
      similarity: 0.94,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.fetchDailyArticles).mockResolvedValue(mockDailyArticles);
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
    expect(screen.getByText("AI RSS News Dashboard")).toBeDefined();
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
    vi.mocked(apiClient.fetchDailyArticles).mockResolvedValueOnce([]);

    render(<App initialDate="2026-08-19" />);

    expect(await screen.findByText(/記事はまだありません|見つかりませんでした/)).toBeDefined();
  });

  it("記事取得失敗時にエラーメッセージと再試行ボタンが表示され、再試行できること", async () => {
    vi.mocked(apiClient.fetchDailyArticles).mockRejectedValueOnce(
      new Error("ネットワーク接続エラー"),
    );

    render(<App initialDate="2026-08-19" />);

    expect(await screen.findByText(/ネットワーク接続エラー/)).toBeDefined();

    vi.mocked(apiClient.fetchDailyArticles).mockResolvedValueOnce(mockDailyArticles);
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

    vi.mocked(apiClient.fetchDailyArticles)
      .mockResolvedValueOnce(initialArticles)
      .mockResolvedValueOnce(moreArticles);

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
});
