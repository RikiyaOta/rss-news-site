import { Article, SearchResultItem } from "../../shared/types";

export interface FetchArticlesOptions {
  limit?: number;
  offset?: number;
  baseUrl?: string;
}

export interface SearchArticlesOptions {
  limit?: number;
  baseUrl?: string;
}

interface ArticlesApiResponse {
  date: string;
  total: number;
  articles: Article[];
}

export interface DailyArticlesResult {
  /** 取得したページぶんの記事 */
  articles: Article[];
  /** ページネーションに関わらない、その日の全件数 */
  total: number;
}

interface SearchApiResponse {
  query: string;
  total: number;
  results: SearchResultItem[];
}

/**
 * 指定日の記事一覧を取得する
 */
export async function fetchDailyArticles(
  date: string,
  options: FetchArticlesOptions = {},
): Promise<DailyArticlesResult> {
  const { limit = 30, offset = 0, baseUrl = "" } = options;
  const url = `${baseUrl}/api/articles?date=${encodeURIComponent(date)}&limit=${limit}&offset=${offset}`;

  const res = await fetch(url);
  if (!res.ok) {
    let errorMsg = `API エラー: ${res.status} ${res.statusText}`.trim();
    try {
      const errData = await res.json();
      if (errData && errData.error) {
        errorMsg = errData.error;
      }
    } catch {
      // JSONパース不可時はフォールバックメッセージを利用
    }
    throw new Error(errorMsg);
  }

  const data = (await res.json()) as ArticlesApiResponse;
  const articles = data.articles || [];
  // total が欠けている応答でも件数表示が壊れないよう、取得件数で代替する
  return { articles, total: typeof data.total === "number" ? data.total : articles.length };
}

/**
 * 自然言語クエリによるセマンティック検索を実行する
 */
export async function searchArticles(
  query: string,
  options: SearchArticlesOptions = {},
): Promise<SearchResultItem[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const { limit = 30, baseUrl = "" } = options;
  const url = `${baseUrl}/api/search?q=${encodeURIComponent(trimmed)}&limit=${limit}`;

  const res = await fetch(url);
  if (!res.ok) {
    let errorMsg = `API エラー: ${res.status} ${res.statusText}`.trim();
    try {
      const errData = await res.json();
      if (errData && errData.error) {
        errorMsg = errData.error;
      }
    } catch {
      // JSONパース不可時はフォールバックメッセージを利用
    }
    throw new Error(errorMsg);
  }

  const data = (await res.json()) as SearchApiResponse;
  return data.results || [];
}
