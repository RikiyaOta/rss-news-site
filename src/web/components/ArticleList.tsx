import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { Article, SearchResultItem } from "../../shared/types";
import { ArticleCard } from "./ArticleCard";
import { AlertCircle, RotateCcw, Inbox, Loader2, ChevronDown } from "lucide-react";

export interface ArticleListProps {
  articles: (Article | SearchResultItem)[];
  /**
   * 件数表示に用いる総件数。読み込み済み件数ではなく全件数を渡す。
   * 省略時は読み込み済みの件数を表示する。
   */
  total?: number;
  isLoading: boolean;
  error: string | null;
  emptyMessage?: string;
  /**
   * 初回ロード中の見せ方。
   * `skeleton` は件数の目安が付く日別一覧向け、`spinner` は待つだけの検索向け。
   */
  loadingVariant?: "skeleton" | "spinner";
  onRetry?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  /**
   * 無限スクロール監視の基準となるスクロール領域。
   * 省略時はビューポートを基準とする。
   */
  scrollRootRef?: RefObject<HTMLElement | null>;
}

export function ArticleList({
  articles,
  total,
  isLoading,
  error,
  emptyMessage = "記事が見つかりませんでした",
  loadingVariant = "skeleton",
  onRetry,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  scrollRootRef,
}: ArticleListProps) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // 監視の再構築を避けるため、最新のコールバックは ref 経由で参照する
  const onLoadMoreRef = useRef(onLoadMore);
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  });

  const canLoadMore = hasMore && !isLoadingMore && !!onLoadMore;

  // IntersectionObserver による無限スクロール監視
  useEffect(() => {
    if (!canLoadMore) return;

    if (typeof IntersectionObserver === "undefined") return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onLoadMoreRef.current?.();
        }
      },
      { root: scrollRootRef?.current ?? null, rootMargin: "200px" },
    );

    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [canLoadMore, scrollRootRef]);

  // ローディング状態（初回ロード）
  if (isLoading) {
    if (loadingVariant === "spinner") {
      return (
        <div
          data-testid="article-list-loading"
          className="w-full flex items-center justify-center py-16"
        >
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      );
    }

    return (
      <div data-testid="article-list-loading" className="w-full">
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-500 dark:text-zinc-400">
          <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
          <span>記事データを読み込み中...</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4 animate-pulse"
            >
              <div className="flex justify-between items-center">
                <div className="h-5 bg-zinc-200 dark:bg-zinc-800 rounded w-20" />
                <div className="h-5 bg-zinc-200 dark:bg-zinc-800 rounded w-16" />
              </div>
              <div className="h-6 bg-zinc-200 dark:bg-zinc-800 rounded w-3/4" />
              <div className="space-y-2 pt-2">
                <div className="h-4 bg-zinc-100 dark:bg-zinc-800/60 rounded w-full" />
                <div className="h-4 bg-zinc-100 dark:bg-zinc-800/60 rounded w-5/6" />
              </div>
              <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex justify-between">
                <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-28" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // エラー状態
  if (error) {
    return (
      <div className="w-full max-w-lg mx-auto my-12 p-6 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-center">
        <AlertCircle className="w-10 h-10 mx-auto text-red-500 mb-3" />
        <h3 className="text-base font-semibold text-red-800 dark:text-red-300 mb-1">
          エラーが発生しました
        </h3>
        <p className="text-xs text-red-600 dark:text-red-400 mb-4">{error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-sm transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>再試行</span>
          </button>
        )}
      </div>
    );
  }

  // 空状態
  if (articles.length === 0) {
    return (
      <div className="w-full max-w-md mx-auto my-16 p-8 text-center bg-white dark:bg-zinc-900/50 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-800">
        <Inbox className="w-12 h-12 mx-auto text-zinc-400 dark:text-zinc-600 mb-3" />
        <h3 className="text-base font-semibold text-zinc-800 dark:text-zinc-200">{emptyMessage}</h3>
      </div>
    );
  }

  // 記事グリッド表示
  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 px-1">
        <span>全 {total ?? articles.length} 件の記事</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {articles.map((article, idx) => (
          <ArticleCard
            key={`${article.id}-${"date" in article ? article.date : ""}-${idx}`}
            article={article}
          />
        ))}
      </div>

      {/* 無限スクロール & 追加読み込み UI */}
      {hasMore && onLoadMore && (
        <div className="pt-6 pb-2 text-center">
          <div ref={sentinelRef} className="h-2" />
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 shadow-sm transition-colors disabled:opacity-50"
          >
            {isLoadingMore ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                <span>追加の記事を読み込み中...</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-4 h-4 text-zinc-500" />
                <span>さらに読み込む</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
