import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

/**
 * 実モデル (Xenova/bge-m3) を読み込む統合スモークテスト専用の設定。
 *
 * モデルのダウンロードと ONNX Runtime のセッション初期化に時間がかかるため、
 * 既定の vitest.config.ts からは tests/integration/** を除外し、
 * `pnpm test:integration` でのみ実行する。
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    fileParallelism: false,
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 900000,
    hookTimeout: 900000
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
});
