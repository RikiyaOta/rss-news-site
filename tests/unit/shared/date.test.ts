import { describe, it, expect, vi, afterEach } from "vitest";
import {
  toJstDateString,
  computePublishedDateJst,
  getTodayJstDateString,
  adjustDateString,
} from "../../../src/shared/date";

/**
 * 本アプリの「日付」はすべて JST 基準で、UTC 15:00 が日付の境界になる。
 * ここが 1 秒ずれると記事が別の日に紛れるため、境界を表で網羅する。
 */
describe("JST 日付計算 (src/shared/date)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("computePublishedDateJst - UTC ISO8601 から JST 日付へ", () => {
    it.each([
      ["2026-08-19T00:00:00.000Z", "2026-08-19", "JST 09:00、同日"],
      ["2026-08-19T14:59:59.999Z", "2026-08-19", "JST 23:59:59.999、日付境界の直前"],
      ["2026-08-19T15:00:00.000Z", "2026-08-20", "JST 翌日 00:00:00、日付境界ちょうど"],
      ["2026-08-19T15:00:00.001Z", "2026-08-20", "日付境界の直後"],
      ["2025-12-31T14:59:59.999Z", "2025-12-31", "年内最後"],
      ["2025-12-31T15:00:00.000Z", "2026-01-01", "年跨ぎ"],
      ["2024-02-28T15:00:00.000Z", "2024-02-29", "うるう年の 2/29 へ繰り上がる"],
      ["2026-02-28T15:00:00.000Z", "2026-03-01", "平年は 3/1 へ繰り上がる"],
      ["2026-08-31T15:00:00.000Z", "2026-09-01", "月跨ぎ"],
    ])("%s は JST %s になること (%s)", (iso, expected) => {
      expect(computePublishedDateJst(iso)).toBe(expected);
    });

    it.each([["not-a-date"], [""], ["2026-13-45T00:00:00.000Z"]])(
      "パースできない日時 %s は例外を投げること",
      (invalid) => {
        expect(() => computePublishedDateJst(invalid)).toThrow(/Invalid date string/);
      },
    );
  });

  describe("toJstDateString", () => {
    it("Date インスタンスから JST 日付を求められること", () => {
      expect(toJstDateString(new Date("2026-08-19T15:00:00.000Z"))).toBe("2026-08-20");
    });

    it("Invalid Date は例外を投げること", () => {
      expect(() => toJstDateString(new Date("invalid"))).toThrow(/Invalid date/);
    });
  });

  describe("getTodayJstDateString - 「今日」の判定", () => {
    it.each([
      ["2026-08-19T14:59:59.999Z", "2026-08-19"],
      ["2026-08-19T15:00:00.000Z", "2026-08-20"],
      ["2025-12-31T15:00:00.000Z", "2026-01-01"],
    ])("システム時刻が %s のとき今日は %s であること", (now, expected) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(now));
      expect(getTodayJstDateString()).toBe(expected);
    });

    it("明示的に渡した時刻を優先すること", () => {
      expect(getTodayJstDateString(new Date("2026-08-19T15:00:00.000Z"))).toBe("2026-08-20");
    });
  });

  describe("adjustDateString - 日付文字列の加減算", () => {
    it.each([
      ["2026-08-19", -1, "2026-08-18", "前日"],
      ["2026-08-19", 1, "2026-08-20", "翌日"],
      ["2026-08-19", 0, "2026-08-19", "変化なし"],
      ["2026-09-01", -1, "2026-08-31", "月初から前月末へ"],
      ["2026-08-31", 1, "2026-09-01", "月末から翌月初へ"],
      ["2026-01-01", -1, "2025-12-31", "年初から前年末へ"],
      ["2025-12-31", 1, "2026-01-01", "年末から翌年初へ"],
      ["2024-02-28", 1, "2024-02-29", "うるう年の 2/29"],
      ["2024-03-01", -1, "2024-02-29", "うるう年を逆方向に跨ぐ"],
      ["2026-02-28", 1, "2026-03-01", "平年は 2/29 を飛ばす"],
      ["2026-08-19", -365, "2025-08-19", "1 年前"],
    ])("%s を %s 日ずらすと %s になること (%s)", (dateStr, offset, expected) => {
      expect(adjustDateString(dateStr, offset)).toBe(expected);
    });

    it.each([["2026-8-19"], ["20260819"], [""], ["not-a-date"], ["2026/08/19"]])(
      "形式が不正な %s は例外を投げること",
      (invalid) => {
        expect(() => adjustDateString(invalid, 1)).toThrow(/Invalid date string/);
      },
    );

    it.each([["2026-02-31"], ["2026-13-01"], ["2026-00-10"], ["2026-04-31"]])(
      "書式は正しくても存在しない日付 %s は例外を投げること",
      (invalid) => {
        expect(() => adjustDateString(invalid, 1)).toThrow(/Invalid date string/);
      },
    );

    it("ローカルタイムゾーンに依存せず同じ結果になること", () => {
      // UTC で計算しているため、実行環境の TZ が変わっても結果は不変
      expect(adjustDateString("2026-03-08", 1)).toBe("2026-03-09");
      expect(adjustDateString("2026-11-01", 1)).toBe("2026-11-02");
    });
  });
});
