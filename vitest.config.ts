import { defineConfig, configDefaults } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    fileParallelism: false,
    // tests/integration/** は実モデル (約1.1GB) のダウンロードを伴うため、
    // 既定のユニットテスト実行からは除外し pnpm test:integration で実行する。
    exclude: [...configDefaults.exclude, "tests/e2e/**", "tests/integration/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json-summary"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/web/main.tsx", "src/vite-env.d.ts"]
    }
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
});
