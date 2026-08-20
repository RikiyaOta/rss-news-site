import crypto from "node:crypto";
import Parser from "rss-parser";
import { FeedSource } from "../shared/types";

export interface RawArticle {
  id: string;
  title: string;
  url: string;
  source_name: string;
  snippet: string;
  published_at: string;
}

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

  let published_at = new Date().toISOString();
  const dateCandidate = item?.isoDate || item?.pubDate || item?.date;
  if (dateCandidate) {
    const parsed = new Date(dateCandidate);
    if (!isNaN(parsed.getTime())) {
      published_at = parsed.toISOString();
    }
  }

  return {
    id,
    title,
    url,
    source_name: sourceName,
    snippet,
    published_at,
  };
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
): Promise<RawArticle[]> {
  try {
    const feed = await parser.parseURL(source.url);
    const rawItems = feed?.items ?? [];
    // 1フィードあたり最新30件に制限
    const items = rawItems.slice(0, 30);
    const articles = items
      .map((item) => normalizeFeedItem(item, source.name))
      .filter((article) => Boolean(article.url && article.url.trim()));

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
