import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as yaml from "js-yaml";
import { runPipeline, countUnsyncedArticles, PipelineOptions } from "../../../src/pipeline/index";
import * as d1SyncModule from "../../../src/pipeline/d1-sync";
import * as fetcherModule from "../../../src/pipeline/fetcher";
import * as scorerModule from "../../../src/pipeline/scorer";

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

  describe("パイプライン全体の統合実行フロー (RSS取得 → スコアリング・ベクトル化 → D1同期)", () => {
    it("全ステップ（RSS取得 → BGE-M3ベクトル化 & スコアリング → D1同期）が一連で正常に実行されること", async () => {
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
            matchedInterest: "TypeScript",
            excludedBy: null,
            articleVector: new Float32Array(1024).fill(0.05),
          };
        });

      const result = await runPipeline({
        dateStr: "2026-08-19",
        configPath: configFilePath,
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
    });

    it("skipD1Sync: true を指定した場合に D1 への同期が行われないこと", async () => {
      const d1SyncSpy = vi.spyOn(d1SyncModule, "syncArticlesToD1");

      vi.spyOn(fetcherModule, "fetchFeedArticles").mockImplementation(async (source) => {
        if (source.name === "Tech Feed 1") return [sampleRawArticles[0]];
        return [];
      });
      vi.spyOn(scorerModule, "precomputeInterestVectors").mockResolvedValue(new Map());
      vi.spyOn(scorerModule, "scoreArticleWithProfile").mockResolvedValue({
        score: 80,
        maxSimilarity: 0.8,
        matchedInterest: "TypeScript",
        excludedBy: null,
        articleVector: new Float32Array(1024).fill(0.1),
      });

      const result = await runPipeline({
        dateStr: "2026-08-19",
        configPath: configFilePath,
        skipD1Sync: true,
      });

      expect(result.processedCount).toBe(1);
      expect(d1SyncSpy).not.toHaveBeenCalled();
      expect(result.d1SyncResult).toBeUndefined();
    });

    it("D1 認証情報が設定されていない場合に D1 同期をスキップして正常に完了すること", async () => {
      delete process.env.CLOUDFLARE_API_TOKEN;
      delete process.env.CLOUDFLARE_D1_DATABASE_ID;

      const d1SyncSpy = vi.spyOn(d1SyncModule, "syncArticlesToD1");

      vi.spyOn(fetcherModule, "fetchFeedArticles").mockImplementation(async (source) => {
        if (source.name === "Tech Feed 1") return [sampleRawArticles[0]];
        return [];
      });
      vi.spyOn(scorerModule, "precomputeInterestVectors").mockResolvedValue(new Map());
      vi.spyOn(scorerModule, "scoreArticleWithProfile").mockResolvedValue({
        score: 80,
        maxSimilarity: 0.8,
        matchedInterest: "TypeScript",
        excludedBy: null,
        articleVector: new Float32Array(1024).fill(0.1),
      });

      const result = await runPipeline({
        dateStr: "2026-08-19",
        configPath: configFilePath,
      });

      expect(result.processedCount).toBe(1);
      expect(d1SyncSpy).not.toHaveBeenCalled();
      expect(result.d1SyncResult).toBeUndefined();
    });
  });

  describe("差分抽出と重複排除の検証", () => {
    it("同一フィードまたは別フィード間で URL / ID が重複している場合、重複が排除されて1度のみ処理されること", async () => {
      // 重複する記事
      vi.spyOn(fetcherModule, "fetchFeedArticles").mockImplementation(async (source) => {
        if (source.name === "Tech Feed 1") return [sampleRawArticles[0], sampleRawArticles[0]];
        return [sampleRawArticles[0]];
      });

      vi.spyOn(scorerModule, "precomputeInterestVectors").mockResolvedValue(new Map());
      const scoreSpy = vi.spyOn(scorerModule, "scoreArticleWithProfile").mockResolvedValue({
        score: 75,
        maxSimilarity: 0.75,
        matchedInterest: "TypeScript",
        excludedBy: null,
        articleVector: new Float32Array(1024).fill(0.1),
      });

      const result = await runPipeline({
        dateStr: "2026-08-19",
        configPath: configFilePath,
        skipD1Sync: true,
      });

      expect(result.totalFetched).toBe(3);
      expect(result.skippedCount).toBe(2);
      expect(result.processedCount).toBe(1);
      expect(scoreSpy).toHaveBeenCalledTimes(1);
    });

    it("D1 に登録済みの URL を持つ記事が再スコアリング・再同期されずスキップされること", async () => {
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
        skipD1Sync: false,
      });

      expect(scoreSpy).not.toHaveBeenCalled();
      expect(d1SyncSpy).not.toHaveBeenCalled();
      expect(result.skippedCount).toBe(1);
      expect(result.processedCount).toBe(0);
    });

    /**
     * 上のテストは fetchExistingUrlsFromD1 ごとモックしているため、
     * REST API のレスポンスをパースする部分を一度も通らない。
     * 実際には /raw を叩きながら /query の形でパースしていて URL が 1 件も集まらず、
     * 重複排除が長期間まるごと無効化されていた（毎回すべて再スコアリング・再同期していた）。
     * ここでは本物の fetchExistingUrlsFromD1 を、実際のレスポンス形式を返す fetch に対して通す。
     */
    it("実際の D1 レスポンス形式に対して重複排除が機能すること", async () => {
      vi.spyOn(fetcherModule, "fetchFeedArticles").mockImplementation(async (source) =>
        source.name === "Tech Feed 1" ? [sampleRawArticles[0], sampleRawArticles[1]] : [],
      );
      const scoreSpy = vi.spyOn(scorerModule, "scoreArticleWithProfile").mockResolvedValue({
        score: 80,
        maxSimilarity: 0.8,
        matchedInterest: "TypeScript",
        excludedBy: null,
        articleVector: new Float32Array(1024).fill(0.1),
      });
      vi.spyOn(scorerModule, "precomputeInterestVectors").mockResolvedValue(new Map());

      // 1 件目だけ D1 に登録済みという応答を返す
      const customFetch = vi.fn(async (url: any) => {
        if (String(url).endsWith("/query")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              result: [{ results: [{ url: sampleRawArticles[0].url }], success: true, meta: {} }],
              success: true,
            }),
          } as any;
        }
        // ensureD1Schema と syncArticlesToD1 (/raw)
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({ result: [], success: true }),
        } as any;
      });

      const result = await runPipeline({
        dateStr: "2026-08-19",
        configPath: configFilePath,
        skipD1Sync: false,
        customFetch: customFetch as any,
      });

      // 登録済みの 1 件はスコアリングも同期もされない
      expect(result.totalFetched).toBe(2);
      expect(result.skippedCount).toBe(1);
      expect(result.processedCount).toBe(1);
      expect(scoreSpy).toHaveBeenCalledTimes(1);
      expect(result.articles[0].url).toBe(sampleRawArticles[1].url);

      // 照会は /query エンドポイントに対して行われる
      const queryCall = customFetch.mock.calls.find((call) => String(call[0]).endsWith("/query"));
      expect(queryCall).toBeDefined();
    });

    it("既存 URL の照合に失敗した場合は警告を出したうえで全件処理へフォールバックすること", async () => {
      vi.spyOn(fetcherModule, "fetchFeedArticles").mockImplementation(async (source) =>
        source.name === "Tech Feed 1" ? [sampleRawArticles[0]] : [],
      );
      vi.spyOn(scorerModule, "scoreArticleWithProfile").mockResolvedValue({
        score: 80,
        maxSimilarity: 0.8,
        matchedInterest: "TypeScript",
        excludedBy: null,
        articleVector: new Float32Array(1024).fill(0.1),
      });
      vi.spyOn(scorerModule, "precomputeInterestVectors").mockResolvedValue(new Map());
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const customFetch = vi.fn(async (url: any) => {
        if (String(url).endsWith("/query")) {
          return { ok: false, status: 500, text: async () => "Internal Server Error" } as any;
        }
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({ result: [], success: true }),
        } as any;
      });

      const result = await runPipeline({
        dateStr: "2026-08-19",
        configPath: configFilePath,
        skipD1Sync: false,
        customFetch: customFetch as any,
      });

      // 処理は続行される
      expect(result.processedCount).toBe(1);
      // ただし黙って続けない
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("D1 の既存 URL 照合に失敗しました"),
      );
    });

    it("D1 の既存 URL 照合期間が JST 基準の日付かつ maxAgeDays に1日の余裕を持たせた範囲であること", async () => {
      // JST では 2026-08-28、UTC では 2026-08-27 となる時刻に固定する
      vi.setSystemTime(new Date("2026-08-27T16:00:00.000Z"));

      vi.spyOn(fetcherModule, "fetchFeedArticles").mockResolvedValue([]);
      const existingUrlsSpy = vi
        .spyOn(d1SyncModule, "fetchExistingUrlsFromD1")
        .mockResolvedValue(new Set<string>());

      await runPipeline({
        configPath: configFilePath,
        skipD1Sync: false,
        maxAgeDays: 3,
      });

      expect(existingUrlsSpy).toHaveBeenCalledTimes(1);
      // JST 2026-08-28 の 4 日前 (maxAgeDays 3 + 余裕 1 日) = 2026-08-24
      expect(existingUrlsSpy.mock.calls[0][0].sinceDateJst).toBe("2026-08-24");
    });

    it("巡回結果が0件の場合、スコアリング処理やDB更新を行わずに正常完了すること", async () => {
      vi.spyOn(fetcherModule, "fetchFeedArticles").mockResolvedValue([]);
      const precomputeSpy = vi.spyOn(scorerModule, "precomputeInterestVectors");
      const scoreSpy = vi.spyOn(scorerModule, "scoreArticleWithProfile");
      const d1SyncSpy = vi.spyOn(d1SyncModule, "syncArticlesToD1");

      const result = await runPipeline({
        dateStr: "2026-08-19",
        configPath: configFilePath,
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
        matchedInterest: "TypeScript",
        excludedBy: null,
        articleVector: new Float32Array(1024).fill(0.3),
      });

      const options: PipelineOptions = {
        dateStr: "2026-08-01",
        configPath: configFilePath,
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

  describe("D1 同期の失敗判定", () => {
    /** RSS 取得とスコアリングをスタブし、D1 同期の結果だけを差し替えて走らせる */
    async function runWithSyncResult(syncResult: {
      total: number;
      inserted: number;
      errors?: any[];
    }) {
      vi.spyOn(d1SyncModule, "ensureD1Schema").mockResolvedValue(undefined as any);
      vi.spyOn(d1SyncModule, "syncArticlesToD1").mockResolvedValue(syncResult);
      vi.spyOn(fetcherModule, "fetchFeedArticles").mockImplementation(async (source) => {
        if (source.name === "Tech Feed 1") return [sampleRawArticles[0], sampleRawArticles[2]];
        return [sampleRawArticles[1]];
      });
      vi.spyOn(scorerModule, "precomputeInterestVectors").mockResolvedValue(new Map());
      vi.spyOn(scorerModule, "scoreArticleWithProfile").mockResolvedValue({
        score: 85,
        maxSimilarity: 0.85,
        matchedInterest: "TypeScript",
        excludedBy: null,
        articleVector: new Float32Array(1024).fill(0.05),
      });

      return runPipeline({ dateStr: "2026-08-19", configPath: configFilePath });
    }

    /**
     * 全バッチ失敗でも終了コード 0 のまま緑で完了し、記事が D1 へ
     * 入っていないことに気づけなかった事故がある (rescore 側は同じ判定を
     * 持つが、本体には無かった)。未反映が 1 件でもあれば失敗として
     * 扱えることを表で固定する。
     */
    it.each([
      [3, 3, 0, "全件反映できたら未反映なし"],
      [3, 2, 1, "1 件だけ落ちたら未反映 1 件"],
      [3, 1, 2, "一部しか反映できなければ残りが未反映"],
      [3, 0, 3, "1 件も反映できなければ全件が未反映"],
      [1, 0, 1, "1 件だけの同期に失敗したら未反映 1 件"],
      [0, 0, 0, "同期対象が 0 件なら未反映なし"],
    ])(
      "対象 %s 件中 %s 件を同期したとき、未反映が %s 件と判定されること (%s)",
      (total, inserted, expected) => {
        const unsynced = countUnsyncedArticles({
          date: "2026-08-19",
          processedCount: total,
          skippedCount: 0,
          totalFetched: total,
          articles: [],
          d1SyncResult: { total, inserted },
        });

        expect(unsynced, `${total} 件中 ${inserted} 件同期`).toBe(expected);
      },
    );

    it("D1 同期を行わなかった場合は未反映なしと判定されること", () => {
      const unsynced = countUnsyncedArticles({
        date: "2026-08-19",
        processedCount: 3,
        skippedCount: 0,
        totalFetched: 3,
        articles: [],
      });

      expect(unsynced).toBe(0);
    });

    it("D1 へ 1 件も反映できなかったとき、正常完了として報告しないこと", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await runWithSyncResult({
        total: 3,
        inserted: 0,
        errors: [{ message: "params with multiple statements is not supported" }],
      });

      expect(countUnsyncedArticles(result)).toBe(3);
      expect(logSpy.mock.calls.flat().join("\n")).not.toContain("正常に完了");
      expect(errorSpy.mock.calls.flat().join("\n")).toContain("3 件");
    });

    it("全件を反映できたときは正常完了として報告すること", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const result = await runWithSyncResult({ total: 3, inserted: 3 });

      expect(countUnsyncedArticles(result)).toBe(0);
      expect(logSpy.mock.calls.flat().join("\n")).toContain("正常に完了");
    });

    it("同じ原因のエラーが全バッチ分並ばず、種別ごとに集計されて出力されること", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "log").mockImplementation(() => {});

      await runWithSyncResult({
        total: 3,
        inserted: 0,
        errors: [
          { message: "params with multiple statements is not supported" },
          { message: "params with multiple statements is not supported" },
          { message: "D1_ERROR: no such column" },
        ],
      });

      const output = errorSpy.mock.calls.flat().join("\n");
      expect(output).toContain("2 回: params with multiple statements is not supported");
      expect(output).toContain("1 回: D1_ERROR: no such column");
    });
  });

  describe("エラーハンドリングの検証", () => {
    it("設定ファイルが存在しない場合に適切なエラーを投げること", async () => {
      const nonExistentConfig = path.join(tempDir, "missing-feeds.yaml");

      await expect(
        runPipeline({
          configPath: nonExistentConfig,
          skipD1Sync: true,
        }),
      ).rejects.toThrow();
    });
  });
});
