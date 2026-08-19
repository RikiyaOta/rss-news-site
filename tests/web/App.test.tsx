// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { App } from "../../src/web/App";
import * as sqliteClient from "../../src/web/lib/sqlite-client";
import * as browserEmbedder from "../../src/web/lib/browser-embedder";
import * as r2Client from "../../src/web/lib/r2-client";
import { Article, SearchResultItem } from "../../src/shared/types";

vi.mock("../../src/web/lib/sqlite-client");
vi.mock("../../src/web/lib/browser-embedder");
vi.mock("../../src/web/lib/r2-client");

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
      title: "Intfloat multilingual-e5-small のブラウザ内推論検証",
      url: "https://example.com/search-1",
      source_name: "AI Lab",
      summary: "・ブラウザ内でのONNX推論\n・Web Workerでの非同期実行\n・高速なベクトル類似度計算",
      score: 88,
      published_at: "2026-08-18T12:00:00.000Z",
      date: "2026-08-18",
      similarity: 0.94,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(r2Client.getR2PublicBaseUrl).mockReturnValue("https://pub-r2.example.com");
    vi.mocked(sqliteClient.fetchDailyArticles).mockResolvedValue(mockDailyArticles);
    vi.mocked(browserEmbedder.embedQuery).mockResolvedValue(new Float32Array(384));
    vi.mocked(sqliteClient.searchArticlesByVector).mockResolvedValue(mockSearchResults);
  });

  it("初期レンダリング時に当日付の記事一覧が取得され表示されること", async () => {
    render(<App initialDate="2026-08-19" />);

    await waitFor(() => {
      expect(sqliteClient.fetchDailyArticles).toHaveBeenCalledWith(
        "https://pub-r2.example.com",
        "2026-08-19",
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
      expect(sqliteClient.fetchDailyArticles).toHaveBeenCalledWith(
        "https://pub-r2.example.com",
        "2026-08-18",
      );
    });
  });

  it("日付入力欄から日付を変更した際に該当日の記事が読み込まれること", async () => {
    render(<App initialDate="2026-08-19" />);

    await screen.findByText("本日のおすすめAIニュース");

    const dateInput = screen.getByTestId("date-picker-input");
    fireEvent.change(dateInput, { target: { value: "2026-08-15" } });

    await waitFor(() => {
      expect(sqliteClient.fetchDailyArticles).toHaveBeenCalledWith(
        "https://pub-r2.example.com",
        "2026-08-15",
      );
    });
  });

  it("検索キーワードを入力して検索を実行すると、ベクトル化と類似度検索が行われ結果が表示されること", async () => {
    render(<App initialDate="2026-08-19" />);

    await screen.findByText("本日のおすすめAIニュース");

    const searchModeBtn = screen.getByRole("button", { name: /セマンティック検索/i });
    fireEvent.click(searchModeBtn);

    const searchInput = screen.getByPlaceholderText(/検索/);
    fireEvent.change(searchInput, { target: { value: "multilingual-e5" } });

    const searchBtn = screen.getByRole("button", { name: /^検索$/ });
    fireEvent.click(searchBtn);

    await waitFor(() => {
      expect(browserEmbedder.embedQuery).toHaveBeenCalledWith("multilingual-e5");
      expect(sqliteClient.searchArticlesByVector).toHaveBeenCalled();
    });

    expect(
      await screen.findByText("Intfloat multilingual-e5-small のブラウザ内推論検証"),
    ).toBeDefined();
    expect(screen.getByText(/94%/)).toBeDefined();
  });

  it("検索結果表示中にクリアボタンを押すと日別一覧表示に戻ること", async () => {
    render(<App initialDate="2026-08-19" />);

    await screen.findByText("本日のおすすめAIニュース");

    const searchModeBtn = screen.getByRole("button", { name: /セマンティック検索/i });
    fireEvent.click(searchModeBtn);

    const searchInput = screen.getByPlaceholderText(/検索/);
    fireEvent.change(searchInput, { target: { value: "multilingual-e5" } });
    fireEvent.click(screen.getByRole("button", { name: /^検索$/ }));

    expect(
      await screen.findByText("Intfloat multilingual-e5-small のブラウザ内推論検証"),
    ).toBeDefined();

    const clearBtn = screen.getByRole("button", { name: /クリア/i });
    fireEvent.click(clearBtn);

    expect(await screen.findByText("本日のおすすめAIニュース")).toBeDefined();
  });

  it("該当日の記事が0件の場合に空状態メッセージが表示されること", async () => {
    vi.mocked(sqliteClient.fetchDailyArticles).mockResolvedValueOnce([]);

    render(<App initialDate="2026-08-19" />);

    expect(await screen.findByText(/記事はまだありません|見つかりませんでした/)).toBeDefined();
  });

  it("記事取得失敗時にエラーメッセージと再試行ボタンが表示され、再試行できること", async () => {
    vi.mocked(sqliteClient.fetchDailyArticles).mockRejectedValueOnce(
      new Error("ネットワーク接続エラー"),
    );

    render(<App initialDate="2026-08-19" />);

    expect(await screen.findByText(/ネットワーク接続エラー/)).toBeDefined();

    vi.mocked(sqliteClient.fetchDailyArticles).mockResolvedValueOnce(mockDailyArticles);
    const retryBtn = screen.getByRole("button", { name: /再試行/i });
    fireEvent.click(retryBtn);

    expect(await screen.findByText("本日のおすすめAIニュース")).toBeDefined();
  });
});
