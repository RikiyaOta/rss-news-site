import type { KeyboardEvent } from "react";
import { Search, X } from "lucide-react";

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
    <div className="w-full max-w-2xl mx-auto mb-8">
      {/* 検索中の進捗表示は結果領域のスピナーに一本化し、ここでは無効化のみ行う */}
      <div className="flex items-center gap-1 bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-1.5 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 transition-all">
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          placeholder="キーワードで検索"
          className="flex-1 min-w-0 bg-transparent border-0 px-3 py-2 text-sm md:text-base text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none disabled:opacity-50"
        />

        {query.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            disabled={isLoading}
            className="p-2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
            aria-label="クリア"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        <button
          type="button"
          onClick={onSearch}
          disabled={isLoading || !query.trim()}
          className="p-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-200 dark:disabled:bg-zinc-800 text-white disabled:text-zinc-400 rounded-xl transition-colors shadow-sm"
          aria-label="検索"
        >
          <Search className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
