import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 「フィード取得を終えたらプロセスが終了できること」の回帰テスト。
 *
 * rss-parser 3.13.0 の parseURL はリダイレクト応答の本文を読み捨てず、
 * リクエストも中断しないままリダイレクト先の取得へ進む。Node 19 以降の
 * http.globalAgent は keepAlive が既定で有効なため、その接続はサーバー側が
 * アイドルタイムアウトで閉じるまで解放されず、ソケットがイベントループを
 * 掴み続ける。結果としてパイプラインは全処理を終えたあともプロセスが
 * 終了できず、GitHub Actions のジョブが完了ログの出力後に 6 分 45 秒
 * ハングしていた。
 *
 * この性質はプロセスの外からしか観測できないため、子プロセスで実際に
 * フィードを取得させ、自然に終了するかどうかで検証する。
 * リダイレクトさせるテスト用サーバーは keepAlive を長く保つので、
 * 接続が解放されなければ子プロセスは時間内に終了しない。
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const CHILD_SCRIPT = path.join(HERE, "fixtures/fetch-feed-child.ts");
const TSX = path.join(REPO_ROOT, "node_modules/.bin/tsx");

/**
 * 接続が解放されなければ確実に超過し、正常時は余裕で収まる待ち時間。
 * ケース側の testTimeout はこれより長くして、vitest の一般的な
 * タイムアウトではなく「終了しなかった」という失敗として報告させる。
 */
const EXIT_TIMEOUT_MS = 8_000;
const TEST_TIMEOUT_MS = 15_000;

const RSS_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>テストフィード</title>
  <item>
    <title>リダイレクト先の記事</title>
    <link>https://example.com/articles/1</link>
    <description>本文</description>
    <pubDate>__PUB_DATE__</pubDate>
  </item>
</channel></rss>`;

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/redirect") {
      // 本文を持つリダイレクト。呼び出し側が読み捨てないと接続が解放されない
      res.writeHead(301, { Location: "/feed", "Content-Type": "text/plain" });
      res.end("Moved Permanently".repeat(100));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/rss+xml" });
    res.end(RSS_BODY.replace("__PUB_DATE__", new Date().toUTCString()));
  });
  // 実サーバーのアイドルタイムアウトを模し、接続を自然に閉じさせない
  server.keepAliveTimeout = 10 * 60 * 1000;
  server.headersTimeout = 11 * 60 * 1000;

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
});

interface ChildResult {
  exitCode: number | null;
  stdout: string;
  timedOut: boolean;
}

function fetchFeedInChildProcess(url: string): Promise<ChildResult> {
  return new Promise((resolve) => {
    const child = spawn(TSX, [CHILD_SCRIPT, url], { cwd: REPO_ROOT });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ exitCode: null, stdout, timedOut: true });
    }, EXIT_TIMEOUT_MS);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, timedOut: false });
    });
  });
}

describe("フィード取得後のプロセス終了", () => {
  it.each([
    ["リダイレクトを挟むフィード", "/redirect"],
    ["リダイレクトの無いフィード", "/feed"],
  ])(
    "%s を取得したあとプロセスが自然に終了すること",
    async (_label, urlPath) => {
      const result = await fetchFeedInChildProcess(`${baseUrl}${urlPath}`);

      // まず記事を取得できていること (取得自体が失敗していては終了確認の意味がない)
      expect(result.stdout).toContain("FETCHED:1");
      expect(
        result.timedOut,
        `フィード取得後も ${EXIT_TIMEOUT_MS}ms 以内にプロセスが終了しなかった`,
      ).toBe(false);
      expect(result.exitCode).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );
});
