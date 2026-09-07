import { ChevronLeft, ChevronRight, Calendar, Search } from "lucide-react";

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
    <header className="w-full border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col md:flex-row md:items-center justify-between gap-2 md:gap-3">
        {/* 1段目: タイトルとモード切替（モバイルでも 1 行に収まる幅に抑える） */}
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg md:text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            RSS News for Me
          </h1>

          {/* モード切替タブ */}
          <div className="flex items-center shrink-0 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-medium">
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
              // 表示は「検索」と短くしつつ、検索実行ボタンと区別できるよう
              // 支援技術には正式な名称を伝える
              aria-label="セマンティック検索"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                mode === "search"
                  ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm font-semibold"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              <span>検索</span>
            </button>
          </div>
        </div>

        {/* 2段目: 日付ナビゲーション */}
        {mode === "daily" && (
          <div className="flex items-center gap-1 self-start md:self-auto bg-zinc-50 dark:bg-zinc-900/60 p-1 rounded-xl border border-zinc-200 dark:border-zinc-800">
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
    </header>
  );
}
