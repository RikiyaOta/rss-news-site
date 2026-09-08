import type { ExecutionContext } from "@cloudflare/workers-types";
import app from "../../src/server/index";
import { fakeEmbedding } from "./fixtures/fake-embedding";

/**
 * E2E 用の Worker エントリポイント。
 *
 * 本番と同じ Hono アプリ (src/server/index.ts) をそのまま起動し、
 * Workers AI バインディングが無い場合にだけ決定論的なスタブを差し込む。
 *
 * - PR ごとの E2E: AI バインディングを設定しない → スタブが使われ、
 *   Cloudflare へのアクセスは発生しない (無料枠の消費なし・シークレット不要)。
 * - nightly の E2E: wrangler.e2e.jsonc の AI に remote: true を付けると
 *   env.AI が実バインディングになり、そのまま本物の Workers AI が使われる。
 *
 * D1・静的アセット配信・ルーティングはどちらの場合も本物である。
 */
const stubAi = {
  async run(_model: string, options: { text: string }) {
    return { data: [Array.from(fakeEmbedding(options.text))] };
  },
};

export default {
  fetch(request: Request, env: Record<string, unknown>, ctx: ExecutionContext) {
    return app.fetch(request, { ...env, AI: env.AI ?? stubAi }, ctx);
  },
};
