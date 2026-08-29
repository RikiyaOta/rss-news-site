import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import { runPipeline, PipelineOptions } from "../../src/pipeline/index";
import * as d1SyncModule from "../../src/pipeline/d1-sync";
import * as fetcherModule from "../../src/pipeline/fetcher";
import * as scorerModule from "../../src/pipeline/scorer";
import { initLocalDatabase } from "../../src/pipeline/db";

describe("パイプライン統合実行スクリプト (src/pipeline/index) のテスト", () => {
  let tempDir: string;
  let configFilePath: string;
  const originalEnv = process.env;

  const mockConfig = {
    feeds: [
      { name: "Tech Feed 1", url: "https://example.com/feed1.xml" },
      { name: "Tech Feed 2", url: "https://example.com/feed2.xml" },
    ],
    profile: {
      interests: ["TypeScript", "Cloudflare D1", "BGE-M3"],
      exclude_keywords: ["広告", "PR"],
      scoring_guidelines: "技術的深さと実用性を重視",
    },
  };

  const sampleRawArticles: fetcherModule.DatedArticle[] = [
    {
      id: "art-111111111111",
      title: "TypeScript 5.8 の最新機能解説",
      url: "https://example.com/articles/ts-58",
      source_name: "Tech Feed 1",
      snippet: "TypeScript 5.8の新機能と改善点について解説します。",
      published_at: "2026-08-19T00:00:00.000Z",
    },
    {
      id: "art-222222222222",
      title: "Cloudflare D1 と Hono によるエッジDB設計",
      url: "https://example.com/articles/d1-hono",
      source_name: "Tech Feed 2",
      snippet: "エッジ環境での軽量データベース配信パターンの検証。",
      published_at: "2026-08-19T01:00:00.000Z",
    },
    {
      id: "art-333333333333",
      title: "軽量ベクトル検索の実装アプローチ",
      url: "https://example.com/articles/vector-search",
      source_name: "Tech Feed 1",
      snippet: "BGE-M3 と D1 による高速ベクトル類似度検索。",
      published_at: "2026-08-19T02:00:00.000Z",
    },
  ];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-test-"));
    configFilePath = path.join(tempDir, "feeds.yaml");
    fs.writeFileSync(configFilePath, yaml.dump(mockConfig), "utf-8");

    process.env = {
      ...originalEnv,
      CLOUDFLARE_ACCOUNT_ID: "test-acc-id",
      CLOUDFLARE_D1_DATABASE_ID: "test-d1-db-id",
      CLOUDFLARE_API_TOKEN: "test-cf-token",
    };

    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("パイプライン全体の統合実行フロー (RSS取得 → スコアリング・ベクトル化 → D1同期 & ローカルDB保存)", () => {
    it("全ステップ（RSS取得 → BGE-M3ベクトル化 & スコアリング → D1同期 → ローカルDB保存）が一連で正常に実行されること", async () => {
      const outputDir = path.join(tempDir, "data");
      const localDbPath = path.join(outputDir, "local_articles.db");

      const d1SyncSpy = vi.spyOn(d1SyncModule, "syncArticlesToD1").mockResolvedValue({
        total: 3,
        inserted: 3,
      });

      const fetchSpy = vi
        .spyOn(fetcherModule, "fetchFeedArticles")
        .mockImplementation(async (source) => {
          if (source.name === "Tech Feed 1") {
            return [sampleRawArticles[0], sampleRawArticles[2]];
          }
          return [sampleRawArticles[1]];
        });

      const precomputeSpy = vi
        .spyOn(scorerModule, "precomputeInterestVectors")
        .mockResolvedValue(new Map());

      const scoreSpy = vi
        .spyOn(scorerModule, "scoreArticleWithProfile")
        .mockImplementation(async () => {
          return {
            score: 85,
            maxSimilarity: 0.85,
            articleVector: new Float32Array(1024).fill(0.05),
          };
        });

      const result = await runPipeline({
        dateStr: "2026-08-19",
        configPath: configFilePath,
        outputDir,
        localDbPath,
        skipD1Sync: false,
      });

      // 1. 返却結果の検証
      expect(result.date).toBe("2026-08-19");
      expect(result.totalFetched).toBe(3);
      expect(result.processedCount).toBe(3);
      expect(result.skippedCount).toBe(0);
      expect(result.articles.length).toBe(3);
      expect(result.articles[0].summary).toBe(sampleRawArticles[0].snippet);
      expect(result.articles[0].score).toBe(85);
      expect(result.articles[0].published_date_jst).toBe("2026-08-19");
      expect(result.articles[0].embedding).toBeInstanceOf(Float32Array);
      expect(result.articles[0].embedding?.length).toBe(1024);
      expect(result.d1SyncResult).toEqual({ total: 3, inserted: 3 });

      // 2. RSS 取得呼び出しの検証
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // 3. 関心ベクトル事前計算およびローカルスコアリング呼び出しの検証
      expect(precomputeSpy).toHaveBeenCalledTimes(1);
      expect(scoreSpy).toHaveBeenCalledTimes(3);

      // 4. D1 同期の検証
      expect(d1SyncSpy).toHaveBeenCalledTimes(1);
      expect(d1SyncSpy).toHaveBeenCalledWith({
        accountId: "test-acc-id",
        databaseId: "test-d1-db-id",
        apiToken: "test-cf-token",
        articles: expect.any(Array),
        customFetch: undefined,
      });

      // 5. ローカル SQLite DB への保存検証
      expect(fs.existsSync(localDbPath)).toBe(true);
      const verifyDb = initLocalDatabase(localDbPath);
      const rows = verifyDb.prepare("SELECT * FROM articles ORDER BY score DESC").all() as any[];
      expect(rows.length).toBe(3);
      expect(rows[0].id).toBeDefined();
      expect(rows[0].url).toBeDefined();
      expect(rows[0].published_date_jst).toBe("2026-08-19");
      expect(rows[0].embedding).toBeInstanceOf(Buffer);
      verifyDb.close();
    });

    it("skipD1Sync: true を指定した場合に D1 への同期が行われないこと", async () => {
      const outputDir = path.join(tempDir, "data");
      const d1SyncSpy = vi.spyOn(d1SyncModule, "syncArticlesToD1");

      vi.spyOn(fetcherModule, "fetchFeedArticles").mockImplementation(async (source) => {
        if (source.name === "Tech Feed 1") return [sampleRawArticles[0]];
        return [];
      });
      vi.spyOn(scorerModule, "precomputeInterestVectors").mockResolvedValue(new Map());
      vi.spyOn(scorerModule, "scoreArticleWithProfile").mockResolvedValue({
        score: 80,
        maxSimilarity: 0.8,
        articleVector: new Float32Array(1024).fill(0.1),
      });

      const result = await runPipeline({
        dateStr: "2026-08-19",
        configPath: configFilePath,
        outputDir,
        skipD1Sync: true,
      });

      expect(result.processedCount).toBe(1);
      expect(d1SyncSpy).not.toHaveBeenCalled();
      expect(result.d1SyncResult).toBeUndefined();
    });

    it("D1 認証情報が設定されていない場合に D1 同期をスキップして正常に完了すること", async () => {
      delete process.env.CLOUDFLARE_API_TOKEN;
      delete process.env.CLOUDFLARE_D1_DATABASE_ID;

      const outputDir = path.join(tempDir, "data");
      const d1SyncSpy = vi.spyOn(d1SyncModule, "syncArticlesToD1");

      vi.spyOn(fetcherModule, "fetchFeedArticles").mockImplementation(async (source) => {
        if (source.name === "Tech Feed 1") return [sampleRawArticles[0]];
        return [];
      });
      vi.spyOn(scorerModule, "precomputeInterestVectors").mockResolvedValue(new Map());
      vi.spyOn(scorerModule, "scoreArticleWithProfile").mockResolvedValue({
        score: 80,
        maxSimilarity: 0.8,
        articleVector: new Float32Array(1024).fill(0.1),
      });

      const result = await runPipeline({
        dateStr: "2026-08-19",
        configPath: configFilePath,
        outputDir,
      });

      expect(result.processedCount).toBe(1);
      expect(d1SyncSpy).not.toHaveBeenCalled();
      expect(result.d1SyncResult).toBeUndefined();
    });
  });

  describe("差分抽出と重複排除の検証", () => {
    it("同一フィードまたは別フィード間で URL / ID が重複している場合、重複が排除されて1度のみ処理されること", async () => {
      const outputDir = path.join(tempDir, "data");

      // 重複する記事
      vi.spyOn(fetcherModule, "fetchFeedArticles").mockImplementation(async (source) => {
        if (source.name === "Tech Feed 1") return [sampleRawArticles[0], sampleRawArticles[0]];
        return [sampleRawArticles[0]];
      });

      vi.spyOn(scorerModule, "precomputeInterestVectors").mockResolvedValue(new Map());
      const scoreSpy = vi.spyOn(scorerModule, "scoreArticleWithProfile").mockResolvedValue({
        score: 75,
        maxSimilarity: 0.75,
        articleVector: new Float32Array(1024).fill(0.1),
      });

      const result = await runPipeline({
        dateStr: "2026-08-19",
        configPath: configFilePath,
        outputDir,
        skipD1Sync: true,
      });

      expect(result.totalFetched).toBe(3);
      expect(result.skippedCount).toBe(2);
      expect(result.processedCount).toBe(1);
      expect(scoreSpy).toHaveBeenCalledTimes(1);
    });

    it("D1 に登録済みの URL を持つ記事が再スコアリング・再同期されずスキップされること", async () => {
      const outputDir = path.join(tempDir, "data");

      vi.spyOn(fetcherModule, "fetchFeedArticles").mockImplementation(async (source) =>
        source.name === "Tech Feed 1" ? [sampleRawArticles[0]] : [],
      );
      vi.spyOn(d1SyncModule, "fetchExistingUrlsFromD1").mockResolvedValue(
        new Set([sampleRawArticles[0].url]),
      );
      const scoreSpy = vi.spyOn(scorerModule, "scoreArticleWithProfile");
      const d1SyncSpy = vi.spyOn(d1SyncModule, "syncArticlesToD1");

      const result = await runPipeline({
        dateStr: "2026-08-19",
        configPath: configFilePath,
        outputDir,
        skipD1Sync: false,
      });

      expect(scoreSpy).not.toHaveBeenCalled();
      expect(d1SyncSpy).not.toHaveBeenCalled();
      expect(result.skippedCount).toBe(1);
      expect(result.processedCount).toBe(0);
    });

    it("D1 の既存 URL 照合期間が JST 基準の日付かつ maxAgeDays に1日の余裕を持たせた範囲であること", async () => {
      const outputDir = path.join(tempDir, "data");

      // JST では 2026-08-28、UTC では 2026-08-27 となる時刻に固定する
      vi.setSystemTime(new Date("2026-08-27T16:00:00.000Z"));

      vi.spyOn(fetcherModule, "fetchFeedArticles").mockResolvedValue([]);
      const existingUrlsSpy = vi
        .spyOn(d1SyncModule, "fetchExistingUrlsFromD1")
        .mockResolvedValue(new Set<string>());

      await runPipeline({
        configPath: configFilePath,
        outputDir,
        skipD1Sync: false,
        maxAgeDays: 3,
      });

      expect(existingUrlsSpy).toHaveBeenCalledTimes(1);
      // JST 2026-08-28 の 4 日前 (maxAgeDays 3 + 余裕 1 日) = 2026-08-24
      expect(existingUrlsSpy.mock.calls[0][0].sinceDateJst).toBe("2026-08-24");
    });

    it("巡回結果が0件の場合、スコアリング処理やDB更新を行わずに正常完了すること", async () => {
      const outputDir = path.join(tempDir, "data");

      vi.spyOn(fetcherModule, "fetchFeedArticles").mockResolvedValue([]);
      const precomputeSpy = vi.spyOn(scorerModule, "precomputeInterestVectors");
      const scoreSpy = vi.spyOn(scorerModule, "scoreArticleWithProfile");
      const d1SyncSpy = vi.spyOn(d1SyncModule, "syncArticlesToD1");

      const result = await runPipeline({
        dateStr: "2026-08-19",
        configPath: configFilePath,
        outputDir,
        skipD1Sync: false,
      });

      expect(result.totalFetched).toBe(0);
      expect(result.skippedCount).toBe(0);
      expect(result.processedCount).toBe(0);
      expect(result.articles).toEqual([]);

      expect(precomputeSpy).not.toHaveBeenCalled();
      expect(scoreSpy).not.toHaveBeenCalled();
      expect(d1SyncSpy).not.toHaveBeenCalled();
    });
  });

  describe("依存性注入 (DI) とカスタムオプションの検証", () => {
    it("カスタム DI インスタンス（extractorInstance, parser, customFetch）が各処理に正しく渡されること", async () => {
      const outputDir = path.join(tempDir, "data");
      const customExtractor = vi.fn().mockResolvedValue({ data: new Float32Array(1024).fill(0.3) });
      const customParser = { custom: "parser" };
      const customFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const d1SyncSpy = vi.spyOn(d1SyncModule, "syncArticlesToD1").mockResolvedValue({
        total: 1,
        inserted: 1,
      });

      const fetchSpy = vi
        .spyOn(fetcherModule, "fetchFeedArticles")
        .mockImplementation(async (source) => {
          if (source.name === "Tech Feed 1") return [sampleRawArticles[0]];
          return [];
        });
      const mockVectorMap = new Map<string, Float32Array>();
      const precomputeSpy = vi
        .spyOn(scorerModule, "precomputeInterestVectors")
        .mockResolvedValue(mockVectorMap);
      const scoreSpy = vi.spyOn(scorerModule, "scoreArticleWithProfile").mockResolvedValue({
        score: 88,
        maxSimilarity: 0.88,
        articleVector: new Float32Array(1024).fill(0.3),
      });

      const options: PipelineOptions = {
        dateStr: "2026-08-01",
        configPath: configFilePath,
        outputDir,
        skipD1Sync: false,
        extractorInstance: customExtractor,
        parser: customParser as any,
        customFetch: customFetch as any,
        accountId: "custom-acc",
        databaseId: "custom-db",
        apiToken: "custom-token",
      };

      const result = await runPipeline(options);

      expect(result.date).toBe("2026-08-01");
      expect(fetchSpy).toHaveBeenCalledWith(expect.any(Object), customParser, customFetch, 3);
      expect(precomputeSpy).toHaveBeenCalledWith(mockConfig.profile.interests, customExtractor);
      expect(scoreSpy).toHaveBeenCalledWith(
        sampleRawArticles[0].title,
        sampleRawArticles[0].snippet,
        mockConfig.profile,
        mockVectorMap,
        customExtractor,
      );
      expect(d1SyncSpy).toHaveBeenCalledWith({
        accountId: "custom-acc",
        databaseId: "custom-db",
        apiToken: "custom-token",
        articles: expect.any(Array),
        customFetch,
      });
    });
  });

  describe("エラーハンドリングの検証", () => {
    it("設定ファイルが存在しない場合に適切なエラーを投げること", async () => {
      const nonExistentConfig = path.join(tempDir, "missing-feeds.yaml");

      await expect(
        runPipeline({
          configPath: nonExistentConfig,
          outputDir: path.join(tempDir, "data"),
          skipD1Sync: true,
        }),
      ).rejects.toThrow();
    });
  });
});
