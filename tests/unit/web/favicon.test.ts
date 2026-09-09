import { describe, it, expect } from "vitest";
import { extractFaviconHost, getFaviconUrl } from "../../../src/web/lib/favicon";

describe("extractFaviconHost", () => {
  it.each([
    ["https の記事 URL", "https://example.com/articles/1", "example.com"],
    ["http の記事 URL", "http://example.com/articles/1", "example.com"],
    ["サブドメイン付き", "https://tech.andpad.co.jp/entry/2026/09/09", "tech.andpad.co.jp"],
    ["ポート番号付き", "https://example.com:8443/a", "example.com"],
    ["クエリとフラグメント付き", "https://example.com/a?b=1#c", "example.com"],
    ["日本語ドメイン", "https://日本語.jp/a", "xn--wgv71a119e.jp"],
    ["前後の空白付き", "  https://example.com/a  ", "example.com"],
  ])("%s からホスト名を取り出せること", (_label, url, expected) => {
    expect(extractFaviconHost(url)).toBe(expected);
  });

  it.each([
    ["空文字列", ""],
    ["空白のみ", "   "],
    ["相対パス", "/articles/1"],
    ["スキームのない文字列", "example.com/a"],
    ["data スキーム", "data:text/html,<p>a</p>"],
    ["javascript スキーム", "javascript:alert(1)"],
    ["ftp スキーム", "ftp://example.com/a"],
  ])("%s の場合は null を返すこと", (_label, url) => {
    expect(extractFaviconHost(url)).toBeNull();
  });
});

describe("getFaviconUrl", () => {
  it("記事 URL のホスト名を対象とした favicon 画像の URL を組み立てること", () => {
    const faviconUrl = getFaviconUrl("https://blog.cloudflare.com/some-post/");
    expect(faviconUrl).not.toBeNull();

    const parsed = new URL(faviconUrl as string);
    expect(parsed.protocol).toBe("https:");
    expect(parsed.searchParams.get("domain")).toBe("blog.cloudflare.com");
    expect(parsed.searchParams.get("sz")).toBe("64");
  });

  it("記事 URL のパスやクエリを favicon の URL へ持ち込まないこと", () => {
    const faviconUrl = getFaviconUrl("https://example.com/secret/path?token=abc");
    expect(faviconUrl).toBe(getFaviconUrl("https://example.com/"));
    expect(faviconUrl).not.toContain("token");
    expect(faviconUrl).not.toContain("secret");
  });

  it("ホスト名を取り出せない URL の場合は null を返すこと", () => {
    expect(getFaviconUrl("not-a-url")).toBeNull();
  });
});
