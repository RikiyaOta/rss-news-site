import { defineConfig, configDefaults } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    fileParallelism: false,
    // 既定の実行対象は Node 上で完結する層。別ランタイムが要るものは別コマンドに分ける。
    //   - tests/integration/worker: workerd が必要なため pnpm test:worker (CI では毎 PR)
    //   - tests/integration/model:  実モデル (約1.1GB) を落とすため pnpm test:integration
    //   - tests/e2e:                Playwright + wrangler dev で pnpm test:e2e
    include: [
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.test.tsx",
      "tests/component/**/*.test.tsx",
      "tests/integration/pipeline/**/*.test.ts"
    ],
    exclude: [
      ...configDefaults.exclude,
      "tests/e2e/**",
      "tests/integration/worker/**",
      "tests/integration/model/**"
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json-summary"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/web/main.tsx",
        "src/vite-env.d.ts",
        // src/server/** は pnpm test:worker が workerd 上の実 D1 で検証する。
        // workerd からは V8 カバレッジを収集できず、ここに含めると
        // 「テストされていない」ように見えて数値が実態から乖離するため除外する。
        // 品質は Worker 結合テスト (tests/integration/worker) の通過で担保する。
        "src/server/**"
      ],
      // 数値そのものを目標にはしないが、下振れは検知する。
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 88,
        statements: 90,
        // 日付とスコアリングは壊れると記事の見え方が静かに変わるため厳しく見る
        "src/shared/date.ts": { lines: 100, branches: 100, functions: 100, statements: 100 },
        "src/pipeline/scorer.ts": { lines: 100, branches: 95, functions: 100, statements: 100 }
      }
    }
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
});
