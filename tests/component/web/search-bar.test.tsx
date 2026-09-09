// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchBar } from "../../../src/web/components/SearchBar";

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

  it("プレースホルダーは例示を含まない短い文言であること", () => {
    render(
      <SearchBar
        query=""
        onQueryChange={() => {}}
        onSearch={() => {}}
        onClear={() => {}}
        isLoading={false}
      />,
    );

    const placeholder = (screen.getByRole("textbox") as HTMLInputElement).placeholder;
    expect(placeholder).toBe("キーワードで検索");
  });

  it.each([
    { name: "検索", note: "検索ボタンはアイコンのみで文字ラベルを持たないこと" },
    { name: "クリア", note: "クリアボタンはアイコンのみで文字ラベルを持たないこと" },
  ])("$note", ({ name }) => {
    render(
      <SearchBar
        query="TypeScript"
        onQueryChange={() => {}}
        onSearch={() => {}}
        onClear={() => {}}
        isLoading={false}
      />,
    );

    const button = screen.getByRole("button", { name });
    expect(button.textContent).toBe("");
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

  it("ローディング中は入力とボタンが無効化されること", () => {
    render(
      <SearchBar
        query="LangChain"
        onQueryChange={() => {}}
        onSearch={() => {}}
        onClear={() => {}}
        isLoading={true}
      />,
    );

    const input = screen.getByPlaceholderText(/検索/) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "検索" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "クリア" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("ローディング中も検索バーにはスピナーや進捗の説明文を出さないこと", () => {
    const { container } = render(
      <SearchBar
        query="LangChain"
        onQueryChange={() => {}}
        onSearch={() => {}}
        onClear={() => {}}
        isLoading={true}
      />,
    );

    expect(container.querySelectorAll(".animate-spin")).toHaveLength(0);
    expect(screen.queryByText(/検索中|ベクトル|Workers AI/)).toBeNull();
  });

  describe("キーボード操作", () => {
    it.each([
      { key: "Enter", isLoading: false, search: 1, clear: 0, note: "Enter で検索" },
      { key: "Enter", isLoading: true, search: 0, clear: 0, note: "読み込み中の Enter は無視" },
      { key: "Escape", isLoading: false, search: 0, clear: 1, note: "Escape でクリア" },
      { key: "a", isLoading: false, search: 0, clear: 0, note: "その他のキーは何もしない" },
    ])("$note", ({ key, isLoading, search, clear }) => {
      const onSearch = vi.fn();
      const onClear = vi.fn();
      render(
        <SearchBar
          query="TypeScript"
          onQueryChange={() => {}}
          onSearch={onSearch}
          onClear={onClear}
          isLoading={isLoading}
        />,
      );

      fireEvent.keyDown(screen.getByPlaceholderText(/検索/), { key });

      expect(onSearch).toHaveBeenCalledTimes(search);
      expect(onClear).toHaveBeenCalledTimes(clear);
    });
  });

  it("入力すると onQueryChange が入力値付きで呼ばれること", () => {
    const onQueryChange = vi.fn();
    render(
      <SearchBar
        query=""
        onQueryChange={onQueryChange}
        onSearch={() => {}}
        onClear={() => {}}
        isLoading={false}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/検索/), { target: { value: "Cloudflare" } });
    expect(onQueryChange).toHaveBeenCalledWith("Cloudflare");
  });
});
