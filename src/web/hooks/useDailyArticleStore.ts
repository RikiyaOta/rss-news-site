import { useCallback, useEffect, useRef, useState } from "react";
import { Article } from "../../shared/types";
import { fetchDailyArticles } from "../lib/api-client";

export interface DailyPageState {
  articles: Article[];
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
}

/** 未取得の日付に対して返す初期状態（読み込み中として扱う） */
export const INITIAL_DAILY_PAGE: DailyPageState = {
  articles: [],
  hasMore: false,
  isLoading: true,
  isLoadingMore: false,
  error: null,
};

export interface UseDailyArticleStoreOptions {
  pageSize: number;
  apiBaseUrl?: string;
}

export interface DailyArticleStore {
  /** 指定日の状態を取得する。未取得の場合は読み込み中の初期状態を返す */
  getPage: (date: string) => DailyPageState;
  /** 未取得（または取得に失敗した）日付のみ取得する。先読みに用いる */
  ensurePage: (date: string) => Promise<void>;
  /** 取得済みかどうかに関わらず再取得する */
  reloadPage: (date: string) => Promise<void>;
  /** 次ページを追記読み込みする */
  loadMore: (date: string) => Promise<void>;
}

/**
 * 日付ごとの記事一覧をキャッシュするストア。
 *
 * ページめくり中は遷移元・遷移先の両方を同時に描画する必要があるため、
 * 表示中の日付だけでなく前後の日付も保持できるようにしている。
 */
export function useDailyArticleStore({
  pageSize,
  apiBaseUrl = "",
}: UseDailyArticleStoreOptions): DailyArticleStore {
  const [pages, setPages] = useState<Record<string, DailyPageState>>({});

  // コールバックから最新の状態を参照するためのミラー
  const pagesRef = useRef<Record<string, DailyPageState>>({});
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  // 同一日付への同時リクエストを防ぐ
  const inFlightRef = useRef<Set<string>>(new Set());

  const reloadPage = useCallback(
    async (date: string) => {
      if (inFlightRef.current.has(date)) return;
      inFlightRef.current.add(date);

      setPages((prev) => ({
        ...prev,
        [date]: { ...(prev[date] ?? INITIAL_DAILY_PAGE), isLoading: true, error: null },
      }));

      try {
        const articles = await fetchDailyArticles(date, {
          limit: pageSize,
          offset: 0,
          baseUrl: apiBaseUrl,
        });
        setPages((prev) => ({
          ...prev,
          [date]: {
            articles,
            hasMore: articles.length >= pageSize,
            isLoading: false,
            isLoadingMore: false,
            error: null,
          },
        }));
      } catch (err: any) {
        setPages((prev) => ({
          ...prev,
          [date]: {
            ...INITIAL_DAILY_PAGE,
            isLoading: false,
            error: err?.message || "日別記事の取得に失敗しました",
          },
        }));
      } finally {
        inFlightRef.current.delete(date);
      }
    },
    [pageSize, apiBaseUrl],
  );

  const ensurePage = useCallback(
    async (date: string) => {
      const page = pagesRef.current[date];
      if (page && !page.error) return;
      await reloadPage(date);
    },
    [reloadPage],
  );

  const loadMore = useCallback(
    async (date: string) => {
      const page = pagesRef.current[date];
      if (!page || page.isLoadingMore || !page.hasMore) return;

      const offset = page.articles.length;
      setPages((prev) =>
        prev[date] ? { ...prev, [date]: { ...prev[date], isLoadingMore: true } } : prev,
      );

      try {
        const moreArticles = await fetchDailyArticles(date, {
          limit: pageSize,
          offset,
          baseUrl: apiBaseUrl,
        });
        setPages((prev) => {
          const current = prev[date];
          if (!current) return prev;
          return {
            ...prev,
            [date]: {
              ...current,
              articles: [...current.articles, ...moreArticles],
              hasMore: moreArticles.length >= pageSize,
              isLoadingMore: false,
            },
          };
        });
      } catch (err: any) {
        setPages((prev) => {
          const current = prev[date];
          if (!current) return prev;
          return {
            ...prev,
            [date]: {
              ...current,
              isLoadingMore: false,
              error: err?.message || "追加記事の取得に失敗しました",
            },
          };
        });
      }
    },
    [pageSize, apiBaseUrl],
  );

  const getPage = useCallback(
    (date: string): DailyPageState => pages[date] ?? INITIAL_DAILY_PAGE,
    [pages],
  );

  return { getPage, ensurePage, reloadPage, loadMore };
}
