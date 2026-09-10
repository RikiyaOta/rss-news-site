import { ChevronLeft, ChevronRight, Calendar, Search } from "lucide-react";

/** 収集対象フィードやスコアリングの仕組みを説明したリポジトリ */
const REPOSITORY_URL = "https://github.com/RikiyaOta/rss-news-site";

/**
 * GitHub のマーク。
 *
 * lucide-react はブランドアイコンを提供しないため、公式マークをインラインで持つ。
 * リンク名は aria-label で伝えるので、図形自体は装飾として扱う。
 */
function GithubMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className="w-4 h-4"
    >
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}

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

          <div className="flex items-center gap-2 shrink-0">
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

            {/* 収集元フィードとスコアリングの説明はリポジトリの README に置く */}
            <a
              href={REPOSITORY_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub リポジトリ（収集元フィードとスコアリングの説明）"
              title="収集元フィードとスコアリングの説明"
              className="shrink-0 p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              <GithubMark />
            </a>
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
