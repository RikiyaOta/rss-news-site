/**
 * 日本標準時 (JST) の日付計算。
 *
 * 本アプリの「日付」はすべて JST 基準であり、UTC 15:00 を境に日付が変わる。
 * この境界の実装がフロントエンド・Worker・パイプラインで食い違うと、
 * 同じ記事が別の日に見えるという分かりにくい不具合になるため、
 * 日付に関する計算はすべてこのモジュールへ集約する。
 */

/** JST は UTC+9 (夏時間なし) */
export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** YYYY-MM-DD 形式の日付文字列 */
export type DateString = string;

const DATE_STRING_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Date の UTC 各要素から YYYY-MM-DD を組み立てる */
function formatUtcParts(date: Date): DateString {
  const yyyy = String(date.getUTCFullYear()).padStart(4, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * ある瞬間 (Date) を JST の日付文字列に変換する。
 *
 * UTC 14:59:59 は JST 23:59:59 で同日、UTC 15:00:00 は JST 翌日 00:00:00 となる。
 */
export function toJstDateString(instant: Date): DateString {
  if (Number.isNaN(instant.getTime())) {
    throw new Error(`Invalid date: ${instant}`);
  }
  return formatUtcParts(new Date(instant.getTime() + JST_OFFSET_MS));
}

/**
 * UTC ISO8601 日時文字列から JST の日付文字列を算出する。
 *
 * 記事の `published_at` から `published_date_jst` を導出する唯一の経路。
 */
export function computePublishedDateJst(publishedAtIso: string): DateString {
  const date = new Date(publishedAtIso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date string: ${publishedAtIso}`);
  }
  return toJstDateString(date);
}

/**
 * 現在時刻の JST 日付文字列を返す。
 *
 * テストから固定時刻を渡せるよう `now` を引数に取る。
 */
export function getTodayJstDateString(now: Date = new Date()): DateString {
  return toJstDateString(now);
}

/**
 * 日付文字列を指定日数ぶんずらす。
 *
 * ローカルタイムゾーンの影響を受けないよう UTC で計算する。
 */
export function adjustDateString(dateStr: DateString, offsetDays: number): DateString {
  if (!DATE_STRING_PATTERN.test(dateStr)) {
    throw new Error(`Invalid date string: ${dateStr}`);
  }
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  // 2026-02-31 のように書式は正しくても存在しない日付は、
  // Date.UTC が翌月へ繰り上げてしまうため往復で検出する
  if (formatUtcParts(date) !== dateStr) {
    throw new Error(`Invalid date string: ${dateStr}`);
  }
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return formatUtcParts(date);
}
