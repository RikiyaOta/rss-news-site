import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sqlWasmPath = path.resolve(__dirname, "../../node_modules/sql.js/dist/sql-wasm.wasm");
const sqlWasmBuffer = fs.readFileSync(sqlWasmPath);

function getTodayString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function adjustDate(dateStr: string, offsetDays: number): string {
  const parts = dateStr.split("-").map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createDailyDbBuffer(
  articles: Array<{
    id: string;
    title: string;
    url: string;
    source_name: string;
    summary: string;
    score: number;
    published_at: string;
  }>,
): Buffer {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      source_name TEXT NOT NULL,
      summary TEXT NOT NULL,
      score INTEGER NOT NULL,
      published_at TEXT NOT NULL
    );
  `);
  const stmt = db.prepare(`
    INSERT INTO articles (id, title, url, source_name, summary, score, published_at)
    VALUES (@id, @title, @url, @source_name, @summary, @score, @published_at)
  `);
  for (const article of articles) {
    stmt.run(article);
  }
  const buffer = db.serialize();
  db.close();
  return buffer;
}

function createSearchIndexDbBuffer(
  items: Array<{
    article_id: string;
    date: string;
    vector: Float32Array;
  }>,
): Buffer {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE search_index (
      article_id TEXT,
      date TEXT,
      embedding BLOB
    );
  `);
  const stmt = db.prepare(`
    INSERT INTO search_index (article_id, date, embedding)
    VALUES (?, ?, ?)
  `);
  for (const item of items) {
    const uint8 = new Uint8Array(
      item.vector.buffer,
      item.vector.byteOffset,
      item.vector.byteLength,
    );
    stmt.run(item.article_id, item.date, Buffer.from(uint8));
  }
  const buffer = db.serialize();
  db.close();
  return buffer;
}

test.describe("AI RSS News サイトの E2E 結合検証", () => {
  const todayStr = getTodayString();
  const yesterdayStr = adjustDate(todayStr, -1);

  const todayArticles = [
    {
      id: "art-today-1",
      title: "AI RSS News Dashboard 正式リリースと多言語ベクトル検索機能",
      url: "https://example.com/today-1",
      source_name: "Tech Portal",
      summary:
        "Cloudflare R2とWasm SQLiteを活用したサーバーレス構成。多言語ベクトルモデルによる高速な興味関心スコアリングとブラウザ内セマンティック検索を提供します。",
      score: 95,
      published_at: `${todayStr}T08:00:00.000Z`,
    },
    {
      id: "art-today-2",
      title: "TypeScript 5.8の新機能とコンパイラ高速化",
      url: "https://example.com/today-2",
      source_name: "TypeScript News",
      summary:
        "モジュール解決パフォーマンスの大幅な改善と新しい型アサーション構文のサポートにより、開発効率がさらに向上しました。",
      score: 82,
      published_at: `${todayStr}T09:30:00.000Z`,
    },
  ];

  const yesterdayArticles = [
    {
      id: "art-yest-1",
      title: "前日の主要テクノロジートレンド総まとめ",
      url: "https://example.com/yest-1",
      source_name: "Dev Weekly",
      summary:
        "WebAssemblyとクライアントサイドDBの最新事例。エッジコンピューティングにおけるベクトル検索の進化とオープンソースLLMの活用手法について解説します。",
      score: 88,
      published_at: `${yesterdayStr}T12:00:00.000Z`,
    },
  ];

  const unitVector = new Float32Array(384);
  unitVector.fill(1.0 / Math.sqrt(384));

  const searchIndexItems = [
    {
      article_id: "art-today-2",
      date: todayStr,
      vector: unitVector,
    },
    {
      article_id: "art-today-1",
      date: todayStr,
      vector: unitVector,
    },
  ];

  test.beforeEach(async ({ page }) => {
    // Web Worker をブラウザ環境でモック化（E2E_REAL_MODEL が有効な場合は本物の Worker を使用）
    if (!process.env.E2E_REAL_MODEL) {
      await page.addInitScript(() => {
        window.Worker = class MockWorker extends EventTarget {
          constructor() {
            super();
          }
          postMessage(data: any) {
            setTimeout(() => {
              const vec = new Float32Array(384);
              vec.fill(1.0 / Math.sqrt(384));
              const event = new MessageEvent("message", {
                data: {
                  id: data.id,
                  vector: Array.from(vec),
                },
              });
              this.dispatchEvent(event);
              if (typeof (this as any).onmessage === "function") {
                (this as any).onmessage(event);
              }
            }, 10);
          }
          terminate() {}
        } as any;
      });
    }

    const todayDbBuf = createDailyDbBuffer(todayArticles);
    const yesterdayDbBuf = createDailyDbBuffer(yesterdayArticles);
    const searchIndexDbBuf = createSearchIndexDbBuffer(searchIndexItems);

    // sql.js の wasm ファイルリクエストをローカルファイルでインターセプト
    await page.route(/.*sql-wasm.*\.wasm/, async (route) => {
      const req = route.request();
      if (
        req.resourceType() === "script" ||
        req.url().includes("import") ||
        req.url().includes("?url")
      ) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/wasm",
        body: sqlWasmBuffer,
      });
    });

    // 日別 DB および検索インデックス DB のネットワークリクエストをインターセプト
    await page.route(`**/data/${todayStr}.db`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/vnd.sqlite3",
        body: todayDbBuf,
      });
    });

    await page.route(`**/data/${yesterdayStr}.db`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/vnd.sqlite3",
        body: yesterdayDbBuf,
      });
    });

    await page.route("**/search_index.db", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/vnd.sqlite3",
        body: searchIndexDbBuf,
      });
    });
  });

  test("シナリオ 1: トップページ表示と日別ニュース一覧が正常に表示されること", async ({ page }) => {
    await page.goto("/");

    // 1. タイトル「AI RSS News Dashboard」が表示されること
    const heading = page.getByRole("heading", { name: /AI RSS News Dashboard/ });
    await expect(heading).toBeVisible();

    // 2. 日付ナビゲーションとカレンダーピッカーが表示されること
    const dateInput = page.getByTestId("date-picker-input");
    await expect(dateInput).toBeVisible();
    await expect(dateInput).toHaveValue(todayStr);

    const prevBtn = page.getByRole("button", { name: "前日" });
    const nextBtn = page.getByRole("button", { name: "翌日" });
    await expect(prevBtn).toBeVisible();
    await expect(nextBtn).toBeVisible();

    // 3. 記事カードにタイトル、発信元バッジ、興味関心スコアバッジ、要約スニペットが表示されること
    const articleCards = page.getByTestId("article-card");
    await expect(articleCards).toHaveCount(2);

    const firstCard = articleCards.first();
    await expect(
      firstCard.getByRole("heading", {
        name: "AI RSS News Dashboard 正式リリースと多言語ベクトル検索機能",
      }),
    ).toBeVisible();
    await expect(firstCard.getByText("Tech Portal")).toBeVisible();
    await expect(firstCard.getByTestId("score-badge")).toHaveText(/スコア:\s*95点/);
    await expect(
      firstCard.getByText(/Cloudflare R2とWasm SQLiteを活用したサーバーレス構成/),
    ).toBeVisible();
  });

  test("シナリオ 2: 日付ナビゲーション操作で前日および翌日に切り替わること", async ({ page }) => {
    await page.goto("/");

    const dateInput = page.getByTestId("date-picker-input");
    await expect(dateInput).toHaveValue(todayStr);

    // 前日ボタンをクリックして前日の記事一覧が表示されること
    const prevBtn = page.getByRole("button", { name: "前日" });
    await prevBtn.click();

    await expect(dateInput).toHaveValue(yesterdayStr);
    const articleCards = page.getByTestId("article-card");
    await expect(articleCards).toHaveCount(1);
    await expect(page.getByText("前日の主要テクノロジートレンド総まとめ")).toBeVisible();
    await expect(page.getByText("Dev Weekly")).toBeVisible();

    // 翌日ボタンをクリックして当日の記事一覧に戻ること
    const nextBtn = page.getByRole("button", { name: "翌日" });
    await nextBtn.click();

    await expect(dateInput).toHaveValue(todayStr);
    await expect(
      page.getByText("AI RSS News Dashboard 正式リリースと多言語ベクトル検索機能"),
    ).toBeVisible();
  });

  test("シナリオ 3: 自然言語セマンティック検索フローで類似度および日付バッジが表示されること", async ({
    page,
  }) => {
    await page.goto("/");

    // モードをセマンティック検索に切り替え
    const searchTab = page.getByRole("button", { name: "セマンティック検索" });
    await searchTab.click();

    const searchInput = page.getByPlaceholder(/自然言語で検索/);
    await expect(searchInput).toBeVisible();

    // 検索バーにクエリ（例: "TypeScript"）を入力して検索実行
    await searchInput.fill("TypeScript");
    const searchBtn = page.getByRole("button", { name: "検索", exact: true });
    await searchBtn.click();

    // 検索結果に「一致度 XX%」バッジと該当日付バッジが表示されること（実モデルロード時は最大60秒待機）
    const articleCards = page.getByTestId("article-card");
    await expect(articleCards.first()).toBeVisible({
      timeout: process.env.E2E_REAL_MODEL ? 60000 : 5000,
    });

    const similarityBadge = articleCards.first().getByTestId("similarity-badge");
    await expect(similarityBadge).toBeVisible({
      timeout: process.env.E2E_REAL_MODEL ? 60000 : 5000,
    });
    await expect(similarityBadge).toHaveText(/一致度\s*-?\d+%/);

    // 該当日付バッジが表示されること
    await expect(articleCards.first().getByText(todayStr)).toBeVisible();
  });

  test("シナリオ 4: 検索のクリア操作で入力欄がリセットされ、日別ニュース一覧に戻ること", async ({
    page,
  }) => {
    await page.goto("/");

    // セマンティック検索タブに切り替え
    const searchTab = page.getByRole("button", { name: "セマンティック検索" });
    await searchTab.click();

    const searchInput = page.getByPlaceholder(/自然言語で検索/);
    await searchInput.fill("TypeScript");
    const searchBtn = page.getByRole("button", { name: "検索", exact: true });
    await searchBtn.click();

    await expect(page.getByTestId("similarity-badge").first()).toBeVisible({
      timeout: process.env.E2E_REAL_MODEL ? 60000 : 5000,
    });

    // クリアボタンをクリック
    const clearBtn = page.getByRole("button", { name: "クリア" });
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();

    // 検索入力欄がリセットされ、日別表示（モード）に戻ること
    await expect(searchInput).not.toBeVisible();
    const dateInput = page.getByTestId("date-picker-input");
    await expect(dateInput).toBeVisible();
    await expect(dateInput).toHaveValue(todayStr);
    await expect(
      page.getByText("AI RSS News Dashboard 正式リリースと多言語ベクトル検索機能"),
    ).toBeVisible();
  });

  test("シナリオ 5: レスポンシブモバイル表示（幅375px）でレイアウト崩れなく主要コンポーネントが表示されること", async ({
    page,
  }) => {
    // モバイル画面サイズ（375x667: iPhone SE / 共通モバイル基準）に設定
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    // ヘッダーとタイトルが表示されていること
    const heading = page.getByRole("heading", { name: /AI RSS News Dashboard/ });
    await expect(heading).toBeVisible();

    // 日付ピッカーとナビゲーションが表示されていること
    const dateInput = page.getByTestId("date-picker-input");
    await expect(dateInput).toBeVisible();

    // モバイル幅でも記事カードが表示され、コンテンツが欠落しないこと
    const articleCards = page.getByTestId("article-card");
    await expect(articleCards.first()).toBeVisible();
    await expect(articleCards.first().getByTestId("score-badge")).toBeVisible();
    await expect(
      articleCards.first().getByText(/Cloudflare R2とWasm SQLiteを活用したサーバーレス構成/),
    ).toBeVisible();
  });
});
