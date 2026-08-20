import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cosineSimilarity,
  calculateScoreFromSimilarity,
  precomputeInterestVectors,
  scoreArticleWithProfile,
} from "../../src/pipeline/scorer";
import { UserProfile } from "../../src/shared/types";
import { resetExtractor } from "../../src/pipeline/embedder";

describe("ローカル多言語埋め込みスコアリングモジュール (src/pipeline/scorer)", () => {
  const mockProfile: UserProfile = {
    interests: ["TypeScript", "React", "Cloudflare", "AI Agents"],
    exclude_keywords: ["PR記事", "スポンサード", "セール"],
    scoring_guidelines: "",
  };

  beforeEach(() => {
    resetExtractor();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetExtractor();
  });

  describe("cosineSimilarity - コサイン類似度の計算", () => {
    it("2つのベクトルの内積（コサイン類似度）を正確に計算すること", () => {
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([1, 0, 0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);

      const c = new Float32Array([0, 1, 0]);
      expect(cosineSimilarity(a, c)).toBeCloseTo(0.0, 5);

      const d = new Float32Array([0.6, 0.8]);
      const e = new Float32Array([0.6, 0.8]);
      expect(cosineSimilarity(d, e)).toBeCloseTo(1.0, 5);
    });
  });

  describe("calculateScoreFromSimilarity - 類似度からスコアへのスケーリング", () => {
    it("類似度が 0.85 以上のとき、85〜100 点を返すこと", () => {
      expect(calculateScoreFromSimilarity(0.85, false)).toBe(85);
      expect(calculateScoreFromSimilarity(0.95, false)).toBeGreaterThanOrEqual(90);
      expect(calculateScoreFromSimilarity(1.0, false)).toBe(100);
    });

    it("類似度が 0.80〜0.84 のとき、65〜84 点を返すこと", () => {
      const score = calculateScoreFromSimilarity(0.82, false);
      expect(score).toBeGreaterThanOrEqual(65);
      expect(score).toBeLessThanOrEqual(84);
      expect(calculateScoreFromSimilarity(0.8, false)).toBe(65);
    });

    it("類似度が 0.73〜0.79 のとき、40〜64 点を返すこと", () => {
      const score = calculateScoreFromSimilarity(0.75, false);
      expect(score).toBeGreaterThanOrEqual(40);
      expect(score).toBeLessThanOrEqual(64);
      expect(calculateScoreFromSimilarity(0.73, false)).toBe(40);
    });

    it("類似度が 0.73 未満のとき、0〜39 点を返すこと", () => {
      const score = calculateScoreFromSimilarity(0.6, false);
      expect(score).toBeLessThanOrEqual(39);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(calculateScoreFromSimilarity(0.5, false)).toBe(0);
      expect(calculateScoreFromSimilarity(0.0, false)).toBe(0);
    });

    it("除外キーワードが含まれる場合、類似度が高くても 10 点以下に減点されること", () => {
      expect(calculateScoreFromSimilarity(0.95, true)).toBeLessThanOrEqual(10);
      expect(calculateScoreFromSimilarity(1.0, true)).toBe(10);
      expect(calculateScoreFromSimilarity(0.5, true)).toBe(5);
      expect(calculateScoreFromSimilarity(0.0, true)).toBe(0);
    });
  });

  describe("precomputeInterestVectors - 関心キーワードのベクトル事前計算", () => {
    it("ユーザー関心キーワード群の query ベクトルを事前計算し、Map に格納すること", async () => {
      const mockExtractor = vi.fn().mockImplementation(async () => {
        const raw = new Float32Array(1024).fill(0.1);
        return { data: raw };
      });

      const interests = ["TypeScript", "React"];
      const vectorMap = await precomputeInterestVectors(interests, mockExtractor);

      expect(mockExtractor).toHaveBeenCalledTimes(2);
      expect(mockExtractor).toHaveBeenCalledWith("query: TypeScript", {
        pooling: "mean",
        normalize: true,
      });
      expect(mockExtractor).toHaveBeenCalledWith("query: React", {
        pooling: "mean",
        normalize: true,
      });
      expect(vectorMap.size).toBe(2);
      expect(vectorMap.has("TypeScript")).toBe(true);
      expect(vectorMap.has("React")).toBe(true);
      expect(vectorMap.get("TypeScript")).toBeInstanceOf(Float32Array);
      expect(vectorMap.get("TypeScript")?.length).toBe(1024);
    });

    it("空文字や空白のみのキーワードはスキップすること", async () => {
      const mockExtractor = vi.fn().mockImplementation(async () => ({
        data: new Float32Array(1024).fill(0.1),
      }));

      const interests = ["TypeScript", "  ", "", "React"];
      const vectorMap = await precomputeInterestVectors(interests, mockExtractor);

      expect(mockExtractor).toHaveBeenCalledTimes(2);
      expect(vectorMap.size).toBe(2);
    });
  });

  describe("scoreArticleWithProfile - 記事スコアリングの統合動作", () => {
    it("関心トピックに合致する記事が高いスコアを獲得すること", async () => {
      const mockExtractor = vi.fn().mockImplementation(async (text: string) => {
        // TypeScript や React を含む場合は類似するベクトルを返すモック
        const isTs = text.includes("TypeScript") || text.includes("React");
        const vector = new Float32Array(1024).fill(isTs ? 0.5 : 0.01);
        return { data: vector };
      });

      const result = await scoreArticleWithProfile(
        "TypeScript 5.5 新機能まとめ",
        "React との親和性が向上しました",
        mockProfile,
        undefined,
        mockExtractor,
      );

      expect(mockExtractor).toHaveBeenCalledWith(
        "passage: TypeScript 5.5 新機能まとめ\nReact との親和性が向上しました",
        { pooling: "mean", normalize: true },
      );
      expect(result.score).toBeGreaterThanOrEqual(65);
      expect(result.maxSimilarity).toBeGreaterThan(0.8);
      expect(result.articleVector).toBeInstanceOf(Float32Array);
      expect(result.articleVector.length).toBe(1024);
    });

    it("除外キーワードが含まれる記事は低スコアになること", async () => {
      const mockExtractor = vi.fn().mockImplementation(async () => ({
        data: new Float32Array(1024).fill(0.5),
      }));

      const result = await scoreArticleWithProfile(
        "【PR記事】最新ツールの紹介",
        "スポンサードコンテンツです",
        mockProfile,
        undefined,
        mockExtractor,
      );

      expect(result.score).toBeLessThanOrEqual(10);
      expect(result.articleVector).toBeInstanceOf(Float32Array);
      expect(result.articleVector.length).toBe(1024);
    });

    it("事前計算済みの関心ベクトルマップを受け取った場合に extractor の再計算を回避すること", async () => {
      const precomputedMap = new Map<string, Float32Array>();
      const vec = new Float32Array(1024).fill(1 / Math.sqrt(1024));
      precomputedMap.set("TypeScript", vec);

      const mockExtractor = vi.fn().mockImplementation(async () => ({
        data: new Float32Array(1024).fill(1 / Math.sqrt(1024)),
      }));

      const result = await scoreArticleWithProfile(
        "TypeScript の入門",
        "型安全な JavaScript",
        mockProfile,
        precomputedMap,
        mockExtractor,
      );

      // extractor は記事ベクトルの生成の1回のみ呼び出されるはず
      expect(mockExtractor).toHaveBeenCalledTimes(1);
      expect(result.score).toBe(100);
      expect(result.maxSimilarity).toBeCloseTo(1.0, 4);
      expect(result.articleVector.length).toBe(1024);
    });
  });
});
