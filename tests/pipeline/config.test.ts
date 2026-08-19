import { describe, it, expect } from "vitest";
import path from "node:path";
import { parseConfig, loadConfig } from "../../src/pipeline/config";

describe("設定ファイル管理モジュール (src/pipeline/config) のテスト", () => {
  const rootDir = path.resolve(__dirname, "../..");
  const feedsYamlPath = path.join(rootDir, "config/feeds.yaml");

  describe("parseConfig", () => {
    it("正しいYAML文字列からフィード一覧とユーザープロファイルを正常に抽出できること", () => {
      const yamlContent = `
feeds:
  - name: "Zenn AI"
    url: "https://zenn.dev/topics/ai/feed"
  - name: "Hacker News"
    url: "https://news.ycombinator.com/rss"
profile:
  interests:
    - "TypeScript"
    - "Cloudflare"
    - "AI Agents"
  exclude_keywords:
    - "PR記事"
    - "初心者向けチュートリアル"
  scoring_guidelines: "技術的深みがあり実用的で新規性がある記事を高く評価する"
`;
      const config = parseConfig(yamlContent);
      expect(config.feeds).toHaveLength(2);
      expect(config.feeds[0]).toEqual({
        name: "Zenn AI",
        url: "https://zenn.dev/topics/ai/feed",
      });
      expect(config.feeds[1]).toEqual({
        name: "Hacker News",
        url: "https://news.ycombinator.com/rss",
      });
      expect(config.profile.interests).toEqual(["TypeScript", "Cloudflare", "AI Agents"]);
      expect(config.profile.exclude_keywords).toEqual(["PR記事", "初心者向けチュートリアル"]);
      expect(config.profile.scoring_guidelines).toBe(
        "技術的深みがあり実用的で新規性がある記事を高く評価する",
      );
    });

    it("プロファイル内のオプショナル項目が省略された場合にデフォルト値が適用されること", () => {
      const yamlContent = `
feeds:
  - name: "Minimal Feed"
    url: "https://example.com/rss"
profile: {}
`;
      const config = parseConfig(yamlContent);
      expect(config.feeds).toHaveLength(1);
      expect(config.profile.interests).toEqual([]);
      expect(config.profile.exclude_keywords).toEqual([]);
      expect(config.profile.scoring_guidelines).toBe("");
    });

    it("ルートがオブジェクトでない（配列やスカラー）場合はエラーを投げること", () => {
      expect(() => parseConfig("- list item 1\n- list item 2")).toThrow(
        "ルートはオブジェクトである必要があります",
      );
      expect(() => parseConfig("just a scalar string")).toThrow(
        "ルートはオブジェクトである必要があります",
      );
    });

    it("feedsフィールドが存在しない場合はエラーを投げること", () => {
      const yamlContent = `
profile:
  interests:
    - "TypeScript"
`;
      expect(() => parseConfig(yamlContent)).toThrow("feeds と profile が必要です");
    });

    it("profileフィールドが存在しない場合はエラーを投げること", () => {
      const yamlContent = `
feeds:
  - name: "Test Feed"
    url: "https://example.com/rss"
`;
      expect(() => parseConfig(yamlContent)).toThrow("feeds と profile が必要です");
    });

    it("feedsが配列でない場合はエラーを投げること", () => {
      const yamlContent = `
feeds: "invalid-not-an-array"
profile:
  interests: []
`;
      expect(() => parseConfig(yamlContent)).toThrow("feeds と profile が必要です");
    });

    it("フィードアイテムに必須プロパティ（nameまたはurl）が欠けている場合はエラーを投げること", () => {
      const yamlContentNoUrl = `
feeds:
  - name: "No URL Feed"
profile: {}
`;
      expect(() => parseConfig(yamlContentNoUrl)).toThrow("無効なフィード設定が含まれています");

      const yamlContentNoName = `
feeds:
  - url: "https://example.com/rss"
profile: {}
`;
      expect(() => parseConfig(yamlContentNoName)).toThrow("無効なフィード設定が含まれています");
    });

    it("不正なYAML構文に対してパースエラーを投げること", () => {
      expect(() => parseConfig("invalid: yaml: :")).toThrow();
    });

    it("空文字列やnull値が渡された場合にエラーを投げること", () => {
      expect(() => parseConfig("")).toThrow("設定ファイルのフォーマットが不正です");
      expect(() => parseConfig("   ")).toThrow("設定ファイルのフォーマットが不正です");
    });
  });

  describe("loadConfig", () => {
    it("実際の config/feeds.yaml を正常に読み込めること", () => {
      const config = loadConfig(feedsYamlPath);
      expect(config.feeds.length).toBeGreaterThan(0);
      for (const feed of config.feeds) {
        expect(feed.name).toBeDefined();
        expect(feed.url).toMatch(/^https?:\/\//);
      }
      expect(config.profile).toBeDefined();
      expect(Array.isArray(config.profile.interests)).toBe(true);
      expect(Array.isArray(config.profile.exclude_keywords)).toBe(true);
      expect(typeof config.profile.scoring_guidelines).toBe("string");
    });

    it("存在しないファイルパスが指定された場合にエラーを投げること", () => {
      const nonExistentPath = path.join(rootDir, "config/non-existent-file.yaml");
      expect(() => loadConfig(nonExistentPath)).toThrow();
    });
  });
});
