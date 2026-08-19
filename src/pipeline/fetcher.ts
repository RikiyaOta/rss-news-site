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
    "User-Agent": "rss-news-site-bot/1.0 (+https://github.com/RikiyaOta/rss-news-site)",
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

export async function fetchFeedArticles(
  source: FeedSource,
  parser: Parser = defaultParser,
): Promise<RawArticle[]> {
  try {
    const feed = await parser.parseURL(source.url);
    const items = feed?.items ?? [];
    return items.map((item) => normalizeFeedItem(item, source.name));
  } catch (error) {
    console.error(`フィード取得失敗 [${source.name} - ${source.url}]:`, error);
    return [];
  }
}
