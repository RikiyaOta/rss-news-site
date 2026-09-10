/**
 * 記事スコア (0〜100点) の区分。
 *
 * スコアを付ける側 (`src/pipeline/scorer.ts`) と、色を塗る側 (記事カードの
 * バッジ) は同じ区分を指していなければならない。かつては両者が別々に閾値を
 * 持っており、scorer が 85/65/40 点で区分を切るのに対してカードは 80/60/40 点
 * で色を切り替えていたため、80〜84 点の記事が最上位の色で表示されていた。
 *
 * 区分の下端はここだけに置き、生成側・表示側の双方がこれを参照する。
 * 類似度そのものの閾値 (`SIMILARITY_BANDS`) は埋め込みモデルの実測分布に
 * 依存するため scorer 側に残す。ここが持つのは「点数の切り方」だけ。
 */

/** スコアの上限 */
export const MAX_SCORE = 100;

/** 各区分の下端 (点)。区分の識別子は類似度区分 (SIMILARITY_BANDS) と 1 対 1 で対応する */
export const SCORE_BAND_MIN = {
  /** 実測の上限を超える例外的な一致 */
  excellent: 85,
  /** 明確に関心テーマの記事 */
  high: 65,
  /** 関連はしているが主題ではない */
  medium: 40,
  /** 無関係な記事でも出る水準 */
  low: 0,
} as const;

export type ScoreBandId = keyof typeof SCORE_BAND_MIN;

export interface ScoreBand {
  id: ScoreBandId;
  /** この区分に入る最小スコア (点) */
  minScore: number;
  /** 記事カードのバッジに適用する配色 */
  badgeClassName: string;
}

/** スコアの高い区分から順に並べる。getScoreBand はこの順で最初に一致した区分を返す */
export const SCORE_BANDS: readonly ScoreBand[] = [
  {
    id: "excellent",
    minScore: SCORE_BAND_MIN.excellent,
    badgeClassName:
      "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
  {
    id: "high",
    minScore: SCORE_BAND_MIN.high,
    badgeClassName: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
  },
  {
    id: "medium",
    minScore: SCORE_BAND_MIN.medium,
    badgeClassName: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
  {
    id: "low",
    minScore: SCORE_BAND_MIN.low,
    badgeClassName: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30",
  },
];

/**
 * スコアが属する区分を返す。
 *
 * スコアは 0〜100 にクリップされて保存されるが、万一下端を下回る値が
 * 渡された場合も最下位区分へ落とす。
 */
export function getScoreBand(score: number): ScoreBand {
  return SCORE_BANDS.find((band) => score >= band.minScore) ?? SCORE_BANDS[SCORE_BANDS.length - 1];
}
