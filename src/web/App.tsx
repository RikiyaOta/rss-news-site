import { useState, useEffect, useCallback } from "react";
import type { RefObject } from "react";
import { SearchResultItem } from "../shared/types";
import { searchArticles } from "./lib/api-client";
import { Header } from "./components/Header";
import { SearchBar } from "./components/SearchBar";
import { ArticleList } from "./components/ArticleList";
import { DailyPager } from "./components/DailyPager";
import { useDailyArticleStore } from "./hooks/useDailyArticleStore";

export interface AppProps {
  initialDate?: string;
  apiBaseUrl?: string;
}

const PAGE_SIZE = 30;

/**
 * 日本標準時 (JST) の現在日付文字列 (YYYY-MM-DD) を取得する
 */
export function getTodayJstString(): string {
  const now = new Date();
  const jstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = jstDate.getUTCFullYear();
  const mm = String(jstDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(jstDate.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * 日付文字列を指定日数分ずらす (YYYY-MM-DD)
 */
export function adjustDate(dateStr: string, offsetDays: number): string {
  const parts = dateStr.split("-").map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function App({ initialDate, apiBaseUrl = "" }: AppProps) {
  const today = getTodayJstString();
  const [currentDate, setCurrentDate] = useState<string>(initialDate || today);
  const [mode, setMode] = useState<"daily" | "search">("daily");

  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchError, setSearchError] = useState<string | null>(null);

  const { getPage, ensurePage, reloadPage, loadMore } = useDailyArticleStore({
    pageSize: PAGE_SIZE,
    apiBaseUrl,
  });

  const prevDate = adjustDate(currentDate, -1);
  const nextDate = adjustDate(currentDate, 1);

  // 当日より先の日付へは進めない
  const isNextDisabled = currentDate >= today && !initialDate;

  // 表示中の日付を取得したうえで、めくった先で即座に描画できるよう前後の日付も先読みする
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await ensurePage(currentDate);
      if (cancelled) return;
      void ensurePage(prevDate);
      if (!isNextDisabled) {
        void ensurePage(nextDate);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentDate, prevDate, nextDate, isNextDisabled, ensurePage]);

  // 前日へ
  const handlePrevDay = () => {
    setCurrentDate(prevDate);
  };

  // 翌日へ
  const handleNextDay = () => {
    if (isNextDisabled) return;
    setCurrentDate(nextDate);
  };

  // 日付直接変更
  const handleDateChange = (date: string) => {
    if (date) {
      setCurrentDate(date);
    }
  };

  // セマンティック検索実行
  const handleSearch = async () => {
    const trimmed = searchQuery.trim();
    if (!trimmed) return;

    setIsSearching(true);
    setSearchError(null);
    setMode("search");

    try {
      const results = await searchArticles(trimmed, {
        limit: PAGE_SIZE,
        baseUrl: apiBaseUrl,
      });
      setSearchResults(results);
    } catch (err: any) {
      setSearchError(err?.message || "検索処理中にエラーが発生しました");
    } finally {
      setIsSearching(false);
    }
  };

  // 検索クリア
  const handleClearSearch = () => {
    setSearchQuery("");
    setSearchResults([]);
    setMode("daily");
    setSearchError(null);
  };

  // モード切替
  const handleModeChange = (newMode: "daily" | "search") => {
    setMode(newMode);
  };

  // 日別ページの内容。ページめくり中は前後の日付ぶんも同時に描画される
  const renderDailyPage = useCallback(
    (date: string, scrollRootRef: RefObject<HTMLElement | null>) => {
      const page = getPage(date);
      return (
        <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <ArticleList
            articles={page.articles}
            total={page.total}
            isLoading={page.isLoading}
            error={page.error}
            emptyMessage={`${date} の記事はまだありません`}
            onRetry={() => {
              void reloadPage(date);
            }}
            hasMore={page.hasMore}
            isLoadingMore={page.isLoadingMore}
            onLoadMore={() => {
              void loadMore(date);
            }}
            scrollRootRef={scrollRootRef}
          />
        </div>
      );
    },
    [getPage, reloadPage, loadMore],
  );

  return (
    <div className="h-dvh flex flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans antialiased selection:bg-blue-500 selection:text-white">
      {/* ヘッダー */}
      <Header
        currentDate={currentDate}
        mode={mode}
        onPrevDay={handlePrevDay}
        onNextDay={handleNextDay}
        onDateChange={handleDateChange}
        onModeChange={handleModeChange}
        isNextDisabled={isNextDisabled}
      />

      {/* メインコンテンツ (CSS hidden による高速タブ切り替え) */}
      <main className="flex-1 min-h-0 w-full">
        {/* 日別記事一覧ビュー */}
        <div className={mode === "daily" ? "h-full" : "hidden"}>
          <DailyPager
            currentDate={currentDate}
            prevDate={prevDate}
            nextDate={nextDate}
            canGoNext={!isNextDisabled}
            onDateChange={setCurrentDate}
            renderPage={renderDailyPage}
            enabled={mode === "daily"}
          />
        </div>

        {/* セマンティック検索ビュー */}
        <div className={mode === "search" ? "h-full overflow-y-auto overscroll-contain" : "hidden"}>
          <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <SearchBar
              query={searchQuery}
              onQueryChange={setSearchQuery}
              onSearch={handleSearch}
              onClear={handleClearSearch}
              isLoading={isSearching}
            />

            <ArticleList
              articles={searchResults}
              isLoading={isSearching}
              error={searchError}
              emptyMessage={
                searchQuery
                  ? `「${searchQuery}」に一致する記事は見つかりませんでした`
                  : "自然言語キーワードを入力して記事を検索してください"
              }
              onRetry={handleSearch}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
