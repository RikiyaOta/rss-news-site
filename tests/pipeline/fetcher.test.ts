import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Parser from "rss-parser";
import {
  generateArticleId,
  normalizeFeedItem,
  fetchFeedArticles,
  extractMetaDescription,
  fetchPageDescription,
  type RawArticle,
} from "../../src/pipeline/fetcher";
import { FeedSource } from "../../src/shared/types";

describe("RSSフィード取得・正規化モジュール (src/pipeline/fetcher) のテスト", () => {
  describe("generateArticleId", () => {
    it("同一URLから一意かつ決定論的な16文字のハッシュIDを生成できること", () => {
      const url = "https://example.com/posts/ai-news-2026";
      const id1 = generateArticleId(url);
      const id2 = generateArticleId(url);

      expect(id1).toBe(id2);
      expect(id1).toHaveLength(16);
      expect(id1).toMatch(/^[0-9a-f]{16}$/);
    });

    it("前後に空白を含むURLでもトリムされて同一のハッシュIDが生成されること", () => {
      const url = "https://example.com/posts/ai-news-2026";
      const urlWithSpaces = "   https://example.com/posts/ai-news-2026   \n";

      const id1 = generateArticleId(url);
      const id2 = generateArticleId(urlWithSpaces);

      expect(id1).toBe(id2);
    });

    it("異なるURLからは異なるハッシュIDが生成されること", () => {
      const id1 = generateArticleId("https://example.com/post-1");
      const id2 = generateArticleId("https://example.com/post-2");

      expect(id1).not.toBe(id2);
    });

    it("生成されるIDは16文字の小文字16進数であること", () => {
      const id = generateArticleId("https://example.com/test");
      expect(id).toMatch(/^[0-9a-f]{16}$/);
    });

    it("空文字列に対しても決定論的なハッシュIDを生成すること", () => {
      const id1 = generateArticleId("");
      const id2 = generateArticleId("   ");
      expect(id1).toBe(id2);
      expect(id1).toHaveLength(16);
    });
  });

  describe("normalizeFeedItem", () => {
    it("標準的なフィードアイテムを正しくRawArticleに正規化できること", () => {
      const rawItem = {
        title: "TypeScript 5.8の新機能紹介",
        link: "https://example.com/posts/ts-5-8",
        contentSnippet: "TypeScript 5.8では多くのパフォーマンス改善が行われました。",
        isoDate: "2026-08-19T00:00:00.000Z",
      };

      const article: RawArticle = normalizeFeedItem(rawItem, "Zenn TypeScript");

      expect(article.id).toBe(generateArticleId("https://example.com/posts/ts-5-8"));
      expect(article.title).toBe("TypeScript 5.8の新機能紹介");
      expect(article.url).toBe("https://example.com/posts/ts-5-8");
      expect(article.source_name).toBe("Zenn TypeScript");
      expect(article.snippet).toBe("TypeScript 5.8では多くのパフォーマンス改善が行われました。");
      expect(article.published_at).toBe("2026-08-19T00:00:00.000Z");
    });

    it("linkが存在せずguidが存在する場合にguidをURLとして使用すること", () => {
      const rawItem = {
        title: "GUIDのみの記事",
        guid: "https://example.com/posts/guid-only",
        contentSnippet: "概要テキスト",
        isoDate: "2026-08-19T01:00:00.000Z",
      };

      const article = normalizeFeedItem(rawItem, "Hacker News");

      expect(article.url).toBe("https://example.com/posts/guid-only");
      expect(article.id).toBe(generateArticleId("https://example.com/posts/guid-only"));
    });

    it("linkおよびguidが存在せずidが存在する場合にidをURLとして使用すること", () => {
      const rawItem = {
        title: "IDのみの記事",
        id: "https://example.com/posts/id-only",
        contentSnippet: "概要テキスト",
        date: "2026-08-19T02:00:00.000Z",
      };

      const article = normalizeFeedItem(rawItem, "Hacker News");

      expect(article.url).toBe("https://example.com/posts/id-only");
      expect(article.id).toBe(generateArticleId("https://example.com/posts/id-only"));
      expect(article.published_at).toBe("2026-08-19T02:00:00.000Z");
    });

    it("空のオブジェクトや未定義プロパティに対しても安全に正規化できること", () => {
      const article = normalizeFeedItem({}, "Fallback Source");

      expect(article.title).toBe("No Title");
      expect(article.url).toBe("");
      expect(article.snippet).toBe("");
      expect(article.source_name).toBe("Fallback Source");
      expect(typeof article.published_at).toBe("string");
      expect(typeof article.id).toBe("string");
    });

    it("タイトルが未指定または空文字・空白のみの場合に 'No Title' にフォールバックすること", () => {
      const itemNoTitle = {
        link: "https://example.com/no-title",
      };
      const itemEmptyTitle = {
        title: "   ",
        link: "https://example.com/empty-title",
      };

      const article1 = normalizeFeedItem(itemNoTitle, "Test Source");
      const article2 = normalizeFeedItem(itemEmptyTitle, "Test Source");

      expect(article1.title).toBe("No Title");
      expect(article2.title).toBe("No Title");
    });

    it("本文や概要に含まれるHTMLタグや過剰な空白を除去すること", () => {
      const rawItem = {
        title: "  <b>タグ付き</b> タイトル  ",
        link: "https://example.com/html-content",
        content: "<p>段落1</p>\n<div>段落2 <a href='https://example.com'>リンク</a></div>",
        pubDate: "Wed, 19 Aug 2026 12:00:00 GMT",
      };

      const article = normalizeFeedItem(rawItem, "HTML Source");

      expect(article.title).toBe("タグ付き タイトル");
      expect(article.snippet).toBe("段落1 段落2 リンク");
    });

    it("contentSnippet, content, summaryの優先順位で概要を抽出すること", () => {
      const itemWithSnippet = {
        title: "Snippet優先テスト",
        link: "https://example.com/1",
        contentSnippet: "スニペット本文",
        content: "詳細本文",
        summary: "サマリー",
      };
      const itemWithContent = {
        title: "Content優先テスト",
        link: "https://example.com/2",
        content: "<p>コンテンツ本文</p>",
        summary: "サマリー",
      };
      const itemWithSummary = {
        title: "Summary優先テスト",
        link: "https://example.com/3",
        summary: "<p>サマリー本文</p>",
      };

      expect(normalizeFeedItem(itemWithSnippet, "Source").snippet).toBe("スニペット本文");
      expect(normalizeFeedItem(itemWithContent, "Source").snippet).toBe("コンテンツ本文");
      expect(normalizeFeedItem(itemWithSummary, "Source").snippet).toBe("サマリー本文");
    });

    it("pubDateの日時文字列をISO 8601形式に変換できること", () => {
      const rawItem = {
        title: "日付パーステスト",
        link: "https://example.com/date-test",
        pubDate: "Wed, 19 Aug 2026 09:30:00 GMT",
      };

      const article = normalizeFeedItem(rawItem, "Date Source");
      expect(article.published_at).toBe("2026-08-19T09:30:00.000Z");
    });

    it("日付が無効または存在しない場合に現在時刻（ISO 8601形式）にフォールバックすること", () => {
      const rawItemInvalidDate = {
        title: "不正な日付",
        link: "https://example.com/invalid-date",
        pubDate: "invalid date string",
      };
      const rawItemNoDate = {
        title: "日付なし",
        link: "https://example.com/no-date",
      };

      const beforeTime = new Date().getTime();
      const article1 = normalizeFeedItem(rawItemInvalidDate, "Source");
      const article2 = normalizeFeedItem(rawItemNoDate, "Source");
      const afterTime = new Date().getTime();

      const time1 = new Date(article1.published_at).getTime();
      const time2 = new Date(article2.published_at).getTime();

      expect(isNaN(time1)).toBe(false);
      expect(isNaN(time2)).toBe(false);
      expect(time1).toBeGreaterThanOrEqual(beforeTime);
      expect(time1).toBeLessThanOrEqual(afterTime);
      expect(time2).toBeGreaterThanOrEqual(beforeTime);
      expect(time2).toBeLessThanOrEqual(afterTime);
    });
  });

  describe("fetchFeedArticles", () => {
    let mockParser: any;

    beforeEach(() => {
      mockParser = {
        parseURL: vi.fn(),
      };
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("正常なフィードから記事一覧を取得・正規化して返却できること", async () => {
      const source: FeedSource = {
        name: "Test Feed",
        url: "https://example.com/feed.xml",
      };

      mockParser.parseURL.mockResolvedValue({
        items: [
          {
            title: "記事1",
            link: "https://example.com/item-1",
            contentSnippet: "概要1",
            isoDate: "2026-08-19T00:00:00.000Z",
          },
          {
            title: "記事2",
            link: "https://example.com/item-2",
            contentSnippet: "概要2",
            isoDate: "2026-08-19T01:00:00.000Z",
          },
        ],
      });

      const articles = await fetchFeedArticles(source, mockParser);

      expect(mockParser.parseURL).toHaveBeenCalledWith("https://example.com/feed.xml");
      expect(articles).toHaveLength(2);
      expect(articles[0].title).toBe("記事1");
      expect(articles[0].source_name).toBe("Test Feed");
      expect(articles[1].title).toBe("記事2");
      expect(articles[1].source_name).toBe("Test Feed");
    });

    it("URLが空または未指定の無効なフィードアイテムを除外して有効な記事のみを返却すること", async () => {
      const source: FeedSource = {
        name: "Test Feed",
        url: "https://example.com/feed.xml",
      };

      mockParser.parseURL.mockResolvedValue({
        items: [
          {
            title: "有効な記事",
            link: "https://example.com/valid",
            contentSnippet: "概要1",
          },
          {
            title: "URLなしの記事",
            link: "",
            guid: "   ",
            contentSnippet: "概要2",
          },
          {
            title: "リンクプロパティなしの記事",
            contentSnippet: "概要3",
          },
        ],
      });

      const articles = await fetchFeedArticles(source, mockParser);

      expect(articles).toHaveLength(1);
      expect(articles[0].title).toBe("有効な記事");
      expect(articles[0].url).toBe("https://example.com/valid");
    });

    it("フィード取得時にエラーが発生した場合にエラーログを出力し空配列を返すこと", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const source: FeedSource = {
        name: "Failing Feed",
        url: "https://example.com/error-feed.xml",
      };

      mockParser.parseURL.mockRejectedValue(new Error("Network connection error (ETIMEDOUT)"));

      const articles = await fetchFeedArticles(source, mockParser);

      expect(articles).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it("フィードのitemsが未定義または空の場合に空配列を返すこと", async () => {
      const source: FeedSource = {
        name: "Empty Feed",
        url: "https://example.com/empty.xml",
      };

      mockParser.parseURL.mockResolvedValue({});

      const articles = await fetchFeedArticles(source, mockParser);
      expect(articles).toEqual([]);
    });

    it("デフォルトのパーサーを用いて実際のRSSフェッチャーインスタンスを呼び出せること", async () => {
      const parseURLSpy = vi.spyOn(Parser.prototype, "parseURL").mockResolvedValue({
        items: [
          {
            title: "デフォルトパーサーテスト",
            link: "https://example.com/default-test",
            contentSnippet: "テスト概要",
          },
        ],
      } as any);

      const source: FeedSource = {
        name: "Default Feed",
        url: "https://example.com/default.xml",
      };

      const articles = await fetchFeedArticles(source);
      expect(articles).toHaveLength(1);
      expect(articles[0].title).toBe("デフォルトパーサーテスト");
      expect(articles[0].source_name).toBe("Default Feed");

      parseURLSpy.mockRestore();
    });

    it("snippetが空の記事についてURLからメタディスクリプションを取得して補完すること", async () => {
      const source: FeedSource = {
        name: "Hacker News",
        url: "https://news.ycombinator.com/rss",
      };

      mockParser.parseURL.mockResolvedValue({
        items: [
          {
            title: "Show HN: Modern AI News Site",
            link: "https://example.com/show-hn",
            contentSnippet: "",
          },
        ],
      });

      const mockFetch: typeof fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          '<html><head><meta property="og:description" content="An open source AI news platform built with TypeScript."></head></html>',
      } as any);

      const articles = await fetchFeedArticles(source, mockParser, mockFetch);

      expect(articles).toHaveLength(1);
      expect(articles[0].snippet).toBe("An open source AI news platform built with TypeScript.");
      expect(mockFetch).toHaveBeenCalledWith("https://example.com/show-hn", expect.any(Object));
    });

    it("snippetが既に存在する記事については追加取得を行わないこと", async () => {
      const source: FeedSource = {
        name: "Tech Blog",
        url: "https://techblog.example.com/rss",
      };

      mockParser.parseURL.mockResolvedValue({
        items: [
          {
            title: "Blog Post with snippet",
            link: "https://techblog.example.com/post-1",
            contentSnippet: "Existing snippet content",
          },
        ],
      });

      const mockFetch: typeof fetch = vi.fn();

      const articles = await fetchFeedArticles(source, mockParser, mockFetch);

      expect(articles).toHaveLength(1);
      expect(articles[0].snippet).toBe("Existing snippet content");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("extractMetaDescription & fetchPageDescription", () => {
    it("og:description メタタグからコンテンツを抽出できること", () => {
      const html = `<html><head><meta property="og:description" content="This is an article about AI Agents and TypeScript."></head></html>`;
      expect(extractMetaDescription(html)).toBe("This is an article about AI Agents and TypeScript.");
    });

    it("meta name='description' からコンテンツを抽出できること", () => {
      const html = `<html><head><meta name="description" content="A comprehensive guide to Cloudflare Workers."></head></html>`;
      expect(extractMetaDescription(html)).toBe("A comprehensive guide to Cloudflare Workers.");
    });

    it("twitter:description メタタグからコンテンツを抽出できること", () => {
      const html = `<html><head><meta name="twitter:description" content="Twitter card description content."></head></html>`;
      expect(extractMetaDescription(html)).toBe("Twitter card description content.");
    });

    it("メタタグの属性順序が content -> property の場合でも抽出できること", () => {
      const html = `<html><head><meta content="Content before property attribute" property="og:description"></head></html>`;
      expect(extractMetaDescription(html)).toBe("Content before property attribute");
    });

    it("メタタグの属性順序が content -> name の場合でも抽出できること", () => {
      const html = `<html><head><meta content="Content before name attribute" name="description"></head></html>`;
      expect(extractMetaDescription(html)).toBe("Content before name attribute");
    });

    it("メタタグ内のHTMLエンティティや過剰な空白、タグがクリーンアップされること", () => {
      const html = `<html><head><meta property="og:description" content="  <b>Cleaned</b>  description &amp; info  "></head></html>`;
      expect(extractMetaDescription(html)).toBe("Cleaned description &amp; info");
    });

    it("メタタグが存在しない場合は空文字を返すこと", () => {
      const html = `<html><head><title>No Description</title></head></html>`;
      expect(extractMetaDescription(html)).toBe("");
    });

    it("HTMLが空文字または無効な入力の場合は空文字を返すこと", () => {
      expect(extractMetaDescription("")).toBe("");
      expect(extractMetaDescription(null as any)).toBe("");
      expect(extractMetaDescription(undefined as any)).toBe("");
    });

    it("fetchPageDescription: 正常にHTMLを取得してメタディスクリプションを返却できること", async () => {
      const mockFetch: typeof fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          '<html><head><meta property="og:description" content="Fetched page description."></head></html>',
      } as any);

      const desc = await fetchPageDescription("https://example.com/page", mockFetch);
      expect(desc).toBe("Fetched page description.");
      expect(mockFetch).toHaveBeenCalledWith("https://example.com/page", expect.objectContaining({
        headers: expect.objectContaining({
          "User-Agent": expect.any(String),
          Accept: "text/html,application/xhtml+xml",
        }),
      }));
    });

    it("fetchPageDescription: HTTPステータスが200以外（非ok）の場合は空文字を返すこと", async () => {
      const mockFetch: typeof fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      } as any);

      const desc = await fetchPageDescription("https://example.com/not-found", mockFetch);
      expect(desc).toBe("");
    });

    it("fetchPageDescription: ネットワークエラーやタイムアウト時は安全に空文字を返すこと", async () => {
      const failingFetch: typeof fetch = vi.fn().mockRejectedValue(new Error("Network timeout"));
      const desc = await fetchPageDescription("https://example.com/timeout", failingFetch);
      expect(desc).toBe("");
    });
  });
});

