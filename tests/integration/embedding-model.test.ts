/**
 * 実モデル (Xenova/bge-m3) を実際に読み込んで検証する統合スモークテスト。
 *
 * 通常のユニットテスト (tests/pipeline/embedder.test.ts など) は
 * @huggingface/transformers を vi.mock で丸ごと差し替えているため、
 * ONNX Runtime がモデルを読み込めなくなる種類の障害を検知できない。
 * 実際に onnxruntime-node の更新でセッション初期化が落ち、記事収集
 * パイプラインが停止する障害が発生したため、実モデルを読み込む経路を
 * ここで担保する。
 *
 * モデルのダウンロード (fp16 で約 1.1GB) を伴うため、既定の `pnpm test`
 * からは除外し `pnpm test:integration` でのみ実行する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getExtractor, generateArticleEmbedding, l2Normalize } from "../../src/pipeline/embedder";
import {
  precomputeInterestVectors,
  scoreArticleWithProfile,
  cosineSimilarity,
} from "../../src/pipeline/scorer";
import { UserProfile } from "../../src/shared/types";

const EMBEDDING_DIMENSIONS = 1024;

const profile: UserProfile = {
  interests: ["TypeScript の型システム", "Cloudflare Workers とエッジコンピューティング"],
  exclude_keywords: ["広告"],
  scoring_guidelines: "技術的深さと実用性を重視",
};

const relevantArticle = {
  title: "Cloudflare Workers と D1 で作るエッジ API の設計",
  snippet:
    "Workers 上の Hono と D1 を組み合わせたエッジ API の構成とパフォーマンス特性を解説する。",
};

const irrelevantArticle = {
  title: "初心者でも失敗しない肉じゃがの作り方",
  snippet: "じゃがいもと玉ねぎの下ごしらえから煮込みの火加減まで、家庭料理の基本を紹介する。",
};

describe("実モデル (Xenova/bge-m3) を用いた埋め込み生成の統合スモークテスト", () => {
  let extractor: any;

  beforeAll(async () => {
    extractor = await getExtractor();
  });

  describe("モデルの読み込み", () => {
    it("feature-extraction pipeline が実際に初期化できること（ONNX Runtime のセッション初期化を含む）", () => {
      expect(extractor).toBeDefined();
      expect(typeof extractor).toBe("function");
    });
  });

  describe("記事ベクトルの生成", () => {
    it("実モデルから 1024 次元の Float32Array が生成されること", async () => {
      const embedding = await generateArticleEmbedding(
        relevantArticle.title,
        relevantArticle.snippet,
      );

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(EMBEDDING_DIMENSIONS);
    });

    it("生成されたベクトルに NaN や Infinity が含まれないこと", async () => {
      const embedding = await generateArticleEmbedding(
        relevantArticle.title,
        relevantArticle.snippet,
      );

      for (let i = 0; i < embedding.length; i++) {
        expect(Number.isFinite(embedding[i])).toBe(true);
      }
    });

    it("生成されたベクトルが L2 正規化済み（ノルムがほぼ 1.0）であること", async () => {
      const embedding = await generateArticleEmbedding(
        relevantArticle.title,
        relevantArticle.snippet,
      );

      let sumSquares = 0;
      for (let i = 0; i < embedding.length; i++) {
        sumSquares += embedding[i] * embedding[i];
      }
      expect(Math.sqrt(sumSquares)).toBeCloseTo(1.0, 3);
    });

    it("全要素が同一値になる縮退したベクトルが返らないこと", async () => {
      const embedding = await generateArticleEmbedding(
        relevantArticle.title,
        relevantArticle.snippet,
      );

      const distinctValues = new Set(Array.from(embedding));
      expect(distinctValues.size).toBeGreaterThan(1);
    });

    it("異なる記事からは異なるベクトルが生成されること", async () => {
      const a = await generateArticleEmbedding(relevantArticle.title, relevantArticle.snippet);
      const b = await generateArticleEmbedding(irrelevantArticle.title, irrelevantArticle.snippet);

      expect(cosineSimilarity(a, b)).toBeLessThan(0.99);
    });
  });

  describe("関心プロファイルとの類似度およびスコアリング", () => {
    it("query: プレフィックス付きの関心ベクトルが関心の数だけ生成されること", async () => {
      const vectors = await precomputeInterestVectors(profile.interests);

      expect(vectors.size).toBe(profile.interests.length);
      for (const [, vector] of vectors) {
        expect(vector).toBeInstanceOf(Float32Array);
        expect(vector.length).toBe(EMBEDDING_DIMENSIONS);
      }
    });

    it("関心に合致する記事の方が無関係な記事より高い類似度を示すこと", async () => {
      const interestVectors = await precomputeInterestVectors(profile.interests);
      const targetVector = interestVectors.get(profile.interests[1])!;

      const relevantVector = l2Normalize(
        await generateArticleEmbedding(relevantArticle.title, relevantArticle.snippet),
      );
      const irrelevantVector = l2Normalize(
        await generateArticleEmbedding(irrelevantArticle.title, irrelevantArticle.snippet),
      );

      const relevantSimilarity = cosineSimilarity(relevantVector, targetVector);
      const irrelevantSimilarity = cosineSimilarity(irrelevantVector, targetVector);

      expect(relevantSimilarity).toBeGreaterThan(irrelevantSimilarity + 0.05);
    });

    it("関心に合致する記事の方が無関係な記事より高いスコアになること", async () => {
      const interestVectors = await precomputeInterestVectors(profile.interests);

      const relevantResult = await scoreArticleWithProfile(
        relevantArticle.title,
        relevantArticle.snippet,
        profile,
        interestVectors,
      );
      const irrelevantResult = await scoreArticleWithProfile(
        irrelevantArticle.title,
        irrelevantArticle.snippet,
        profile,
        interestVectors,
      );

      expect(relevantResult.score).toBeGreaterThan(irrelevantResult.score);
      expect(relevantResult.score).toBeGreaterThanOrEqual(0);
      expect(relevantResult.score).toBeLessThanOrEqual(100);
      expect(relevantResult.articleVector.length).toBe(EMBEDDING_DIMENSIONS);
    });
  });
});
