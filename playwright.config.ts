import { defineConfig, devices } from "@playwright/test";

/**
 * E2E は本番構成に対して実行する。
 *
 * - `wrangler dev` が本番と同じ workerd 上で Hono アプリを起動する
 * - D1 は Miniflare のローカル SQLite (本番と同じ migrations を適用済み)
 * - 画面は `pnpm build` の生成物を Workers の ASSETS バインディングが配信する
 * - API のモックは行わない (Workers AI のみ、ローカルで動かせないためスタブ)
 *
 * すべてローカルで完結するため、Cloudflare の無料枠は消費しない。
 */
const PORT = 8787;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // 再試行は落ちたテストを隠すため、CI でも 1 回までに留める
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop-chrome",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // 主な利用環境はモバイルのため、実機相当のプロファイルでも検証する
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: {
    // ビルド → migrations 適用 → シード投入 → wrangler dev の順に実行する
    command: "pnpm e2e:server",
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
