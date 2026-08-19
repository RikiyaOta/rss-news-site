// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ArticleCard } from "../../src/web/components/ArticleCard";
import { SearchBar } from "../../src/web/components/SearchBar";
import { Header } from "../../src/web/components/Header";
import { ArticleList } from "../../src/web/components/ArticleList";
import { Article, SearchResultItem } from "../../src/shared/types";

describe("フロントエンド React コンポーネントのテスト", () => {
  describe("ArticleCard コンポーネント", () => {
    const mockArticle: Article = {
      id: "test1234567890ab",
      title: "React 19の新機能とパフォーマンス改善",
      url: "https://example.com/react-19-features",
      source_name: "Tech Blog",
      summary:
        "React 19の新機能について解説。Actionsによる非同期処理の簡素化やServer Componentsの強化が行われました。",
      score: 85,
      published_at: "2026-08-19T10:00:00.000Z",
    };

    it("記事タイトル、リンクURL、配信元バッジ、公開日時が正しく表示されること", () => {
      render(<ArticleCard article={mockArticle} />);

      const titleLink = screen.getByRole("link", { name: /React 19の新機能とパフォーマンス改善/i });
      expect(titleLink).toBeDefined();
      expect(titleLink.getAttribute("href")).toBe("https://example.com/react-19-features");
      expect(titleLink.getAttribute("target")).toBe("_blank");
      expect(titleLink.getAttribute("rel")).toContain("noopener");

      expect(screen.getByText("Tech Blog")).toBeDefined();
      expect(screen.getByText(/2026/)).toBeDefined();
    });

    it("記事の抜粋（スニペット）が表示され、「AI 3行要約」ボックスは描画されないこと", () => {
      render(<ArticleCard article={mockArticle} />);

      expect(screen.getByText(mockArticle.summary)).toBeDefined();
      expect(screen.queryByText("AI 3行要約")).toBeNull();
    });

    it("要約が空または未定義の場合、抜粋テキストが描画されないこと", () => {
      const { container } = render(<ArticleCard article={{ ...mockArticle, summary: "" }} />);
      expect(container.querySelector("p.line-clamp-2")).toBeNull();
    });

    it("スコアが80点以上の場合、高スコア（グリーン系）のスタイルが適用されること", () => {
      render(<ArticleCard article={{ ...mockArticle, score: 92 }} />);
      const badge = screen.getByTestId("score-badge");
      expect(badge.textContent).toContain("92");
      expect(badge.className).toMatch(/emerald|green/);
    });

    it("スコアが60〜79点の場合、中高スコア（ブルー系）のスタイルが適用されること", () => {
      render(<ArticleCard article={{ ...mockArticle, score: 75 }} />);
      const badge = screen.getByTestId("score-badge");
      expect(badge.textContent).toContain("75");
      expect(badge.className).toMatch(/blue|sky|indigo/);
    });

    it("スコアが40〜59点の場合、中スコア（イエロー/アンバー系）のスタイルが適用されること", () => {
      render(<ArticleCard article={{ ...mockArticle, score: 50 }} />);
      const badge = screen.getByTestId("score-badge");
      expect(badge.textContent).toContain("50");
      expect(badge.className).toMatch(/amber|yellow/);
    });

    it("スコアが40点未満の場合、低スコア（グレー/スレート系）のスタイルが適用されること", () => {
      render(<ArticleCard article={{ ...mockArticle, score: 30 }} />);
      const badge = screen.getByTestId("score-badge");
      expect(badge.textContent).toContain("30");
      expect(badge.className).toMatch(/zinc|gray|slate/);
    });

    it("検索結果アイテムの場合、類似度パーセント（一致度）バッジが表示されること", () => {
      const searchItem: SearchResultItem = {
        ...mockArticle,
        date: "2026-08-18",
        similarity: 0.924,
      };
      render(<ArticleCard article={searchItem} />);

      const simBadge = screen.getByTestId("similarity-badge");
      expect(simBadge).toBeDefined();
      expect(simBadge.textContent).toContain("92%");
      expect(screen.getByText(/2026-08-18/)).toBeDefined();
    });
  });

  describe("SearchBar コンポーネント", () => {
    it("入力フィールド、検索ボタン、クリアボタンが正しく描画されること", () => {
      const handleSearch = vi.fn();
      const handleClear = vi.fn();
      render(
        <SearchBar
          query="TypeScript"
          onQueryChange={() => {}}
          onSearch={handleSearch}
          onClear={handleClear}
          isLoading={false}
        />,
      );

      const input = screen.getByPlaceholderText(/検索/);
      expect(input).toBeDefined();
      expect((input as HTMLInputElement).value).toBe("TypeScript");
      expect(screen.getByRole("button", { name: /検索/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /クリア/i })).toBeDefined();
    });

    it("Enterキー押下または検索ボタンクリックで onSearch が実行されること", () => {
      const handleSearch = vi.fn();
      render(
        <SearchBar
          query="AI Agents"
          onQueryChange={() => {}}
          onSearch={handleSearch}
          onClear={() => {}}
          isLoading={false}
        />,
      );

      const searchBtn = screen.getByRole("button", { name: /検索/i });
      fireEvent.click(searchBtn);
      expect(handleSearch).toHaveBeenCalledTimes(1);

      const input = screen.getByPlaceholderText(/検索/);
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
      expect(handleSearch).toHaveBeenCalledTimes(2);
    });

    it("クリアボタンクリックで onClear が実行されること", () => {
      const handleClear = vi.fn();
      render(
        <SearchBar
          query="Rust"
          onQueryChange={() => {}}
          onSearch={() => {}}
          onClear={handleClear}
          isLoading={false}
        />,
      );

      const clearBtn = screen.getByRole("button", { name: /クリア/i });
      fireEvent.click(clearBtn);
      expect(handleClear).toHaveBeenCalledTimes(1);
    });

    it("ローディング中の場合、スピナーが表示されボタンや入力が無効化されること", () => {
      render(
        <SearchBar
          query="LangChain"
          onQueryChange={() => {}}
          onSearch={() => {}}
          onClear={() => {}}
          isLoading={true}
        />,
      );

      expect(screen.getAllByText(/検索中|ベクトル化中/).length).toBeGreaterThan(0);
      const input = screen.getByPlaceholderText(/検索/) as HTMLInputElement;
      expect(input.disabled).toBe(true);
    });
  });

  describe("Header コンポーネント", () => {
    it("ダッシュボードタイトル、日付変更ナビゲーション、モード切替が表示されること", () => {
      const handlePrev = vi.fn();
      const handleNext = vi.fn();
      const handleDateChange = vi.fn();
      const handleModeChange = vi.fn();

      render(
        <Header
          currentDate="2026-08-19"
          mode="daily"
          onPrevDay={handlePrev}
          onNextDay={handleNext}
          onDateChange={handleDateChange}
          onModeChange={handleModeChange}
          isNextDisabled={false}
        />,
      );

      expect(screen.getByText(/AI RSS News Dashboard/i)).toBeDefined();
      expect(screen.getByRole("button", { name: /前日/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /翌日/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /セマンティック検索/i })).toBeDefined();

      fireEvent.click(screen.getByRole("button", { name: /前日/i }));
      expect(handlePrev).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole("button", { name: /翌日/i }));
      expect(handleNext).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole("button", { name: /セマンティック検索/i }));
      expect(handleModeChange).toHaveBeenCalledWith("search");
    });

    it("isNextDisabled=true の場合、翌日ボタンが無効化されること", () => {
      render(
        <Header
          currentDate="2026-08-19"
          mode="daily"
          onPrevDay={() => {}}
          onNextDay={() => {}}
          onDateChange={() => {}}
          onModeChange={() => {}}
          isNextDisabled={true}
        />,
      );

      const nextBtn = screen.getByRole("button", { name: /翌日/i }) as HTMLButtonElement;
      expect(nextBtn.disabled).toBe(true);
    });
  });

  describe("ArticleList コンポーネント", () => {
    const articles: Article[] = [
      {
        id: "art-1",
        title: "記事1のタイトル",
        url: "https://example.com/1",
        source_name: "Source A",
        summary: "・要約1",
        score: 95,
        published_at: "2026-08-19T08:00:00.000Z",
      },
      {
        id: "art-2",
        title: "記事2のタイトル",
        url: "https://example.com/2",
        source_name: "Source B",
        summary: "・要約2",
        score: 65,
        published_at: "2026-08-19T09:00:00.000Z",
      },
    ];

    it("複数の記事カードが一覧表示されること", () => {
      render(<ArticleList articles={articles} isLoading={false} error={null} />);

      expect(screen.getByText("記事1のタイトル")).toBeDefined();
      expect(screen.getByText("記事2のタイトル")).toBeDefined();
      expect(screen.getAllByTestId("article-card")).toHaveLength(2);
    });

    it("ローディング中の場合、スケルトンまたはローディングスピナーが表示されること", () => {
      render(<ArticleList articles={[]} isLoading={true} error={null} />);

      expect(screen.getByTestId("article-list-loading")).toBeDefined();
    });

    it("エラーが存在する場合、エラーメッセージと再試行ボタンが表示されること", () => {
      const handleRetry = vi.fn();
      render(
        <ArticleList
          articles={[]}
          isLoading={false}
          error="データの取得に失敗しました (500)"
          onRetry={handleRetry}
        />,
      );

      expect(screen.getByText(/データの取得に失敗しました/)).toBeDefined();
      const retryBtn = screen.getByRole("button", { name: /再試行/i });
      fireEvent.click(retryBtn);
      expect(handleRetry).toHaveBeenCalledTimes(1);
    });

    it("記事が0件の場合、該当記事なしメッセージが表示されること", () => {
      render(
        <ArticleList
          articles={[]}
          isLoading={false}
          error={null}
          emptyMessage="本日収集された記事はありません"
        />,
      );

      expect(screen.getByText("本日収集された記事はありません")).toBeDefined();
    });
  });
});
