import { useState, useEffect, useCallback } from "react";
import { Article, SearchResultItem } from "../shared/types";
import { fetchDailyArticles, searchArticlesByVector } from "./lib/sqlite-client";
import { embedQuery } from "./lib/browser-embedder";
import { getR2PublicBaseUrl } from "./lib/r2-client";
import { Header } from "./components/Header";
import { SearchBar } from "./components/SearchBar";
import { ArticleList } from "./components/ArticleList";

export interface AppProps {
  initialDate?: string;
  initialR2BaseUrl?: string;
}

function getTodayString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function adjustDate(dateStr: string, offsetDays: number): string {
  const parts = dateStr.split("-").map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function App({ initialDate, initialR2BaseUrl }: AppProps) {
  const today = getTodayString();
  const [currentDate, setCurrentDate] = useState<string>(initialDate || today);
  const [mode, setMode] = useState<"daily" | "search">("daily");

  const [dailyArticles, setDailyArticles] = useState<Article[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const r2BaseUrl = initialR2BaseUrl ?? getR2PublicBaseUrl();

  // 日別記事一覧を取得
  const loadDailyArticles = useCallback(
    async (date: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const articles = await fetchDailyArticles(r2BaseUrl, date);
        setDailyArticles(articles);
      } catch (err: any) {
        setError(err?.message || "日別記事の取得に失敗しました");
      } finally {
        setIsLoading(false);
      }
    },
    [r2BaseUrl],
  );

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
      // 1. Web Worker でクエリを 384 次元ベクトルに変換
      const queryVec = await embedQuery(trimmed);

      // 2. Wasm SQLite で search_index.db を検索し該当レコードをマージ
      const results = await searchArticlesByVector(r2BaseUrl, queryVec, { topK: 30 });
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
        {/* 検索モード時の検索バー */}
        {mode === "search" && (
          <SearchBar
            query={searchQuery}
            onQueryChange={setSearchQuery}
            onSearch={handleSearch}
            onClear={handleClearSearch}
            isLoading={isSearching}
          />
        )}

        {/* 記事一覧 */}
        {mode === "daily" ? (
          <ArticleList
            articles={dailyArticles}
            isLoading={isLoading}
            error={error}
            emptyMessage={`${currentDate} の記事はまだありません`}
            onRetry={handleRetry}
          />
        ) : (
          <ArticleList
            articles={searchResults}
            isLoading={isSearching}
            error={error}
            emptyMessage={
              searchQuery
                ? `「${searchQuery}」に一致する記事は見つかりませんでした`
                : "自然言語キーワードを入力して記事を検索してください"
            }
            onRetry={handleRetry}
          />
        )}
      </main>

      {/* フッター */}
      <footer className="border-t border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
        <p>
          AI RSS News & Semantic Search &bull; Powered by Cloudflare R2, Wasm SQLite &amp;
          Transformers.js
        </p>
      </footer>
    </div>
  );
}

export default App;
