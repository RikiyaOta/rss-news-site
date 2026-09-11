// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Header } from "../../../src/web/components/Header";

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

    expect(screen.getByText(/RSS News for Me/i)).toBeDefined();
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

  it("ヘッダーにはタイトルとロゴのみが置かれ、説明文が描画されないこと", () => {
    const { container } = render(
      <Header
        currentDate="2026-08-19"
        mode="daily"
        onPrevDay={() => {}}
        onNextDay={() => {}}
        onDateChange={() => {}}
        onModeChange={() => {}}
      />,
    );

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("RSS News for Me");

    // 説明文（サイトの解説テキスト）が存在しないこと
    expect(container.querySelector("header p")).toBeNull();
    expect(screen.queryByText(/BGE-M3|Cloudflare/i)).toBeNull();
  });

  it("見出しにロゴを表示し、装飾として支援技術からは隠すこと", () => {
    render(
      <Header
        currentDate="2026-08-19"
        mode="daily"
        onPrevDay={() => {}}
        onNextDay={() => {}}
        onDateChange={() => {}}
        onModeChange={() => {}}
      />,
    );

    const heading = screen.getByRole("heading", { level: 1 });
    const logo = heading.querySelector("svg");

    expect(logo).not.toBeNull();
    // サイト名が隣に文字で出るため、図形自体は読み上げの対象にしない
    expect(logo?.getAttribute("aria-hidden")).toBe("true");
    expect(heading.textContent).toBe("RSS News for Me");
  });

  describe("GitHub リポジトリへのリンク", () => {
    it.each([["daily"], ["search"]] as const)(
      "%s モードでも、新しいタブで開くリポジトリリンクが表示されること",
      (mode) => {
        render(
          <Header
            currentDate="2026-08-19"
            mode={mode}
            onPrevDay={() => {}}
            onNextDay={() => {}}
            onDateChange={() => {}}
            onModeChange={() => {}}
          />,
        );

        const link = screen.getByRole("link", { name: /GitHub/i });
        expect(link.getAttribute("href")).toBe("https://github.com/RikiyaOta/rss-news-site");
        expect(link.getAttribute("target")).toBe("_blank");
        expect(link.getAttribute("rel")).toContain("noopener");
      },
    );

    it("アイコンは装飾として扱い、リンク名は支援技術にのみ伝わること", () => {
      render(
        <Header
          currentDate="2026-08-19"
          mode="daily"
          onPrevDay={() => {}}
          onNextDay={() => {}}
          onDateChange={() => {}}
          onModeChange={() => {}}
        />,
      );

      const link = screen.getByRole("link", { name: /GitHub/i });
      // 画面上はアイコンのみ。テキストラベルを増やしてヘッダーの幅を圧迫しない
      expect(link.textContent).toBe("");
      expect(link.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    });
  });

  it("検索タブは表示を「検索」と短くしつつ、支援技術には正式名称を伝えること", () => {
    render(
      <Header
        currentDate="2026-08-19"
        mode="daily"
        onPrevDay={() => {}}
        onNextDay={() => {}}
        onDateChange={() => {}}
        onModeChange={() => {}}
      />,
    );

    const searchTab = screen.getByRole("button", { name: "セマンティック検索" });
    expect(searchTab.textContent).toBe("検索");
  });
});
