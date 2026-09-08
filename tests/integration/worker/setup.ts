import { env, applyD1Migrations } from "cloudflare:test";
import { beforeAll } from "vitest";

/**
 * 本番へ適用されるものと同一の migrations/ をローカル D1 に適用する。
 */
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
