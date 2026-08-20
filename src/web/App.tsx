import { useState, useEffect, useCallback } from "react";
import { Article, SearchResultItem } from "../shared/types";
import { fetchDailyArticles, searchArticles } from "./lib/api-client";
import { Header } from "./components/Header";
import { SearchBar } from "./components/SearchBar";
import { ArticleList } from "./components/ArticleList";

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

  const [dailyArticles, setDailyArticles] = useState<Article[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [hasMoreDaily, setHasMoreDaily] = useState<boolean>(false);

  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // 日別記事一覧の初回取得
  const loadDailyArticles = useCallback(
    async (date: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const articles = await fetchDailyArticles(date, {
          limit: PAGE_SIZE,
          offset: 0,
          baseUrl: apiBaseUrl,
        });
        setDailyArticles(articles);
        setHasMoreDaily(articles.length >= PAGE_SIZE);
      } catch (err: any) {
        setError(err?.message || "日別記事の取得に失敗しました");
      } finally {
        setIsLoading(false);
      }
    },
    [apiBaseUrl],
  );

  // 追加記事の読み込み（無限スクロール / ページネーション）
  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !hasMoreDaily) return;

    setIsLoadingMore(true);
    try {
      const moreArticles = await fetchDailyArticles(currentDate, {
        limit: PAGE_SIZE,
        offset: dailyArticles.length,
        baseUrl: apiBaseUrl,
      });
      setDailyArticles((prev) => [...prev, ...moreArticles]);
      setHasMoreDaily(moreArticles.length >= PAGE_SIZE);
    } catch (err: any) {
      setError(err?.message || "追加記事の取得に失敗しました");
    } finally {
      setIsLoadingMore(false);
    }
  }, [currentDate, dailyArticles.length, hasMoreDaily, isLoadingMore, apiBaseUrl]);

  // 初期ロードおよび日付変更時の記事取得
  useEffect(() => {
    loadDailyArticles(currentDate);
  }, [currentDate, loadDailyArticles]);

  // 前日へ
  const handlePrevDay = () => {
    const prev = adjustDate(currentDate, -1);
    setCurrentDate(prev);
  };

  // 翌日へ
  const handleNextDay = () => {
    const next = adjustDate(currentDate, 1);
    setCurrentDate(next);
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
    setError(null);
    setMode("search");

    try {
      const results = await searchArticles(trimmed, {
        limit: PAGE_SIZE,
        baseUrl: apiBaseUrl,
      });
      setSearchResults(results);
    } catch (err: any) {
      setError(err?.message || "検索処理中にエラーが発生しました");
    } finally {
      setIsSearching(false);
    }
  };

  // 検索クリア
  const handleClearSearch = () => {
    setSearchQuery("");
    setSearchResults([]);
    setMode("daily");
    setError(null);
  };

  // モード切替
  const handleModeChange = (newMode: "daily" | "search") => {
    setMode(newMode);
    setError(null);
  };

  // 再試行
  const handleRetry = () => {
    if (mode === "daily") {
      loadDailyArticles(currentDate);
    } else {
      handleSearch();
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex flex-col font-sans antialiased selection:bg-blue-500 selection:text-white">
      {/* ヘッダー */}
      <Header
        currentDate={currentDate}
        mode={mode}
        onPrevDay={handlePrevDay}
        onNextDay={handleNextDay}
        onDateChange={handleDateChange}
        onModeChange={handleModeChange}
        isNextDisabled={currentDate >= today && !initialDate}
      />

      {/* メインコンテンツ */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 日別記事一覧ビュー (CSS hidden による高速タブ切り替え) */}
        <div className={mode === "daily" ? "block" : "hidden"}>
          <ArticleList
            articles={dailyArticles}
            isLoading={isLoading}
            error={mode === "daily" ? error : null}
            emptyMessage={`${currentDate} の記事はまだありません`}
            onRetry={handleRetry}
            hasMore={hasMoreDaily}
            isLoadingMore={isLoadingMore}
            onLoadMore={handleLoadMore}
          />
        </div>

        {/* セマンティック検索ビュー (CSS hidden による高速タブ切り替え) */}
        <div className={mode === "search" ? "block" : "hidden"}>
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
            error={mode === "search" ? error : null}
            emptyMessage={
              searchQuery
                ? `「${searchQuery}」に一致する記事は見つかりませんでした`
                : "自然言語キーワードを入力して記事を検索してください"
            }
            onRetry={handleRetry}
          />
        </div>
      </main>

      {/* フッター */}
      <footer className="border-t border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
        <p>
          AI RSS News &amp; Semantic Search &bull; Powered by Cloudflare Workers, D1 &amp; Workers
          AI (BGE-M3)
        </p>
      </footer>
    </div>
  );
}

export default App;
