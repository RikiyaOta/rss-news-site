import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * 押せる要素のカーソル表示の E2E。
 *
 * 「カーソルが変わるか」は実際に CSS を適用したブラウザでしか確認できない
 * （jsdom は Tailwind のスタイルを解決しない）ため、ここで実ブラウザを通す。
 *
 * Tailwind v4 の preflight はボタンのカーソルを UA 既定（`default`）へ戻すため、
 * 明示しない限り押せる要素にカーソルの変化が出ない。
 */

/** 実際に描かれたカーソルの種類を読み出す */
async function cursorOf(locator: Locator): Promise<string> {
  await expect(locator).toBeVisible();
  return locator.evaluate((el) => getComputedStyle(el).cursor);
}

/** 検索画面へ切り替える */
async function openSearchView(page: Page): Promise<void> {
  await page.getByRole("button", { name: "セマンティック検索" }).click();
  await expect(page.getByPlaceholder("キーワードで検索")).toBeVisible();
}

const DAILY_CASES = [
  { label: "日別一覧タブ", locate: (page: Page) => page.getByRole("button", { name: "日別一覧" }) },
  {
    label: "検索タブ",
    locate: (page: Page) => page.getByRole("button", { name: "セマンティック検索" }),
  },
  { label: "前日ボタン", locate: (page: Page) => page.getByRole("button", { name: "前日" }) },
  { label: "日付ピッカー", locate: (page: Page) => page.getByTestId("date-picker-input") },
  {
    label: "リポジトリへのリンク",
    locate: (page: Page) => page.getByRole("link", { name: /GitHub リポジトリ/ }),
  },
  {
    label: "記事タイトルのリンク",
    locate: (page: Page) => page.getByTestId("article-card").first().getByRole("link").first(),
  },
] as const;

test.describe("日別一覧", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("article-card").first()).toBeVisible();
  });

  for (const { label, locate } of DAILY_CASES) {
    test(`${label}にカーソルを合わせると押せることが分かる形になること`, async ({ page }) => {
      expect(await cursorOf(locate(page))).toBe("pointer");
    });
  }

  test("押せない翌日ボタンは押せないことが分かる形になること", async ({ page }) => {
    // 当日を表示しているため翌日へは進めない
    const nextDay = page.getByRole("button", { name: "翌日" });
    await expect(nextDay).toBeDisabled();

    expect(await cursorOf(nextDay)).toBe("not-allowed");
  });
});

test.describe("検索", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await openSearchView(page);
  });

  test("入力済みの検索ボタンにカーソルを合わせると押せることが分かる形になること", async ({
    page,
  }) => {
    await page.getByPlaceholder("キーワードで検索").fill("Rust");

    expect(await cursorOf(page.getByRole("button", { name: "検索", exact: true }))).toBe("pointer");
  });

  test("クリアボタンにカーソルを合わせると押せることが分かる形になること", async ({ page }) => {
    await page.getByPlaceholder("キーワードで検索").fill("Rust");

    expect(await cursorOf(page.getByRole("button", { name: "クリア" }))).toBe("pointer");
  });

  test("未入力で押せない検索ボタンは押せないことが分かる形になること", async ({ page }) => {
    const searchButton = page.getByRole("button", { name: "検索", exact: true });
    await expect(searchButton).toBeDisabled();

    expect(await cursorOf(searchButton)).toBe("not-allowed");
  });
});
