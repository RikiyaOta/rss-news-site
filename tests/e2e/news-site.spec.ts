import { test, expect } from "@playwright/test";

function getTodayJstString(): string {
  const now = new Date();
  const jstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = jstDate.getUTCFullYear();
  const mm = String(jstDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(jstDate.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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

test.describe("AI RSS News サイトの E2E 結合検証", () => {
  const todayStr = getTodayJstString();
  const yesterdayStr = adjustDate(todayStr, -1);

  const todayArticles = [
    {
      id: "art-today-1",
      title: "AI RSS News Dashboard 正式リリースと多言語ベクトル検索機能",
      url: "https://example.com/today-1",
      source_name: "Tech Portal",
      summary:
        "Cloudflare Workers Static AssetsとHono、D1を活用したサーバーレス構成。Workers AI (BGE-M3) によるベクトル検索を提供します。",
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
        "エッジコンピューティングにおけるベクトル検索の進化とオープンソースLLMの活用手法について解説します。",
      score: 88,
      published_at: `${yesterdayStr}T12:00:00.000Z`,
    },
  ];

  const searchResults = [
    {
      id: "art-today-2",
      title: "TypeScript 5.8の新機能とコンパイラ高速化",
      url: "https://example.com/today-2",
      source_name: "TypeScript News",
      summary:
        "モジュール解決パフォーマンスの大幅な改善と新しい型アサーション構文のサポートにより、開発効率がさらに向上しました。",
      score: 82,
      published_at: `${todayStr}T09:30:00.000Z`,
      date: todayStr,
      similarity: 0.88,
    },
    {
      id: "art-today-1",
      title: "AI RSS News Dashboard 正式リリースと多言語ベクトル検索機能",
      url: "https://example.com/today-1",
      source_name: "Tech Portal",
      summary:
        "Cloudflare Workers Static AssetsとHono、D1を活用したサーバーレス構成。Workers AI (BGE-M3) によるベクトル検索を提供します。",
      score: 95,
      published_at: `${todayStr}T08:00:00.000Z`,
      date: todayStr,
      similarity: 0.75,
    },
  ];

  test.beforeEach(async ({ page }) => {
    // 日別記事 API リクエストのインターセプト (/api/articles?date=...)
    await page.route("**/api/articles*", async (route) => {
      const url = new URL(route.request().url());
      const date = url.searchParams.get("date") || todayStr;

      if (date === yesterdayStr) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            date: yesterdayStr,
            total: yesterdayArticles.length,
            articles: yesterdayArticles,
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            date: todayStr,
            total: todayArticles.length,
            articles: todayArticles,
          }),
        });
      }
    });

    // セマンティック検索 API リクエストのインターセプト (/api/search?q=...)
    await page.route("**/api/search*", async (route) => {
      const url = new URL(route.request().url());
      const q = url.searchParams.get("q") || "";

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          query: q,
          total: searchResults.length,
          results: searchResults,
        }),
      });
    });
  });

  test("シナリオ 1: トップページ表示と日別ニュース一覧が正常に表示されること", async ({ page }) => {
    await page.goto("/");

    // 1. タイトル「AI RSS News Dashboard」が表示されること
    const heading = page.getByRole("heading", { level: 1, name: /AI RSS News Dashboard/ });
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
      firstCard.getByText(/Cloudflare Workers Static AssetsとHono、D1を活用したサーバーレス構成/),
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

    // 検索結果に「一致度 XX%」バッジと該当日付バッジが表示されること
    const similarityBadge = page.getByTestId("similarity-badge").first();
    await expect(similarityBadge).toBeVisible();
    await expect(similarityBadge).toHaveText(/一致度\s*88%/);

    const firstSearchCard = page.getByTestId("article-card").filter({ visible: true }).first();
    await expect(firstSearchCard).toBeVisible();

    // 該当日付バッジが表示されること
    await expect(firstSearchCard.getByText(todayStr)).toBeVisible();
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

    await expect(page.getByTestId("similarity-badge").first()).toBeVisible();

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
    const heading = page.getByRole("heading", { level: 1, name: /AI RSS News Dashboard/ });
    await expect(heading).toBeVisible();

    // 日付ピッカーとナビゲーションが表示されていること
    const dateInput = page.getByTestId("date-picker-input");
    await expect(dateInput).toBeVisible();

    // モバイル幅でも記事カードが表示され、コンテンツが欠落しないこと
    const articleCards = page.getByTestId("article-card");
    await expect(articleCards.first()).toBeVisible();
    await expect(articleCards.first().getByTestId("score-badge")).toBeVisible();
    await expect(
      articleCards
        .first()
        .getByText(/Cloudflare Workers Static AssetsとHono、D1を活用したサーバーレス構成/),
    ).toBeVisible();

    // 過剰な DOM レンダリングがないことを検証 (ノード数 < 150)
    const domCount = await page.evaluate(() => document.querySelectorAll("*").length);
    expect(domCount).toBeLessThan(150);
  });
});
