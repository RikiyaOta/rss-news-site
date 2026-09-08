import { describe, it, expect } from "vitest";
import { extractEmbeddingVector } from "../../../src/server/index";

/**
 * Workers AI (@cf/baai/bge-m3) のレスポンス形状はモデルや
 * ランタイムのバージョンによって揺れる。ここが吸収しきれないと
 * セマンティック検索が全滅するため、想定形状を表で網羅する。
 */
describe("Workers AI レスポンスからのベクトル抽出 (extractEmbeddingVector)", () => {
  it.each([
    ["Float32Array そのもの", () => new Float32Array([1, 2, 3])],
    ["number[]", () => [1, 2, 3]],
    ["number[][] (バッチ形式)", () => [[1, 2, 3]]],
    ["Float32Array[] (バッチ形式)", () => [new Float32Array([1, 2, 3])]],
    ["{ data: Float32Array }", () => ({ data: new Float32Array([1, 2, 3]) })],
    ["{ data: number[] }", () => ({ data: [1, 2, 3] })],
    ["{ data: number[][] }", () => ({ data: [[1, 2, 3]] })],
    ["{ data: Float32Array[] }", () => ({ data: [new Float32Array([1, 2, 3])] })],
  ])("%s から [1, 2, 3] を取り出せること", (_label, build) => {
    const vec = extractEmbeddingVector(build());
    expect(vec).toBeInstanceOf(Float32Array);
    expect(Array.from(vec)).toEqual([1, 2, 3]);
  });

  it("1024 次元のバッチ応答でも次元が保たれること", () => {
    const source = Array.from({ length: 1024 }, (_, i) => i * 0.001);
    const vec = extractEmbeddingVector({ data: [source] });
    expect(vec.length).toBe(1024);
    expect(vec[512]).toBeCloseTo(0.512, 5);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["空オブジェクト", {}],
    ["想定外のキーのみ", { unexpected: true }],
    ["文字列", "embedding"],
    ["数値", 42],
    ["data が数値", { data: 42 }],
  ])("%s は例外を投げること", (_label, input) => {
    expect(() => extractEmbeddingVector(input)).toThrow(/Invalid AI embedding response format/);
  });
});
