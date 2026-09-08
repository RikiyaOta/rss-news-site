import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

/**
 * Worker 結合テスト専用の設定。
 *
 * 本番と同じ workerd ランタイム上で Hono アプリを起動し、
 * Miniflare が提供する実 D1 (ローカル SQLite) に対して実際の SQL を発行する。
 * スキーマは本番へ適用されるものと同一の migrations/ から読み込むため、
 * 「テストだけ別スキーマで緑になる」状態が構造的に起こらない。
 *
 * Cloudflare アカウントへは一切アクセスしないため、無料枠を消費しない。
 */
const migrations = await readD1Migrations(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations"),
);

export default defineConfig({
  plugins: [
    cloudflareTest({
      singleWorker: true,
      miniflare: {
        compatibilityDate: "2026-08-20",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        // setup.ts から applyD1Migrations へ渡すため、migrations をバインディング経由で届ける
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  test: {
    include: ["tests/integration/worker/**/*.test.ts"],
    setupFiles: ["./tests/integration/worker/setup.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
