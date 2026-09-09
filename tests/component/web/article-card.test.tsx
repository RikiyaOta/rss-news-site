// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ArticleCard } from "../../../src/web/components/ArticleCard";
import { Article, SearchResultItem } from "../../../src/shared/types";

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
      published_date_jst: "2026-08-18",
      similarity: 0.924,
    };
    render(<ArticleCard article={searchItem} />);

    const simBadge = screen.getByTestId("similarity-badge");
    expect(simBadge).toBeDefined();
    expect(simBadge.textContent).toContain("92%");
    expect(screen.getByText(/2026-08-18/)).toBeDefined();
  });

  describe("配信元 favicon", () => {
    it("記事 URL のホストから解決した favicon が配信元バッジに表示されること", () => {
      render(<ArticleCard article={mockArticle} />);

      const favicon = screen.getByTestId("source-favicon") as HTMLImageElement;
      expect(favicon.tagName).toBe("IMG");
      expect(favicon.getAttribute("src")).toContain("example.com");
      // 配信元名がテキストで併記されるため、画像は装飾として扱う
      expect(favicon.getAttribute("alt")).toBe("");
      expect(screen.queryByTestId("source-favicon-fallback")).toBeNull();
    });

    it("favicon の読み込みに失敗した場合、代替アイコンへフォールバックすること", () => {
      render(<ArticleCard article={mockArticle} />);

      fireEvent.error(screen.getByTestId("source-favicon"));

      expect(screen.queryByTestId("source-favicon")).toBeNull();
      expect(screen.getByTestId("source-favicon-fallback")).toBeDefined();
      expect(screen.getByText("Tech Blog")).toBeDefined();
    });

    it("記事 URL からホストを解決できない場合、代替アイコンが表示されること", () => {
      render(<ArticleCard article={{ ...mockArticle, url: "not-a-url" }} />);

      expect(screen.queryByTestId("source-favicon")).toBeNull();
      expect(screen.getByTestId("source-favicon-fallback")).toBeDefined();
    });
  });
});
