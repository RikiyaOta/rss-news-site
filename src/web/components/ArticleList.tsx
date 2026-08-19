import { Article, SearchResultItem } from "../../shared/types";
import { ArticleCard } from "./ArticleCard";
import { AlertCircle, RotateCcw, Inbox, Loader2 } from "lucide-react";

export interface ArticleListProps {
  articles: (Article | SearchResultItem)[];
  isLoading: boolean;
  error: string | null;
  emptyMessage?: string;
  onRetry?: () => void;
}

export function ArticleList({
  articles,
  isLoading,
  error,
  emptyMessage = "記事が見つかりませんでした",
  onRetry,
}: ArticleListProps) {
  // ローディング状態（スケルトン表示）
  if (isLoading) {
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
                <div className="h-4 bg-zinc-100 dark:bg-zinc-800/60 rounded w-4/6" />
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
        <h3 className="text-base font-semibold text-zinc-800 dark:text-zinc-200 mb-1">
          {emptyMessage}
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          日付を変更するか、別の検索クエリをお試しください。
        </p>
      </div>
    );
  }

  // 記事グリッド表示
  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 px-1">
        <span>全 {articles.length} 件の記事</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {articles.map((article, idx) => (
          <ArticleCard
            key={`${article.id}-${"date" in article ? article.date : ""}-${idx}`}
            article={article}
          />
        ))}
      </div>
    </div>
  );
}
