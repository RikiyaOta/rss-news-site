import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cosineSimilarity,
  calculateScoreFromSimilarity,
  precomputeInterestVectors,
  scoreArticleWithProfile,
} from "../../../src/pipeline/scorer";
import { UserProfile } from "../../../src/shared/types";
import {
  MAX_EMBEDDING_TEXT_CHARS,
  resetExtractor,
  setExtractor,
} from "../../../src/pipeline/embedder";

describe("ローカル多言語埋め込みスコアリングモジュール (src/pipeline/scorer)", () => {
  const mockProfile: UserProfile = {
    interests: ["TypeScript", "React", "Cloudflare", "AI Agents"],
    exclude_keywords: ["PR記事", "スポンサード", "セール"],
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
    /**
     * 実装は 4 つの区分に分かれる。区分をまたぐ境界で点数が飛んだり
     * 逆転したりしないことが重要なので、各区分の上端・下端と
     * その直前直後を表で網羅する。
     *
     * 区分の絶対値は bge-m3 が実際に出す類似度のレンジに合わせてある。
     * この値が実データとずれると全記事が同じ帯に潰れるため、
     * 変更するときは `pnpm calibrate` の分布を根拠にすること。
     */
    it.each([
      // 類似度,  期待スコア, 意図
      [1.0, 100, "上限"],
      [0.875, 93, "最上位区分の中央"],
      [0.75, 85, "最上位区分の下端"],
      [0.7499, 84, "最上位区分のすぐ下 (上位区分の上端)"],
      [0.74, 82, "上位区分の上端付近"],
      [0.65, 65, "上位区分の下端"],
      [0.6499, 64, "上位区分のすぐ下 (中位区分の上端)"],
      [0.64, 62, "中位区分の上端付近"],
      [0.55, 40, "中位区分の下端"],
      [0.5499, 39, "中位区分のすぐ下 (最下位区分の上端)"],
      [0.54, 36, "最下位区分の上端付近"],
      [0.485, 19, "最下位区分の中央"],
      [0.42, 0, "最下位区分の下端"],
      [0.4, 0, "下端より低い値は 0 でクリップ"],
      [0.0, 0, "ゼロ"],
      [-0.5, 0, "負の類似度も 0 でクリップ"],
    ])("類似度 %s のスコアが %s 点になること (%s)", (similarity, expected) => {
      expect(calculateScoreFromSimilarity(similarity, false)).toBe(expected);
    });

    /**
     * 修正前は 50 点を取るのに 0.76 以上の類似度が必要で、bge-m3 では
     * ほぼ到達不可能だったため公開サイトの記事が全件 50 点未満に張り付いていた。
     * 実運用で現実的に出る類似度が中盤の点数に写ることを固定する。
     */
    it.each([
      [0.45, "無関係な文どうしでも出る水準", 0, 15],
      [0.6, "関連はするが主題ではない水準", 40, 65],
      [0.7, "検索ヒット相当の水準", 65, 85],
      [0.8, "ほぼ言い換えに近い水準", 85, 100],
    ])(
      "類似度 %s (%s) のスコアが %s〜%s 点の帯に収まること",
      (similarity, _label, lower, upper) => {
        const score = calculateScoreFromSimilarity(similarity, false);

        expect(score).toBeGreaterThanOrEqual(lower);
        expect(score).toBeLessThanOrEqual(upper);
      },
    );

    it.each([
      [1.0, 10, "除外キーワードありの上限"],
      [0.95, 10, "高類似度でも 10 点で頭打ち"],
      [0.5, 5, "中間"],
      [0.04, 0, "四捨五入で 0 になる"],
      [0.0, 0, "ゼロ"],
      [-0.5, 0, "負の類似度も 0 でクリップ"],
    ])(
      "除外キーワードを含む場合、類似度 %s のスコアが %s 点になること (%s)",
      (similarity, expected) => {
        expect(calculateScoreFromSimilarity(similarity, true)).toBe(expected);
      },
    );

    it("スコアが類似度に対して単調非減少であること", () => {
      let previous = -1;
      for (let similarity = 0; similarity <= 1.0001; similarity += 0.01) {
        const score = calculateScoreFromSimilarity(Math.min(similarity, 1), false);
        expect(score).toBeGreaterThanOrEqual(previous);
        previous = score;
      }
    });

    it("常に 0〜100 の範囲に収まること", () => {
      for (let similarity = -1; similarity <= 2; similarity += 0.05) {
        for (const hasExclude of [true, false]) {
          const score = calculateScoreFromSimilarity(similarity, hasExclude);
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(100);
        }
      }
    });
  });

  describe("precomputeInterestVectors - 関心キーワードのベクトル事前計算", () => {
    /**
     * bge-m3 は指示プレフィックスを取らない。加えて "Rust" のような短い関心では
     * "query: " がトークン列の大半を占めてしまい、記事側との類似度を
     * 構造的に押し下げるため、プレフィックスは付けない。
     */
    it("ユーザー関心キーワードをそのままベクトル化し、Map に格納すること", async () => {
      const mockExtractor = vi.fn().mockImplementation(async () => {
        const raw = new Float32Array(1024).fill(0.1);
        return { data: raw };
      });

      const interests = ["TypeScript", "React"];
      const vectorMap = await precomputeInterestVectors(interests, mockExtractor);

      expect(mockExtractor).toHaveBeenCalledTimes(2);
      expect(mockExtractor).toHaveBeenCalledWith("TypeScript", {
        pooling: "cls",
        normalize: true,
      });
      expect(mockExtractor).toHaveBeenCalledWith("React", {
        pooling: "cls",
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

  describe("extractor 未指定時のフォールバック", () => {
    it("precomputeInterestVectors は extractor 省略時にシングルトンを利用すること", async () => {
      const singleton = vi.fn().mockResolvedValue({ data: new Float32Array(1024).fill(0.1) });
      setExtractor(singleton);

      const vectorMap = await precomputeInterestVectors(["TypeScript", "React"]);

      expect(singleton).toHaveBeenCalledTimes(2);
      expect(vectorMap.size).toBe(2);
    });

    it("scoreArticleWithProfile は extractor 省略時にシングルトンを利用すること", async () => {
      const singleton = vi.fn().mockResolvedValue({ data: new Float32Array(1024).fill(0.1) });
      setExtractor(singleton);

      const result = await scoreArticleWithProfile("タイトル", "要約", mockProfile);

      // 記事ベクトル 1 回 + 関心キーワード 4 個
      expect(singleton).toHaveBeenCalledTimes(1 + mockProfile.interests.length);
      expect(result.articleVector.length).toBe(1024);
    });
  });

  describe("extractor の戻り値形式の揺れ", () => {
    it.each([
      ["{ data: Float32Array } 形式", (v: Float32Array) => ({ data: v })],
      ["Float32Array を直接返す形式", (v: Float32Array) => v],
    ])("%s でもベクトルを取り出せること", async (_label, wrap) => {
      const vector = new Float32Array(1024).fill(1 / Math.sqrt(1024));
      const extractor = vi.fn().mockImplementation(async () => wrap(vector));

      const vectorMap = await precomputeInterestVectors(["TypeScript"], extractor);
      expect(vectorMap.get("TypeScript")?.length).toBe(1024);

      const result = await scoreArticleWithProfile(
        "タイトル",
        "要約",
        mockProfile,
        vectorMap,
        extractor,
      );
      expect(result.articleVector.length).toBe(1024);
      expect(result.maxSimilarity).toBeCloseTo(1.0, 4);
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
        "TypeScript 5.5 新機能まとめ\nReact との親和性が向上しました",
        { pooling: "cls", normalize: true },
      );
      expect(result.score).toBeGreaterThanOrEqual(65);
      expect(result.maxSimilarity).toBeGreaterThan(0.8);
      expect(result.articleVector).toBeInstanceOf(Float32Array);
      expect(result.articleVector.length).toBe(1024);
    });

    it("除外キーワードが含まれる記事は低スコアになり、該当キーワードを返すこと", async () => {
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
      expect(result.excludedBy).toBe("PR記事");
      expect(result.articleVector).toBeInstanceOf(Float32Array);
      expect(result.articleVector.length).toBe(1024);
    });

    /**
     * 除外キーワードは部分一致で効くため、意図せず点数を潰していないかを
     * ログから追えるよう、根拠となったキーワードと関心を必ず返す。
     */
    it("除外キーワードに該当しない場合は excludedBy が null になること", async () => {
      const mockExtractor = vi.fn().mockImplementation(async () => ({
        data: new Float32Array(1024).fill(0.5),
      }));

      const result = await scoreArticleWithProfile(
        "Rust の所有権システム詳解",
        "借用チェッカの内部実装を追う",
        mockProfile,
        undefined,
        mockExtractor,
      );

      expect(result.excludedBy).toBeNull();
    });

    /**
     * 本文全体を配信するフィードでは snippet が記事まるごとになる。
     * 照合対象を埋め込み入力と同じ範囲に制限しないと、本文の遠くに 1 度
     * 出ただけの語で記事が 10 点以下に潰れてしまう。
     */
    it("埋め込み入力の上限を超えた位置にある除外キーワードは無視すること", async () => {
      const mockExtractor = vi.fn().mockImplementation(async () => ({
        data: new Float32Array(1024).fill(0.5),
      }));

      const longBody = `${"あ".repeat(MAX_EMBEDDING_TEXT_CHARS)}スポンサード`;

      const result = await scoreArticleWithProfile(
        "Rust の所有権システム詳解",
        longBody,
        mockProfile,
        undefined,
        mockExtractor,
      );

      expect(result.excludedBy).toBeNull();
      expect(result.score).toBeGreaterThan(10);
    });

    it("埋め込み入力の範囲内にある除外キーワードは検出すること", async () => {
      const mockExtractor = vi.fn().mockImplementation(async () => ({
        data: new Float32Array(1024).fill(0.5),
      }));

      const result = await scoreArticleWithProfile(
        "Rust の所有権システム詳解",
        `スポンサード記事です。${"あ".repeat(100)}`,
        mockProfile,
        undefined,
        mockExtractor,
      );

      expect(result.excludedBy).toBe("スポンサード");
    });

    it("最も類似度が高かった関心キーワードを matchedInterest として返すこと", async () => {
      const cloudflareVector = new Float32Array(1024).fill(1 / Math.sqrt(1024));
      const otherVector = new Float32Array(1024);
      otherVector[0] = 1;

      const precomputedMap = new Map<string, Float32Array>([
        ["TypeScript", otherVector],
        ["Cloudflare", cloudflareVector],
      ]);

      const mockExtractor = vi.fn().mockResolvedValue({ data: cloudflareVector });

      const result = await scoreArticleWithProfile(
        "Cloudflare Workers でのエッジ配信",
        "D1 と組み合わせた構成",
        mockProfile,
        precomputedMap,
        mockExtractor,
      );

      expect(result.matchedInterest).toBe("Cloudflare");
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
