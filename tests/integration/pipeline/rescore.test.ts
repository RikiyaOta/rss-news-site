import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as yaml from "js-yaml";
import { runRescore, parseRescoreArgs } from "../../../src/pipeline/rescore";
import * as d1SyncModule from "../../../src/pipeline/d1-sync";
import * as scorerModule from "../../../src/pipeline/scorer";

describe("既存記事の再スコアリング (src/pipeline/rescore) のテスト", () => {
  let tempDir: string;
  let configFilePath: string;
  const originalEnv = process.env;

  const mockConfig = {
    feeds: [{ name: "Tech Feed", url: "https://example.com/feed.xml" }],
    profile: {
      interests: ["TypeScript", "Cloudflare D1"],
      exclude_keywords: ["広告"],
    },
  };

  const existingArticles: d1SyncModule.RescoreSource[] = [
    { id: "aaa", title: "TypeScript 5.8 の型システム", summary: "型推論の強化", score: 12 },
    { id: "bbb", title: "Cloudflare D1 の設計", summary: "エッジ DB の構成", score: 30 },
    { id: "ccc", title: "肉じゃがの作り方", summary: "家庭料理の基本", score: 5 },
  ];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rescore-test-"));
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
  });

  function mockScorer(scores: number[]) {
    let call = 0;
    return vi.spyOn(scorerModule, "scoreArticleWithProfile").mockImplementation(async () => ({
      score: scores[call++] ?? 0,
      maxSimilarity: 0.7,
      matchedInterest: "TypeScript",
      excludedBy: null,
      articleVector: new Float32Array(1024).fill(0.05),
    }));
  }

  describe("再スコアリングの実行フロー", () => {
    it("D1 の全記事を再スコアリングし、新しい score とベクトルを書き戻すこと", async () => {
      vi.spyOn(d1SyncModule, "fetchAllArticlesForRescore").mockResolvedValue(existingArticles);
      vi.spyOn(scorerModule, "precomputeInterestVectors").mockResolvedValue(new Map());
      mockScorer([78, 65, 0]);

      const updateSpy = vi
        .spyOn(d1SyncModule, "updateArticleScores")
        .mockResolvedValue({ total: 3, updated: 3 });

      const result = await runRescore({ configPath: configFilePath });

      expect(result).toEqual({ total: 3, updated: 3, changed: 3 });

      const targets = updateSpy.mock.calls[0][0].targets;
      expect(targets).toHaveLength(3);
      expect(targets[0].id).toBe("aaa");
      expect(targets[0].score).toBe(78);
      expect(targets[0].embedding.length).toBe(1024);
    });

    it("記事本文として D1 の title と summary を渡すこと", async () => {
      vi.spyOn(d1SyncModule, "fetchAllArticlesForRescore").mockResolvedValue([existingArticles[0]]);
      vi.spyOn(scorerModule, "precomputeInterestVectors").mockResolvedValue(new Map());
      const scoreSpy = mockScorer([78]);
      vi.spyOn(d1SyncModule, "updateArticleScores").mockResolvedValue({ total: 1, updated: 1 });

      await runRescore({ configPath: configFilePath });

      expect(scoreSpy.mock.calls[0][0]).toBe("TypeScript 5.8 の型システム");
      expect(scoreSpy.mock.calls[0][1]).toBe("型推論の強化");
    });

    it("summary が null の記事でも空文字として処理できること", async () => {
      vi.spyOn(d1SyncModule, "fetchAllArticlesForRescore").mockResolvedValue([
        { id: "aaa", title: "タイトルのみの記事", summary: null, score: 0 },
      ]);
      vi.spyOn(scorerModule, "precomputeInterestVectors").mockResolvedValue(new Map());
      const scoreSpy = mockScorer([40]);
      vi.spyOn(d1SyncModule, "updateArticleScores").mockResolvedValue({ total: 1, updated: 1 });

      const result = await runRescore({ configPath: configFilePath });

      expect(scoreSpy.mock.calls[0][1]).toBe("");
      expect(result.updated).toBe(1);
    });

    /**
     * スコアが変わらなかった件数を区別できないと、
     * 再スコアリングが効いたのかどうかを実行ログから判断できない。
     */
    it.each([
      [[12, 30, 5], 0, "全件が据え置きなら変化 0 件"],
      [[78, 30, 5], 1, "1 件だけ変わったら変化 1 件"],
      [[78, 65, 0], 3, "全件変わったら変化 3 件"],
    ])("新スコアが %s のとき変化件数が %s になること (%s)", async (newScores, expectedChanged) => {
      vi.spyOn(d1SyncModule, "fetchAllArticlesForRescore").mockResolvedValue(existingArticles);
      vi.spyOn(scorerModule, "precomputeInterestVectors").mockResolvedValue(new Map());
      mockScorer(newScores);
      vi.spyOn(d1SyncModule, "updateArticleScores").mockResolvedValue({ total: 3, updated: 3 });

      const result = await runRescore({ configPath: configFilePath });

      expect(result.changed).toBe(expectedChanged);
    });

    it("記事が 1 件も無い場合はスコアリングも更新も行わずに完了すること", async () => {
      vi.spyOn(d1SyncModule, "fetchAllArticlesForRescore").mockResolvedValue([]);
      const precomputeSpy = vi.spyOn(scorerModule, "precomputeInterestVectors");
      const updateSpy = vi.spyOn(d1SyncModule, "updateArticleScores");

      const result = await runRescore({ configPath: configFilePath });

      expect(result).toEqual({ total: 0, updated: 0, changed: 0 });
      expect(precomputeSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it("limit を指定した場合に先頭 N 件だけを処理すること", async () => {
      vi.spyOn(d1SyncModule, "fetchAllArticlesForRescore").mockResolvedValue(existingArticles);
      vi.spyOn(scorerModule, "precomputeInterestVectors").mockResolvedValue(new Map());
      const scoreSpy = mockScorer([78, 65, 0]);
      vi.spyOn(d1SyncModule, "updateArticleScores").mockResolvedValue({ total: 2, updated: 2 });

      const result = await runRescore({ configPath: configFilePath, limit: 2 });

      expect(scoreSpy).toHaveBeenCalledTimes(2);
      expect(result.total).toBe(2);
    });

    it("D1 更新エラーを結果に含めること", async () => {
      vi.spyOn(d1SyncModule, "fetchAllArticlesForRescore").mockResolvedValue([existingArticles[0]]);
      vi.spyOn(scorerModule, "precomputeInterestVectors").mockResolvedValue(new Map());
      mockScorer([78]);
      vi.spyOn(d1SyncModule, "updateArticleScores").mockResolvedValue({
        total: 1,
        updated: 0,
        errors: [{ message: "D1 error" }],
      });

      const result = await runRescore({ configPath: configFilePath });

      expect(result.updated).toBe(0);
      expect(result.errors).toEqual([{ message: "D1 error" }]);
    });

    it("認証情報が設定されていない場合に例外を投げること", async () => {
      delete process.env.CLOUDFLARE_API_TOKEN;

      await expect(runRescore({ configPath: configFilePath })).rejects.toThrow(
        "Cloudflare D1 設定エラー",
      );
    });
  });

  describe("dry-run", () => {
    /**
     * 本番 D1 を書き換える操作なので、事前に変化を確認する経路を必ず残す。
     */
    it("--dry-run では D1 を更新せず、変化件数だけを返すこと", async () => {
      vi.spyOn(d1SyncModule, "fetchAllArticlesForRescore").mockResolvedValue(existingArticles);
      vi.spyOn(scorerModule, "precomputeInterestVectors").mockResolvedValue(new Map());
      mockScorer([78, 65, 0]);
      const updateSpy = vi.spyOn(d1SyncModule, "updateArticleScores");

      const result = await runRescore({ configPath: configFilePath, dryRun: true });

      expect(updateSpy).not.toHaveBeenCalled();
      expect(result).toEqual({ total: 3, updated: 0, changed: 3 });
    });
  });

  describe("parseRescoreArgs - CLI 引数の解釈", () => {
    it.each<[string[], { dryRun: boolean; limit?: number }, string]>([
      [[], { dryRun: false }, "引数なし"],
      [["--dry-run"], { dryRun: true }, "dry-run のみ"],
      [["--limit", "100"], { dryRun: false, limit: 100 }, "limit のみ"],
      [["--dry-run", "--limit", "50"], { dryRun: true, limit: 50 }, "両方"],
      [["--limit", "0"], { dryRun: false }, "limit 0 は無視する"],
      [["--limit", "abc"], { dryRun: false }, "数値でない limit は無視する"],
      [["--limit"], { dryRun: false }, "limit の値が無い場合は無視する"],
    ])("引数 %s を %s と解釈すること (%s)", (argv, expected) => {
      expect(parseRescoreArgs(argv)).toEqual(expected);
    });
  });
});
