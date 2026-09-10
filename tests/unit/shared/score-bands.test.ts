import { describe, it, expect } from "vitest";
import { SCORE_BANDS, SCORE_BAND_MIN, getScoreBand } from "../../../src/shared/score-bands";
import { SIMILARITY_BANDS, calculateScoreFromSimilarity } from "../../../src/pipeline/scorer";

describe("スコア区分 (src/shared/score-bands)", () => {
  describe("getScoreBand - スコアから区分を引く", () => {
    /**
     * 区分の境目でだけ挙動が変わるため、各区分の上端・下端と
     * その直前直後を表で網羅する。この表がそのまま
     * 「何点から色が変わるか」の仕様になる。
     */
    it.each([
      // スコア, 期待する区分, 意図
      [100, "excellent", "上限"],
      [85, "excellent", "最上位区分の下端"],
      [84, "high", "最上位区分のすぐ下 (上位区分の上端)"],
      [65, "high", "上位区分の下端"],
      [64, "medium", "上位区分のすぐ下 (中位区分の上端)"],
      [40, "medium", "中位区分の下端"],
      [39, "low", "中位区分のすぐ下 (最下位区分の上端)"],
      [0, "low", "最下位区分の下端"],
      [-1, "low", "区分の下端を下回る値も最下位区分に落とす"],
    ])("スコア %s 点が %s 区分になること (%s)", (score, expectedId) => {
      expect(getScoreBand(score).id).toBe(expectedId);
    });

    it("すべての区分がバッジの配色を持つこと", () => {
      for (const band of SCORE_BANDS) {
        expect(band.badgeClassName.trim().length).toBeGreaterThan(0);
      }
    });

    it("区分がスコアの高い順に並んでいること", () => {
      const mins = SCORE_BANDS.map((band) => band.minScore);
      expect(mins).toEqual([...mins].sort((a, b) => b - a));
    });
  });

  /**
   * スコアを付ける側 (scorer) と、色を塗る側 (記事カード) が別々に閾値を
   * 持っていたため、80〜84 点の記事が最上位の色で表示される食い違いがあった。
   * 類似度の各区分の下端が、そのままスコア区分の下端になることを固定する。
   */
  describe("類似度区分との対応", () => {
    it.each([
      [SIMILARITY_BANDS.excellent, "excellent", SCORE_BAND_MIN.excellent],
      [SIMILARITY_BANDS.high, "high", SCORE_BAND_MIN.high],
      [SIMILARITY_BANDS.medium, "medium", SCORE_BAND_MIN.medium],
      [SIMILARITY_BANDS.floor, "low", SCORE_BAND_MIN.low],
    ])(
      "類似度 %s ちょうどのスコアが %s 区分の下端 (%s 点) になること",
      (similarity, expectedId, expectedMinScore) => {
        const score = calculateScoreFromSimilarity(similarity, false);

        expect(score).toBe(expectedMinScore);
        expect(getScoreBand(score).id).toBe(expectedId);
      },
    );

    it.each([
      [SIMILARITY_BANDS.excellent, "high"],
      [SIMILARITY_BANDS.high, "medium"],
      [SIMILARITY_BANDS.medium, "low"],
    ])("類似度 %s をわずかに下回ると %s 区分へ落ちること", (similarity, expectedId) => {
      const score = calculateScoreFromSimilarity(similarity - 0.0001, false);

      expect(getScoreBand(score).id).toBe(expectedId);
    });
  });
});
