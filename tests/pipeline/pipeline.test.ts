import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import { runPipeline, PipelineOptions } from "../../src/pipeline/index";
import * as storageModule from "../../src/pipeline/storage";
import * as fetcherModule from "../../src/pipeline/fetcher";
import * as scorerModule from "../../src/pipeline/scorer";
import {
  initDailyDatabase,
  getArticlesByScore,
  getAllSearchVectors,
  insertArticles,
} from "../../src/pipeline/db";
import { Article } from "../../src/shared/types";

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
      interests: ["TypeScript", "SQLite", "Cloudflare"],
      exclude_keywords: ["広告", "PR"],
      scoring_guidelines: "技術的深さと実用性を重視",
    },
  };

  const sampleRawArticles: fetcherModule.RawArticle[] = [
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
      title: "Cloudflare R2 と SQLite によるエッジDB設計",
      url: "https://example.com/articles/r2-sqlite",
      source_name: "Tech Feed 2",
      snippet: "エッジ環境での軽量データベース配信パターンの検証。",
      published_at: "2026-08-19T01:00:00.000Z",
    },
    {
      id: "art-333333333333",
      title: "軽量ベクトル検索の実装アプローチ",
      url: "https://example.com/articles/vector-search",
      source_name: "Tech Feed 1",
      snippet: "Wasm と SQLite BLOB による高速ベクトル類似度検索。",
      published_at: "2026-08-19T02:00:00.000Z",
    },
  ];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-test-"));
    configFilePath = path.join(tempDir, "feeds.yaml");
    fs.writeFileSync(configFilePath, yaml.dump(mockConfig), "utf-8");

    process.env = {
      ...originalEnv,
      R2_ACCOUNT_ID: "test-acc-id",
      R2_ACCESS_KEY_ID: "test-access-key",
      R2_SECRET_ACCESS_KEY: "test-secret-key",
      R2_BUCKET_NAME: "test-bucket",
    };

    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  describe("パイプライン全体の統合実行フロー (Step 1 〜 Step 4)", () => {
    it("全ステップ（R2同期 → RSS取得 → ローカル埋め込みスコアリング & ベクトル化 → DB保存 → R2アップロード）が一連で正常に実行されること", async () => {
      const outputDir = path.join(tempDir, "data");

      // モック設定
      const downloadSpy = vi.spyOn(storageModule, "downloadFileFromR2").mockResolvedValue(true);
      const uploadSpy = vi.spyOn(storageModule, "uploadFileToR2").mockResolvedValue(undefined);

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
            articleVector: new Float32Array(384).fill(0.05),
          };
        });

      const result = await runPipeline({
        dateStr: "2026-08-19",
        configPath: configFilePath,
        outputDir,
        skipR2: false,
      });

      // 1. 返却結果の検証
      expect(result.date).toBe("2026-08-19");
      expect(result.totalFetched).toBe(3);
      expect(result.processedCount).toBe(3);
      expect(result.skippedCount).toBe(0);
      expect(result.articles.length).toBe(3);
      expect(result.articles[0].summary).toBe(sampleRawArticles[0].snippet);
      expect(result.articles[0].score).toBe(85);
      expect(result.dailyDbPath).toBe(path.join(outputDir, "2026-08-19.db"));
      expect(result.searchDbPath).toBe(path.join(outputDir, "search_index.db"));

      // 2. R2 ダウンロード呼び出しの検証 (Step 1)
      expect(downloadSpy).toHaveBeenCalledTimes(2);
      expect(downloadSpy).toHaveBeenCalledWith(
        "data/2026-08-19.db",
        path.join(outputDir, "2026-08-19.db"),
        undefined,
      );
      expect(downloadSpy).toHaveBeenCalledWith(
        "search_index.db",
        path.join(outputDir, "search_index.db"),
        undefined,
      );

      // 3. RSS 取得呼び出しの検証 (Step 2)
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // 4. 関心ベクトル事前計算およびローカルスコアリング呼び出しの検証 (Step 3)
      expect(precomputeSpy).toHaveBeenCalledTimes(1);
      expect(scoreSpy).toHaveBeenCalledTimes(3);

      // 5. DB の永続化検証 (Step 4)
      const dailyDb = initDailyDatabase(result.dailyDbPath);
      const savedArticles = getArticlesByScore(dailyDb);
      expect(savedArticles.length).toBe(3);
      expect(savedArticles.map((a) => a.id).sort()).toEqual(
        sampleRawArticles.map((a) => a.id).sort(),
      );
      dailyDb.close();

      const searchDb = initDailyDatabase(result.searchDbPath);
      const savedVectors = getAllSearchVectors(searchDb);
      expect(savedVectors.length).toBe(3);
      expect(savedVectors.every((v) => v.embedding.length === 384)).toBe(true);
      searchDb.close();

      // 6. R2 アップロード呼び出しの検証 (Step 4)
      expect(uploadSpy).toHaveBeenCalledTimes(2);
      expect(uploadSpy).toHaveBeenCalledWith(
        path.join(outputDir, "2026-08-19.db"),
        "data/2026-08-19.db",
        undefined,
      );
      expect(uploadSpy).toHaveBeenCalledWith(
        path.join(outputDir, "search_index.db"),
        "search_index.db",
        undefined,
      );
    });

    it("skipR2: true を指定した場合に R2 のダウンロードおよびアップロードが行われないこと", async () => {
      const outputDir = path.join(tempDir, "data");
      const downloadSpy = vi.spyOn(storageModule, "downloadFileFromR2");
      const uploadSpy = vi.spyOn(storageModule, "uploadFileToR2");

      vi.spyOn(fetcherModule, "fetchFeedArticles").mockImplementation(async (source) => {
        if (source.name === "Tech Feed 1") return [sampleRawArticles[0]];
        return [];
      });
      vi.spyOn(scorerModule, "precomputeInterestVectors").mockResolvedValue(new Map());
      vi.spyOn(scorerModule, "scoreArticleWithProfile").mockResolvedValue({
        score: 80,
        maxSimilarity: 0.8,
        articleVector: new Float32Array(384).fill(0.1),
      });

      const result = await runPipeline({
        dateStr: "2026-08-19",
        configPath: configFilePath,
        outputDir,
        skipR2: true,
      });

      expect(result.processedCount).toBe(1);
      expect(downloadSpy).not.toHaveBeenCalled();
      expect(uploadSpy).not.toHaveBeenCalled();
    });
  });

  describe("差分抽出と重複排除の検証", () => {
    it("既存DBに存在する記事IDはスキップされ、新規記事のみが処理されること", async () => {
      const outputDir = path.join(tempDir, "data");
      fs.mkdirSync(outputDir, { recursive: true });

      // 事前に日別DBを作成し、1件目の記事を保存しておく
      const preDailyDbPath = path.join(outputDir, "2026-08-19.db");
      const preDb = initDailyDatabase(preDailyDbPath);
      const existingArticle: Article = {
        id: sampleRawArticles[0].id,
        title: sampleRawArticles[0].title,
        url: sampleRawArticles[0].url,
        source_name: sampleRawArticles[0].source_name,
        summary: "既存の要約",
        score: 95,
        published_at: sampleRawArticles[0].published_at,
      };
      insertArticles(preDb, [existingArticle]);
      preDb.close();

      // RSSからは計3件取得される（Tech Feed 1から2件、Tech Feed 2から1件）
      vi.spyOn(fetcherModule, "fetchFeedArticles").mockImplementation(async (source) => {
        if (source.name === "Tech Feed 1") return [sampleRawArticles[0], sampleRawArticles[2]];
        return [sampleRawArticles[1]];
      });
      vi.spyOn(scorerModule, "precomputeInterestVectors").mockResolvedValue(new Map());
      const scoreSpy = vi.spyOn(scorerModule, "scoreArticleWithProfile").mockResolvedValue({
        score: 80,
        maxSimilarity: 0.8,
        articleVector: new Float32Array(384).fill(0.2),
      });

      const result = await runPipeline({
        dateStr: "2026-08-19",
        configPath: configFilePath,
        outputDir,
        skipR2: true,
      });

      expect(result.totalFetched).toBe(3);
      expect(result.skippedCount).toBe(1);
      expect(result.processedCount).toBe(2);
      expect(result.articles.length).toBe(2);
      expect(result.articles.map((a) => a.id)).toEqual([
        sampleRawArticles[2].id,
        sampleRawArticles[1].id,
      ]);

      // スコアリング処理は新規の2件に対してのみ呼ばれる
      expect(scoreSpy).toHaveBeenCalledTimes(2);

      // DBには既存1件＋新規2件の計3件が存在すること
      const verifyDb = initDailyDatabase(result.dailyDbPath);
      const allArticles = getArticlesByScore(verifyDb);
      expect(allArticles.length).toBe(3);
      verifyDb.close();
    });

    it("search_index.db (過去日) に既に存在する記事IDはスキップされ、スコアリングやベクトル化が実行されないこと", async () => {
      const outputDir = path.join(tempDir, "data");
      fs.mkdirSync(outputDir, { recursive: true });

      // 事前に search_index.db に前日 (2026-08-18) の記事1を保存しておく
      const preSearchDbPath = path.join(outputDir, "search_index.db");
      const preSearchDb = initDailyDatabase(preSearchDbPath);
      preSearchDb.exec(`
        CREATE TABLE IF NOT EXISTS search_index (
          article_id TEXT PRIMARY KEY,
          date TEXT NOT NULL,
          embedding BLOB NOT NULL
        );
      `);
      preSearchDb
        .prepare("INSERT INTO search_index VALUES (?, ?, ?)")
        .run(sampleRawArticles[0].id, "2026-08-18", Buffer.alloc(384 * 4));
      preSearchDb.close();

      // 当日の日別DBは空
      // RSSからは計2件取得される（前日にもあった記事0と新規記事1）
      vi.spyOn(fetcherModule, "fetchFeedArticles").mockImplementation(async (source) => {
        if (source.name === "Tech Feed 1") return [sampleRawArticles[0], sampleRawArticles[1]];
        return [];
      });
      vi.spyOn(scorerModule, "precomputeInterestVectors").mockResolvedValue(new Map());
      const scoreSpy = vi.spyOn(scorerModule, "scoreArticleWithProfile").mockResolvedValue({
        score: 85,
        maxSimilarity: 0.85,
        articleVector: new Float32Array(384).fill(0.1),
      });

      const result = await runPipeline({
        dateStr: "2026-08-19",
        configPath: configFilePath,
        outputDir,
        skipR2: true,
      });

      expect(result.totalFetched).toBe(2);
      expect(result.skippedCount).toBe(1);
      expect(result.processedCount).toBe(1);
      expect(result.articles.length).toBe(1);
      expect(result.articles[0].id).toBe(sampleRawArticles[1].id);

      // スコアリング処理は過去に存在しない新規の1件に対してのみ実行される
      expect(scoreSpy).toHaveBeenCalledTimes(1);
    });

    it("フィード内で同一記事IDが重複している場合、重複が排除されて1度のみ処理されること", async () => {
      const outputDir = path.join(tempDir, "data");

      vi.spyOn(fetcherModule, "fetchFeedArticles").mockImplementation(async (source) => {
        if (source.name === "Tech Feed 1") return [sampleRawArticles[0], sampleRawArticles[0]];
        return [];
      });

      vi.spyOn(scorerModule, "precomputeInterestVectors").mockResolvedValue(new Map());
      const scoreSpy = vi.spyOn(scorerModule, "scoreArticleWithProfile").mockResolvedValue({
        score: 75,
        maxSimilarity: 0.75,
        articleVector: new Float32Array(384).fill(0.1),
      });

      const result = await runPipeline({
        dateStr: "2026-08-19",
        configPath: configFilePath,
        outputDir,
        skipR2: true,
      });

      expect(result.totalFetched).toBe(2);
      expect(result.skippedCount).toBe(1);
      expect(result.processedCount).toBe(1);
      expect(scoreSpy).toHaveBeenCalledTimes(1);
    });

    it("すべての記事がスキップされた場合（差分0件）、スコアリング処理やDB更新を行わずに正常完了すること", async () => {
      const outputDir = path.join(tempDir, "data");
      fs.mkdirSync(outputDir, { recursive: true });

      // 事前に全記事をDBに保存
      const preDailyDbPath = path.join(outputDir, "2026-08-19.db");
      const preDb = initDailyDatabase(preDailyDbPath);
      const existingArticles: Article[] = sampleRawArticles.map((raw) => ({
        id: raw.id,
        title: raw.title,
        url: raw.url,
        source_name: raw.source_name,
        summary: raw.snippet,
        score: 80,
        published_at: raw.published_at,
      }));
      insertArticles(preDb, existingArticles);
      preDb.close();

      vi.spyOn(fetcherModule, "fetchFeedArticles").mockImplementation(async (source) => {
        if (source.name === "Tech Feed 1") return [sampleRawArticles[0], sampleRawArticles[2]];
        return [sampleRawArticles[1]];
      });
      const precomputeSpy = vi.spyOn(scorerModule, "precomputeInterestVectors");
      const scoreSpy = vi.spyOn(scorerModule, "scoreArticleWithProfile");
      const uploadSpy = vi.spyOn(storageModule, "uploadFileToR2").mockResolvedValue(undefined);

      const result = await runPipeline({
        dateStr: "2026-08-19",
        configPath: configFilePath,
        outputDir,
        skipR2: false,
      });

      expect(result.totalFetched).toBe(3);
      expect(result.skippedCount).toBe(3);
      expect(result.processedCount).toBe(0);
      expect(result.articles).toEqual([]);

      expect(precomputeSpy).not.toHaveBeenCalled();
      expect(scoreSpy).not.toHaveBeenCalled();
      // 差分がなくてもR2同期は行われる
      expect(uploadSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("依存性注入 (DI) とカスタムオプションの検証", () => {
    it("カスタム DI インスタンス（extractorInstance, s3Client, parser）が各処理に正しく渡されること", async () => {
      const outputDir = path.join(tempDir, "data");
      const customExtractor = vi.fn().mockResolvedValue({ data: new Float32Array(384).fill(0.3) });
      const customS3Client = { custom: "s3-client" };
      const customParser = { custom: "parser" };

      const downloadSpy = vi.spyOn(storageModule, "downloadFileFromR2").mockResolvedValue(true);
      const uploadSpy = vi.spyOn(storageModule, "uploadFileToR2").mockResolvedValue(undefined);
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
        articleVector: new Float32Array(384).fill(0.3),
      });

      const options: PipelineOptions = {
        dateStr: "2026-08-01",
        configPath: configFilePath,
        outputDir,
        skipR2: false,
        extractorInstance: customExtractor,
        s3Client: customS3Client as any,
        parser: customParser as any,
      };

      const result = await runPipeline(options);

      expect(result.date).toBe("2026-08-01");
      expect(downloadSpy).toHaveBeenCalledWith(
        "data/2026-08-01.db",
        path.join(outputDir, "2026-08-01.db"),
        customS3Client,
      );
      expect(fetchSpy).toHaveBeenCalledWith(expect.any(Object), customParser);
      expect(precomputeSpy).toHaveBeenCalledWith(mockConfig.profile.interests, customExtractor);
      expect(scoreSpy).toHaveBeenCalledWith(
        sampleRawArticles[0].title,
        sampleRawArticles[0].snippet,
        mockConfig.profile,
        mockVectorMap,
        customExtractor,
      );
      expect(uploadSpy).toHaveBeenCalledWith(
        path.join(outputDir, "2026-08-01.db"),
        "data/2026-08-01.db",
        customS3Client,
      );
    });
  });

  describe("エラーハンドリングの検証", () => {
    it("設定ファイルが存在しない場合に適切なエラーを投げること", async () => {
      const nonExistentConfig = path.join(tempDir, "missing-feeds.yaml");

      await expect(
        runPipeline({
          configPath: nonExistentConfig,
          outputDir: path.join(tempDir, "data"),
          skipR2: true,
        }),
      ).rejects.toThrow();
    });

    it("R2からのダウンロードで予期しないエラーが発生した場合でもフォールバックして新規DBを作成すること", async () => {
      const outputDir = path.join(tempDir, "data");

      vi.spyOn(storageModule, "downloadFileFromR2").mockRejectedValue(
        new Error("R2 Connection Timeout"),
      );
      vi.spyOn(storageModule, "uploadFileToR2").mockResolvedValue(undefined);
      vi.spyOn(fetcherModule, "fetchFeedArticles").mockImplementation(async (source) => {
        if (source.name === "Tech Feed 1") return [sampleRawArticles[0]];
        return [];
      });
      vi.spyOn(scorerModule, "precomputeInterestVectors").mockResolvedValue(new Map());
      vi.spyOn(scorerModule, "scoreArticleWithProfile").mockResolvedValue({
        score: 85,
        maxSimilarity: 0.85,
        articleVector: new Float32Array(384).fill(0.1),
      });

      const result = await runPipeline({
        dateStr: "2026-08-19",
        configPath: configFilePath,
        outputDir,
        skipR2: false,
      });

      expect(result.processedCount).toBe(1);
      expect(fs.existsSync(result.dailyDbPath)).toBe(true);
      expect(fs.existsSync(result.searchDbPath)).toBe(true);
    });
  });
});
