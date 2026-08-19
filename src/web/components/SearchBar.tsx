import type { KeyboardEvent } from "react";
import { Search, X, Loader2, Sparkles } from "lucide-react";

export interface SearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  onClear: () => void;
  isLoading?: boolean;
}

export function SearchBar({
  query,
  onQueryChange,
  onSearch,
  onClear,
  isLoading = false,
}: SearchBarProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !isLoading) {
      e.preventDefault();
      onSearch();
    } else if (e.key === "Escape") {
      onClear();
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto mb-8">
      <div className="relative flex items-center bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-1.5 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 transition-all">
        <div className="pl-3 pr-2 text-zinc-400 dark:text-zinc-500 flex items-center">
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
          ) : (
            <Search className="w-5 h-5 text-zinc-400" />
          )}
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          placeholder="自然言語で検索 (例: Rustの並行処理, LLMエージェント, Cloudflare Workers)..."
          className="flex-1 bg-transparent border-0 px-2 py-2.5 text-sm md:text-base text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none disabled:opacity-50"
        />

        <div className="flex items-center gap-1.5 pr-1">
          {query.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              disabled={isLoading}
              className="px-2.5 py-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
              aria-label="クリア"
            >
              <span className="flex items-center gap-1">
                <X className="w-4 h-4" />
                <span>クリア</span>
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={onSearch}
            disabled={isLoading || !query.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-200 dark:disabled:bg-zinc-800 text-white disabled:text-zinc-400 text-sm font-medium rounded-xl transition-all shadow-sm flex items-center gap-1.5"
            aria-label="検索"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>検索中...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>検索</span>
              </>
            )}
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="mt-2 text-center text-xs text-blue-600 dark:text-blue-400 flex items-center justify-center gap-1.5 animate-pulse">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>Multilingual E5 によるクエリのベクトル化中...</span>
        </div>
      )}
    </div>
  );
}
