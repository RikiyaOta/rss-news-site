import { ChevronLeft, ChevronRight, Calendar, Search, Newspaper, Sparkles } from "lucide-react";

export interface HeaderProps {
  currentDate: string;
  mode: "daily" | "search";
  onPrevDay: () => void;
  onNextDay: () => void;
  onDateChange: (date: string) => void;
  onModeChange: (mode: "daily" | "search") => void;
  isNextDisabled?: boolean;
}

export function Header({
  currentDate,
  mode,
  onPrevDay,
  onNextDay,
  onDateChange,
  onModeChange,
  isNextDisabled = false,
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 w-full border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* ロゴ・タイトル */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-500/20">
            <Newspaper className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg md:text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <span>AI RSS News Dashboard</span>
              <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                <Sparkles className="w-2.5 h-2.5" />
                Workers AI &amp; BGE-M3
              </span>
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Cloudflare Workers &amp; D1 による高速配信 &amp; セマンティック検索
            </p>
          </div>
        </div>

        {/* コントロール群 */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {/* モード切替タブ */}
          <div className="flex items-center p-1 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-medium">
            <button
              type="button"
              onClick={() => onModeChange("daily")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                mode === "daily"
                  ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm font-semibold"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>日別一覧</span>
            </button>
            <button
              type="button"
              onClick={() => onModeChange("search")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                mode === "search"
                  ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm font-semibold"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              <span>セマンティック検索</span>
            </button>
          </div>

          {/* 日付ナビゲーション */}
          {mode === "daily" && (
            <div className="flex items-center gap-1 bg-zinc-50 dark:bg-zinc-900/60 p-1 rounded-xl border border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={onPrevDay}
                className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors"
                aria-label="前日"
                title="前日"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <input
                type="date"
                data-testid="date-picker-input"
                value={currentDate}
                onChange={(e) => onDateChange(e.target.value)}
                className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-800 dark:text-zinc-200 rounded-lg px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />

              <button
                type="button"
                onClick={onNextDay}
                disabled={isNextDisabled}
                className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="翌日"
                title="翌日"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
