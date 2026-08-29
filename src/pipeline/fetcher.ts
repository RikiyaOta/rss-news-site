import crypto from "node:crypto";
import Parser from "rss-parser";
import { FeedSource } from "../shared/types";

export interface RawArticle {
  id: string;
  title: string;
  url: string;
  source_name: string;
  snippet: string;
  /**
   * フィードが提供する公開日時 (UTC ISO8601)。
   * 取得できない場合は収集時刻で代替せず null とする（画面の日付は公開日を正とするため）。
   */
  published_at: string | null;
}

/** 公開日時が確定した記事（スコアリング・保存の対象） */
export interface DatedArticle extends RawArticle {
  published_at: string;
}

/**
 * 公開日時として参照するフィールドの優先順位。
 * Atom の published を updated より優先し、記事の更新で日付が後ろへ動かないようにする。
 */
const PUBLISHED_AT_FIELDS = ["published", "isoDate", "pubDate", "date", "dc:date"] as const;

/** フィード側のタイムゾーン誤りを吸収しつつ、明らかに壊れた未来日付を除外する許容幅 */
export const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

const defaultParser = new Parser({
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
  },
  timeout: 10000,
});

export function generateArticleId(url: string): string {
  return crypto.createHash("sha256").update(url.trim()).digest("hex").slice(0, 16).toLowerCase();
}

function cleanText(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * フィードアイテムから公開日時 (UTC ISO8601) を抽出する。
 * パース可能な公開日時が1つも無い場合は null を返す。
 */
export function extractPublishedAt(item: any): string | null {
  for (const field of PUBLISHED_AT_FIELDS) {
    const value = item?.[field];
    if (typeof value !== "string" || !value.trim()) continue;
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return null;
}

export function normalizeFeedItem(item: any, sourceName: string): RawArticle {
  const rawUrl =
    (typeof item?.link === "string" && item.link) ||
    (typeof item?.guid === "string" && item.guid) ||
    (typeof item?.id === "string" && item.id) ||
    "";
  const url = rawUrl.trim();
  const id = generateArticleId(url);

  const rawTitle = typeof item?.title === "string" ? item.title : "";
  const title = cleanText(rawTitle) || "No Title";

  const rawSnippet =
    (typeof item?.contentSnippet === "string" && item.contentSnippet) ||
    (typeof item?.content === "string" && item.content) ||
    (typeof item?.summary === "string" && item.summary) ||
    "";
  const snippet = cleanText(rawSnippet);

  return {
    id,
    title,
    url,
    source_name: sourceName,
    snippet,
    published_at: extractPublishedAt(item),
  };
}

/**
 * 記事を取り込み対象とするかを公開日時から判定する。
 * 公開日時が不明な記事、直近 maxDays 日より古い過去アーカイブ、
 * および許容幅を超える未来日付（フィード側の日付不備）はいずれも除外する。
 */
export function isWithinDays(
  isoDateStr: string | null,
  maxDays = 3,
  referenceDate: Date = new Date(),
): boolean {
  if (!isoDateStr) return false;
  const date = new Date(isoDateStr);
  if (isNaN(date.getTime())) return false;

  const cutoff = referenceDate.getTime() - maxDays * 24 * 60 * 60 * 1000;
  if (date.getTime() < cutoff) return false;

  return date.getTime() <= referenceDate.getTime() + FUTURE_TOLERANCE_MS;
}

/**
 * HTML 文字列から og:description または meta description を抽出する
 */
export function extractMetaDescription(html: string): string {
  if (!html || typeof html !== "string") return "";

  // 1. og:description の抽出
  const ogMatch =
    html.match(
      /<meta\s+[^>]*?(?:property|name)=["'](?:og:description|twitter:description)["'][^>]*?content=["']([\s\S]*?)["'][^>]*?>/i,
    ) ||
    html.match(
      /<meta\s+[^>]*?content=["']([\s\S]*?)["'][^>]*?(?:property|name)=["'](?:og:description|twitter:description)["'][^>]*?>/i,
    );
  if (ogMatch && ogMatch[1]) {
    return cleanText(ogMatch[1]);
  }

  // 2. meta name="description" の抽出
  const metaMatch =
    html.match(/<meta\s+[^>]*?name=["']description["'][^>]*?content=["']([\s\S]*?)["'][^>]*?>/i) ||
    html.match(/<meta\s+[^>]*?content=["']([\s\S]*?)["'][^>]*?name=["']description["'][^>]*?>/i);
  if (metaMatch && metaMatch[1]) {
    return cleanText(metaMatch[1]);
  }

  return "";
}

/**
 * 指定された URL の HTML を取得し、メタディスクリプションを抽出する（タイムアウト 5 秒）
 */
export async function fetchPageDescription(
  url: string,
  customFetch: typeof fetch = fetch,
): Promise<string> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await customFetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timeoutId);

    if (!response.ok) return "";
    const html = await response.text();
    return extractMetaDescription(html);
  } catch {
    return "";
  }
}

export async function fetchFeedArticles(
  source: FeedSource,
  parser: Parser = defaultParser,
  customFetch?: typeof fetch,
  maxAgeDays = 3,
): Promise<DatedArticle[]> {
  try {
    const feed = await parser.parseURL(source.url);
    const rawItems = feed?.items ?? [];
    const normalized = rawItems
      .map((item) => normalizeFeedItem(item, source.name))
      .filter((article) => Boolean(article.url && article.url.trim()));

    const missingDateCount = normalized.filter((article) => !article.published_at).length;
    if (missingDateCount > 0) {
      console.warn(
        `  ⚠️ [${source.name}] 公開日時が取得できない記事を ${missingDateCount} 件除外しました。`,
      );
    }

    const articles = normalized.filter((article): article is DatedArticle =>
      isWithinDays(article.published_at, maxAgeDays),
    );

    // snippet が空の記事について og:description の補完を試行
    for (const article of articles) {
      if (!article.snippet && article.url) {
        article.snippet = await fetchPageDescription(article.url, customFetch);
      }
    }

    return articles;
  } catch (error) {
    console.error(`フィード取得失敗 [${source.name} - ${source.url}]:`, error);
    return [];
  }
}
