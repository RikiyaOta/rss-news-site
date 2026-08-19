import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pipeline } from "@huggingface/transformers";
import {
  formatPassageText,
  l2Normalize,
  getExtractor,
  resetExtractor,
  setExtractor,
  generateArticleEmbedding,
} from "../../src/pipeline/embedder";

const mockDefaultExtractor = vi.fn().mockResolvedValue({
  data: new Float32Array(384).fill(0.01),
  dims: [1, 384],
});

vi.mock("@huggingface/transformers", () => {
  return {
    pipeline: vi.fn(),
  };
});

describe("多言語ベクトル埋め込み生成モジュール (src/pipeline/embedder) のテスト", () => {
  beforeEach(() => {
    resetExtractor();
    vi.clearAllMocks();
    (pipeline as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockDefaultExtractor);
  });

  afterEach(() => {
    resetExtractor();
  });

  describe("formatPassageText", () => {
    it("multilingual-e5-small の仕様に則り passage: プレフィックスを付与し、タイトルと要約を改行で結合すること", () => {
      const title = "TypeScript 5.8 の新機能解説";
      const summary = "・パフォーマンス改善\n・型推論の強化\n・新機能の追加";
      const formatted = formatPassageText(title, summary);

      expect(formatted).toBe(`passage: ${title}\n${summary}`);
    });

    it("タイトルや要約の前後に余分な空白や改行が含まれている場合に適切にトリムされること", () => {
      const title = "  \n  AIエージェントの自律稼働について   \t";
      const summary = " \n ・要約1 \n ・要約2 \n ・要約3   \n ";
      const formatted = formatPassageText(title, summary);

      expect(formatted).toBe(
        "passage: AIエージェントの自律稼働について\n・要約1 \n ・要約2 \n ・要約3",
      );
    });

    it("空文字列が渡された場合でも passage: プレフィックスと改行を維持すること", () => {
      const formatted = formatPassageText("", "");
      expect(formatted).toBe("passage: \n");
    });
  });

  describe("l2Normalize", () => {
    it("2次元ベクトルの L2 ノルムを 1.0 に正規化すること", () => {
      const input = [3, 4];
      const normalized = l2Normalize(input);

      expect(normalized).toBeInstanceOf(Float32Array);
      expect(normalized.length).toBe(2);
      expect(normalized[0]).toBeCloseTo(0.6, 5);
      expect(normalized[1]).toBeCloseTo(0.8, 5);

      // ノルムの二乗和の平方根が 1.0 になること
      const norm = Math.sqrt(normalized[0] * normalized[0] + normalized[1] * normalized[1]);
      expect(norm).toBeCloseTo(1.0, 5);
    });

    it("Float32Array 入力でも正しく正規化されること", () => {
      const input = new Float32Array([1, 2, 2]); // norm = sqrt(1 + 4 + 4) = 3
      const normalized = l2Normalize(input);

      expect(normalized).toBeInstanceOf(Float32Array);
      expect(normalized.length).toBe(3);
      expect(normalized[0]).toBeCloseTo(1 / 3, 5);
      expect(normalized[1]).toBeCloseTo(2 / 3, 5);
      expect(normalized[2]).toBeCloseTo(2 / 3, 5);
    });

    it("384次元のランダムベクトルを L2 ノルム 1.0 に正規化すること", () => {
      const randomVec = Array.from({ length: 384 }, () => Math.random() * 2 - 1);
      const normalized = l2Normalize(randomVec);

      expect(normalized.length).toBe(384);
      let sumSquares = 0;
      for (let i = 0; i < normalized.length; i++) {
        sumSquares += normalized[i] * normalized[i];
      }
      expect(Math.sqrt(sumSquares)).toBeCloseTo(1.0, 4);
    });

    it("ゼロベクトルが渡された場合に NaN にならずゼロベクトルを返すこと", () => {
      const input = [0, 0, 0];
      const normalized = l2Normalize(input);

      expect(normalized).toBeInstanceOf(Float32Array);
      expect(normalized.length).toBe(3);
      expect(normalized[0]).toBe(0);
      expect(normalized[1]).toBe(0);
      expect(normalized[2]).toBe(0);
      expect(Number.isNaN(normalized[0])).toBe(false);
    });

    it("1次元ベクトルの正規化が正しいこと", () => {
      const normalizedPos = l2Normalize([5]);
      expect(normalizedPos[0]).toBeCloseTo(1.0, 5);

      const normalizedNeg = l2Normalize([-7]);
      expect(normalizedNeg[0]).toBeCloseTo(-1.0, 5);
    });
  });

  describe("getExtractor (シングルトンおよび依存性注入)", () => {
    it("引数なしで呼び出した場合に @huggingface/transformers の pipeline を初期化すること", async () => {
      const extractor = await getExtractor();

      expect(pipeline).toHaveBeenCalledWith(
        "feature-extraction",
        "intfloat/multilingual-e5-small",
        { dtype: "fp32" },
      );
      expect(extractor).toBe(mockDefaultExtractor);
    });

    it("カスタムファクトリ関数（DI）を用いて feature-extraction pipeline が初期化されること", async () => {
      const mockPipelineInstance = vi.fn();
      const mockPipelineFactory = vi.fn().mockResolvedValue(mockPipelineInstance);

      const extractor = await getExtractor(mockPipelineFactory);

      expect(mockPipelineFactory).toHaveBeenCalledWith(
        "feature-extraction",
        "intfloat/multilingual-e5-small",
        { dtype: "fp32" },
      );
      expect(extractor).toBe(mockPipelineInstance);
    });

    it("初期化済みの extractor インスタンスをキャッシュし、2回目の呼び出しで同じインスタンスを返すこと", async () => {
      const mockPipelineInstance = vi.fn();
      const mockPipelineFactory = vi.fn().mockResolvedValue(mockPipelineInstance);

      const first = await getExtractor(mockPipelineFactory);
      const second = await getExtractor();

      expect(first).toBe(mockPipelineInstance);
      expect(second).toBe(mockPipelineInstance);
      // ファクトリは1回しか呼ばれない
      expect(mockPipelineFactory).toHaveBeenCalledTimes(1);
    });

    it("setExtractor により直接インスタンスを注入できること", async () => {
      const customExtractor = vi.fn();
      setExtractor(customExtractor);

      const extractor = await getExtractor();
      expect(extractor).toBe(customExtractor);
    });

    it("resetExtractor によりキャッシュがリセットされること", async () => {
      const mockPipelineInstance1 = vi.fn();
      const mockPipelineFactory1 = vi.fn().mockResolvedValue(mockPipelineInstance1);
      await getExtractor(mockPipelineFactory1);

      resetExtractor();

      const mockPipelineInstance2 = vi.fn();
      const mockPipelineFactory2 = vi.fn().mockResolvedValue(mockPipelineInstance2);
      const extractor2 = await getExtractor(mockPipelineFactory2);

      expect(extractor2).toBe(mockPipelineInstance2);
      expect(mockPipelineFactory2).toHaveBeenCalledTimes(1);
    });
  });

  describe("generateArticleEmbedding", () => {
    it("フォーマットされたテキストと pooling: mean, normalize: true オプションで extractor を呼び出すこと", async () => {
      const mockEmbeddingData = new Float32Array(384).fill(0.05);
      const mockExtractor = vi.fn().mockResolvedValue({
        data: mockEmbeddingData,
        dims: [1, 384],
      });

      const title = "テスト記事タイトル";
      const summary = "・要約内容1\n・要約内容2\n・要約内容3";

      const embedding = await generateArticleEmbedding(title, summary, mockExtractor);

      expect(mockExtractor).toHaveBeenCalledWith(`passage: ${title}\n${summary}`, {
        pooling: "mean",
        normalize: true,
      });
      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
      expect(embedding[0]).toBeCloseTo(0.05, 5);
    });

    it("extractor が生配列（number[]）を返した場合でも Float32Array に変換されること", async () => {
      const mockRawData = Array.from({ length: 384 }, (_, i) => i * 0.001);
      const mockExtractor = vi.fn().mockResolvedValue(mockRawData);

      const embedding = await generateArticleEmbedding("タイトル", "要約", mockExtractor);

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
      expect(embedding[10]).toBeCloseTo(0.01, 5);
    });

    it("extractorInstance が省略された場合に getExtractor から取得したインスタンスを使用すること", async () => {
      const embedding = await generateArticleEmbedding("タイトル", "要約");

      expect(pipeline).toHaveBeenCalledWith(
        "feature-extraction",
        "intfloat/multilingual-e5-small",
        { dtype: "fp32" },
      );
      expect(mockDefaultExtractor).toHaveBeenCalledWith("passage: タイトル\n要約", {
        pooling: "mean",
        normalize: true,
      });
      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
      expect(embedding[0]).toBeCloseTo(0.01, 5);
    });

    it("384次元の埋め込みベクトルが返却されることの検証", async () => {
      const dummy384 = new Float32Array(384);
      for (let i = 0; i < 384; i++) {
        dummy384[i] = Math.sin(i);
      }
      const mockExtractor = vi.fn().mockResolvedValue({ data: dummy384 });

      const result = await generateArticleEmbedding("記事タイトル", "記事要約", mockExtractor);

      expect(result.length).toBe(384);
      expect(result).toBeInstanceOf(Float32Array);
      expect(result[0]).toBe(dummy384[0]);
      expect(result[100]).toBe(dummy384[100]);
    });
  });
});
