import { describe, it, expect } from "vitest";
import {
  serializeVector,
  deserializeVector,
  cosineSimilarity,
} from "../../../src/server/db/articles";

describe("ベクトルのシリアライズと類似度計算 (src/server/db/articles)", () => {
  describe("serializeVector / deserializeVector", () => {
    it("1024 次元の Float32Array を 4096 バイトへ変換し完全復元できること", () => {
      const original = new Float32Array(1024);
      for (let i = 0; i < original.length; i++) {
        original[i] = Math.sin(i) * 0.5;
      }

      const bytes = serializeVector(original);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.byteLength).toBe(4096);

      const restored = deserializeVector(bytes);
      expect(restored).toEqual(original);
    });

    it.each([
      ["Float32Array", () => new Float32Array([1.5, -2.5, 3.5])],
      ["ArrayBuffer", () => new Float32Array([1.5, -2.5, 3.5]).buffer],
      ["Uint8Array", () => serializeVector(new Float32Array([1.5, -2.5, 3.5]))],
      [
        "number[] (D1 が BLOB を返す形式)",
        () => Array.from(serializeVector(new Float32Array([1.5, -2.5, 3.5]))),
      ],
    ])("%s から復元できること", (_label, build) => {
      const restored = deserializeVector(build() as any);
      expect(Array.from(restored)).toEqual([1.5, -2.5, 3.5]);
    });

    it("オフセット付きバッファでも元のベクトルのみを復元すること", () => {
      const backing = new ArrayBuffer(4 + 12);
      const view = new Float32Array(backing, 4, 3);
      view.set([1.5, -2.5, 3.5]);

      expect(Array.from(deserializeVector(view))).toEqual([1.5, -2.5, 3.5]);
    });

    it("対応していない型を渡した場合は例外を投げること", () => {
      expect(() => deserializeVector("not a blob" as any)).toThrow(/Invalid blob type/);
    });
  });

  describe("cosineSimilarity", () => {
    it.each([
      [[1, 0, 0], [1, 0, 0], 1.0, "同一ベクトル"],
      [[1, 0, 0], [0, 1, 0], 0.0, "直交"],
      [[1, 0, 0], [-1, 0, 0], -1.0, "逆向き"],
      [[1, 0, 0], [2, 0, 0], 1.0, "大きさが違っても向きが同じなら 1.0"],
      [[3, 4], [3, 4], 1.0, "正規化されていない同一ベクトル"],
      [[0, 0, 0], [1, 2, 3], 0.0, "ゼロベクトルは 0 (NaN にしない)"],
      [[0, 0, 0], [0, 0, 0], 0.0, "両方ゼロベクトル"],
    ])("%s と %s の類似度は %s になること (%s)", (a, b, expected) => {
      expect(cosineSimilarity(new Float32Array(a), new Float32Array(b))).toBeCloseTo(expected, 5);
    });

    it("次元が一致しない場合は例外を投げること", () => {
      expect(() => cosineSimilarity(new Float32Array([1, 2]), new Float32Array([1, 2, 3]))).toThrow(
        /Vector dimensions do not match/,
      );
    });
  });
});
