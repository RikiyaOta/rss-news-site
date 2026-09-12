/**
 * デプロイ後の本番検証。
 *
 * `wrangler deploy` の成功は「アップロードできた」ことしか示さない。
 * 本番にしか存在せず、どのテスト層も通っていない経路がいくつかある:
 *
 *   - カスタムドメインのルーティング (E2E は 127.0.0.1 を叩いており、
 *     wrangler.e2e.jsonc は routes を持たない)
 *   - 実 Workers AI (@cf/baai/bge-m3)。L3(Worker) も L4 もスタブに
 *     差し替えているため、実バインディングを通る経路のテストが無い
 *   - リモート適用済みの migrations を持つ実 D1
 *   - エッジからの静的アセット配信
 *
 * ここで見るのは「コード起因でしか落ちないもの」だけに限る。記事の件数
 * (収集パイプラインやニュースの多寡に左右される) は検証しない。データの
 * 鮮度はパイプライン自身が未反映件数で判定する責務であり、外から件数を
 * 覗いても「なぜ 0 件なのか」を切り分けられないため。
 *
 * 使い方: pnpm exec tsx scripts/verify-deployment.ts https://example.com
 */
import { getTodayJstDateString } from "../src/shared/date";

/** デプロイ直後は伝播の途中でありうるため、この時間まで再試行する */
const RETRY_WINDOW_MS = 60_000;
const RETRY_INTERVAL_MS = 5_000;
/** 1 リクエストあたりの上限。応答が返らないまま待ち続けないようにする */
const REQUEST_TIMEOUT_MS = 15_000;

interface CheckOutcome {
  ok: boolean;
  detail: string;
}

interface Check {
  name: string;
  run: (baseUrl: string) => Promise<CheckOutcome>;
}

type CheckResult = CheckOutcome & { name: string };

function pass(detail: string): CheckOutcome {
  return { ok: true, detail };
}

function fail(detail: string): CheckOutcome {
  return { ok: false, detail };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function get(url: string): Promise<Response> {
  return fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { "User-Agent": "rss-news-site-deploy-verification" },
  });
}

/** ヘルスチェックが応答すること (カスタムドメインのルーティングを含む) */
async function checkHealth(baseUrl: string): Promise<CheckOutcome> {
  const res = await get(`${baseUrl}/health`);
  if (!res.ok) return fail(`GET /health が HTTP ${res.status} を返した`);

  const body = (await res.json()) as { status?: string };
  if (body.status !== "ok") {
    return fail(`status が "ok" ではない: ${JSON.stringify(body)}`);
  }
  return pass("GET /health → 200 {status:ok}");
}

/**
 * SPA が配信され、ドキュメントが参照するアセットが実際に取得できること。
 *
 * 参照だけあって実体が無いアセット (index.html が雛形の /vite.svg を
 * 指したまま 404 を引いていた) は、ビルドもデプロイも通り抜ける。
 */
async function checkAssets(baseUrl: string): Promise<CheckOutcome> {
  const res = await get(`${baseUrl}/`);
  if (!res.ok) return fail(`GET / が HTTP ${res.status} を返した`);

  const html = await res.text();
  if (!html.includes('<div id="root"')) {
    return fail("SPA のマウント先 (#root) が HTML に含まれていない");
  }

  // ドキュメントがルート相対で参照しているものを実際に取りに行く
  const referenced = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
  const unique = [...new Set(referenced)];
  if (unique.length === 0) {
    return fail("HTML がアセットを 1 つも参照していない (ビルド結果が壊れている)");
  }

  const broken: string[] = [];
  for (const assetPath of unique) {
    const assetRes = await get(`${baseUrl}${assetPath}`);
    if (!assetRes.ok) broken.push(`${assetPath} → HTTP ${assetRes.status}`);
  }
  if (broken.length > 0) {
    return fail(`参照先が取得できない: ${broken.join(", ")}`);
  }

  return pass(`GET / → 200、参照アセット ${unique.length} 件すべて 200`);
}

/**
 * 日別記事 API が実 D1 に対して応答すること。
 *
 * 件数は検証しない (記事が 0 件の日は正常にありうる)。応答の形だけを見る。
 */
async function checkArticlesApi(baseUrl: string): Promise<CheckOutcome> {
  const date = getTodayJstDateString();
  const res = await get(`${baseUrl}/api/articles?date=${date}`);
  if (!res.ok) return fail(`GET /api/articles が HTTP ${res.status} を返した`);

  const body = (await res.json()) as { date?: string; total?: number; articles?: unknown };
  if (body.date !== date) {
    return fail(`要求した日付 ${date} と応答の日付 ${body.date} が一致しない`);
  }
  if (typeof body.total !== "number" || !Array.isArray(body.articles)) {
    return fail(`応答の形が想定と異なる: ${JSON.stringify(body).slice(0, 200)}`);
  }

  if (body.articles.length > 0) {
    const required = ["id", "title", "url", "source_name", "score", "published_date_jst"];
    const first = body.articles[0] as Record<string, unknown>;
    const missing = required.filter((key) => !(key in first));
    if (missing.length > 0) {
      return fail(`記事に必要な項目が欠けている: ${missing.join(", ")}`);
    }
  }

  return pass(`GET /api/articles?date=${date} → 200 (${body.total} 件)`);
}

/**
 * 検索 API が実 Workers AI (@cf/baai/bge-m3) を通って応答すること。
 *
 * この経路だけは全テスト層でスタブに差し替えられているため、実バインディングを
 * 通す検証はここにしかない。モデル名の変更・権限の喪失・応答形状の変化は
 * ここでしか捕まえられない。
 */
async function checkSearchApi(baseUrl: string): Promise<CheckOutcome> {
  const query = "TypeScript";
  const res = await get(`${baseUrl}/api/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return fail(`GET /api/search が HTTP ${res.status} を返した: ${detail.slice(0, 200)}`);
  }

  const body = (await res.json()) as { query?: string; total?: number; results?: unknown };
  if (body.query !== query) {
    return fail(`クエリが反映されていない: ${JSON.stringify(body).slice(0, 200)}`);
  }
  if (typeof body.total !== "number" || !Array.isArray(body.results)) {
    return fail(`応答の形が想定と異なる: ${JSON.stringify(body).slice(0, 200)}`);
  }

  // 結果があるなら、ベクトル化まで到達して類似度が計算できていること
  if (body.results.length > 0) {
    const first = body.results[0] as Record<string, unknown>;
    if (typeof first.similarity !== "number" || !Number.isFinite(first.similarity)) {
      return fail(`類似度が数値になっていない: ${JSON.stringify(first).slice(0, 200)}`);
    }
  }

  return pass(`GET /api/search?q=${query} → 200 (${body.total} 件)`);
}

const CHECKS: Check[] = [
  { name: "ヘルスチェック", run: checkHealth },
  { name: "静的アセットの配信", run: checkAssets },
  { name: "日別記事 API", run: checkArticlesApi },
  { name: "検索 API (実 Workers AI)", run: checkSearchApi },
];

/** 例外も失敗として扱い、1 回の実行で全項目の結果が出そろうようにする */
async function runChecks(baseUrl: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of CHECKS) {
    try {
      results.push({ name: check.name, ...(await check.run(baseUrl)) });
    } catch (err: any) {
      results.push({ name: check.name, ...fail(`検証中に例外: ${err?.message || String(err)}`) });
    }
  }
  return results;
}

export async function verifyDeployment(baseUrl: string): Promise<CheckResult[]> {
  const deadline = Date.now() + RETRY_WINDOW_MS;
  let results = await runChecks(baseUrl);

  while (results.some((r) => !r.ok) && Date.now() < deadline) {
    const failed = results.filter((r) => !r.ok).map((r) => r.name);
    console.log(`  ⏳ 未達: ${failed.join(", ")} (伝播待ちとして再試行します)`);
    await sleep(RETRY_INTERVAL_MS);
    results = await runChecks(baseUrl);
  }

  return results;
}

const baseUrlArg = process.argv[2]?.replace(/\/$/, "");

if (!baseUrlArg) {
  console.error("検証対象の URL を指定してください: tsx scripts/verify-deployment.ts <base-url>");
  process.exit(1);
}

console.log(`\n========================================`);
console.log(`🔎 デプロイ後の検証: ${baseUrlArg}`);
console.log(`========================================`);

const results = await verifyDeployment(baseUrlArg);

for (const result of results) {
  console.log(`  ${result.ok ? "✅" : "❌"} ${result.name}: ${result.detail}`);
}

const failures = results.filter((r) => !r.ok);

console.log(`\n========================================`);
if (failures.length > 0) {
  console.error(`❌ デプロイ後の検証に失敗しました (${failures.length}/${results.length} 項目)`);
  console.log(`========================================\n`);
  process.exit(1);
}
console.log(`✅ デプロイ後の検証がすべて通過しました (${results.length} 項目)`);
console.log(`========================================\n`);
