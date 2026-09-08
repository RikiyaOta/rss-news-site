// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { createRef } from "react";
import { ArticleList } from "../../../src/web/components/ArticleList";
import { Article } from "../../../src/shared/types";

/** jsdom には IntersectionObserver が無いため、観測対象を手動で交差させられる形で差し替える */
function installIntersectionObserverStub() {
  const instances: {
    callback: IntersectionObserverCallback;
    options?: IntersectionObserverInit;
    observed: Element[];
    disconnected: boolean;
  }[] = [];

  class StubIntersectionObserver {
    private entry: (typeof instances)[number];

    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.entry = { callback, options, observed: [], disconnected: false };
      instances.push(this.entry);
    }
    observe(target: Element) {
      this.entry.observed.push(target);
    }
    unobserve() {}
    disconnect() {
      this.entry.disconnected = true;
    }
    takeRecords() {
      return [];
    }
  }

  vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
  return instances;
}

function articles(count: number): Article[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `art-${i}`,
    title: `記事 ${i + 1}`,
    url: `https://example.com/${i}`,
    source_name: "Source",
    summary: `要約 ${i + 1}`,
    score: 80,
    published_at: "2026-08-19T00:00:00.000Z",
  }));
}

describe("ArticleList コンポーネント", () => {
  let observers: ReturnType<typeof installIntersectionObserverStub>;

  beforeEach(() => {
    observers = installIntersectionObserverStub();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("一覧表示", () => {
    it("渡した記事がすべてカードとして描画されること", () => {
      render(<ArticleList articles={articles(3)} isLoading={false} error={null} />);

      expect(screen.getAllByTestId("article-card")).toHaveLength(3);
      expect(screen.getByText("記事 1")).toBeDefined();
      expect(screen.getByText("記事 3")).toBeDefined();
    });
  });

  describe("表示状態の出し分け", () => {
    it("読み込み中はスケルトンを表示し、記事も空状態も表示しないこと", () => {
      render(<ArticleList articles={[]} isLoading={true} error={null} />);

      expect(screen.getByTestId("article-list-loading")).toBeDefined();
      expect(screen.queryByText(/件の記事/)).toBeNull();
    });

    it("エラー時はメッセージと再試行ボタンを表示し、押すと onRetry が呼ばれること", () => {
      const onRetry = vi.fn();
      render(
        <ArticleList
          articles={[]}
          isLoading={false}
          error="ネットワーク接続エラー"
          onRetry={onRetry}
        />,
      );

      expect(screen.getByText("ネットワーク接続エラー")).toBeDefined();
      fireEvent.click(screen.getByRole("button", { name: /再試行/ }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("onRetry が無い場合は再試行ボタンを表示しないこと", () => {
      render(<ArticleList articles={[]} isLoading={false} error="エラー" />);
      expect(screen.queryByRole("button", { name: /再試行/ })).toBeNull();
    });

    it("記事が 0 件のときは指定した空状態メッセージを表示すること", () => {
      render(
        <ArticleList
          articles={[]}
          isLoading={false}
          error={null}
          emptyMessage="2026-08-19 の記事はまだありません"
        />,
      );
      expect(screen.getByText("2026-08-19 の記事はまだありません")).toBeDefined();
    });

    it("読み込み中とエラーが同時のときは読み込み中を優先すること", () => {
      render(<ArticleList articles={[]} isLoading={true} error="エラー" />);
      expect(screen.getByTestId("article-list-loading")).toBeDefined();
      expect(screen.queryByText("エラーが発生しました")).toBeNull();
    });
  });

  describe("件数表示", () => {
    it.each([
      { total: 40, loaded: 30, expected: "全 40 件の記事", note: "total を優先する" },
      {
        total: undefined,
        loaded: 3,
        expected: "全 3 件の記事",
        note: "total 省略時は読み込み済み件数",
      },
      {
        total: 0,
        loaded: 2,
        expected: "全 0 件の記事",
        note: "total が 0 でも読み込み済み件数で代替しない",
      },
    ])("$note", ({ total, loaded, expected }) => {
      render(
        <ArticleList articles={articles(loaded)} total={total} isLoading={false} error={null} />,
      );
      expect(screen.getByText(expected)).toBeDefined();
    });
  });

  describe("追加読み込み", () => {
    it("hasMore が false のときは追加読み込みの導線を表示しないこと", () => {
      render(
        <ArticleList
          articles={articles(3)}
          isLoading={false}
          error={null}
          hasMore={false}
          onLoadMore={vi.fn()}
        />,
      );
      expect(screen.queryByRole("button", { name: /さらに読み込む/ })).toBeNull();
    });

    it("onLoadMore が無い場合は hasMore でも導線を表示しないこと", () => {
      render(<ArticleList articles={articles(3)} isLoading={false} error={null} hasMore={true} />);
      expect(screen.queryByRole("button", { name: /さらに読み込む/ })).toBeNull();
    });

    it("ボタンクリックで onLoadMore が呼ばれること", () => {
      const onLoadMore = vi.fn();
      render(
        <ArticleList
          articles={articles(3)}
          isLoading={false}
          error={null}
          hasMore={true}
          onLoadMore={onLoadMore}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /さらに読み込む/ }));
      expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it("追加読み込み中はボタンが無効化され、読み込み中表示になること", () => {
      const onLoadMore = vi.fn();
      render(
        <ArticleList
          articles={articles(3)}
          isLoading={false}
          error={null}
          hasMore={true}
          isLoadingMore={true}
          onLoadMore={onLoadMore}
        />,
      );

      const button = screen.getByRole("button", { name: /追加の記事を読み込み中/ });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
      expect(onLoadMore).not.toHaveBeenCalled();
    });
  });

  describe("無限スクロール (IntersectionObserver)", () => {
    it("番兵要素が画面に入ると onLoadMore が呼ばれること", () => {
      const onLoadMore = vi.fn();
      render(
        <ArticleList
          articles={articles(3)}
          isLoading={false}
          error={null}
          hasMore={true}
          onLoadMore={onLoadMore}
        />,
      );

      expect(observers).toHaveLength(1);
      expect(observers[0].observed).toHaveLength(1);

      act(() => {
        observers[0].callback([{ isIntersecting: true }] as any, {} as IntersectionObserver);
      });
      expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it("番兵要素が画面外のままなら onLoadMore は呼ばれないこと", () => {
      const onLoadMore = vi.fn();
      render(
        <ArticleList
          articles={articles(3)}
          isLoading={false}
          error={null}
          hasMore={true}
          onLoadMore={onLoadMore}
        />,
      );

      act(() => {
        observers[0].callback([{ isIntersecting: false }] as any, {} as IntersectionObserver);
      });
      expect(onLoadMore).not.toHaveBeenCalled();
    });

    it("追加読み込み中は監視を行わず、多重リクエストにならないこと", () => {
      render(
        <ArticleList
          articles={articles(3)}
          isLoading={false}
          error={null}
          hasMore={true}
          isLoadingMore={true}
          onLoadMore={vi.fn()}
        />,
      );
      expect(observers).toHaveLength(0);
    });

    it("hasMore が false のときは監視を行わないこと", () => {
      render(
        <ArticleList
          articles={articles(3)}
          isLoading={false}
          error={null}
          hasMore={false}
          onLoadMore={vi.fn()}
        />,
      );
      expect(observers).toHaveLength(0);
    });

    it("scrollRootRef が指す要素を監視の基準 (root) にすること", () => {
      const scrollRootRef = createRef<HTMLElement>();
      const root = document.createElement("div");
      (scrollRootRef as { current: HTMLElement | null }).current = root;

      render(
        <ArticleList
          articles={articles(3)}
          isLoading={false}
          error={null}
          hasMore={true}
          onLoadMore={vi.fn()}
          scrollRootRef={scrollRootRef}
        />,
      );

      expect(observers[0].options?.root).toBe(root);
      expect(observers[0].options?.rootMargin).toBe("200px");
    });

    it("アンマウント時に監視が解除されること", () => {
      const { unmount } = render(
        <ArticleList
          articles={articles(3)}
          isLoading={false}
          error={null}
          hasMore={true}
          onLoadMore={vi.fn()}
        />,
      );

      expect(observers[0].disconnected).toBe(false);
      unmount();
      expect(observers[0].disconnected).toBe(true);
    });

    it("IntersectionObserver が存在しない環境でも描画が壊れないこと", () => {
      vi.stubGlobal("IntersectionObserver", undefined);

      expect(() =>
        render(
          <ArticleList
            articles={articles(3)}
            isLoading={false}
            error={null}
            hasMore={true}
            onLoadMore={vi.fn()}
          />,
        ),
      ).not.toThrow();
      expect(screen.getByRole("button", { name: /さらに読み込む/ })).toBeDefined();
    });
  });
});
