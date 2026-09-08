/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    /** vitest.worker.config.ts が migrations/ から読み込んで注入する */
    TEST_MIGRATIONS: D1Migration[];
  }
}
