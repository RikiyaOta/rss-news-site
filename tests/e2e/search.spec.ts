import { test, expect, type Page } from "@playwright/test";
import { TODAY, TODAY_ARTICLES, YESTERDAY_ARTICLES } from "./fixtures/articles";

/**
 * セマンティック検索の E2E。
 *
 * クエリのベクトル化 → D1 の全記事ベクトルとの類似度計算 → 並び替えという
 * 検索経路を、実際に Worker と D1 を通して検証する。
 * PR ではベクトル生成のみ決定論的なスタブに差し替わる (fixtures/fake-embedding.ts)。
 *
 * 日別一覧と検索はタブを CSS の hidden で切り替えており、非表示側のカードも
 * DOM に残る。そのため検索結果は必ず search-view の内側で辿る。
 */
test.describe("セマンティック検索", () => {
  const typeScriptArticle = TODAY_ARTICLES.find((a) => a.title.includes("TypeScript"))!;
  const cloudflareArticle = TODAY_ARTICLES.find((a) => a.title.includes("Cloudflare"))!;

  const searchResults = (page: Page) => page.getByTestId("search-view").getByTestId("article-card");

  async function search(page: Page, query: string) {
    await page.getByPlaceholder(/キーワードで検索/).fill(query);
    await page.getByRole("button", { name: "検索", exact: true }).click();
  }

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "セマンティック検索" }).click();
  });

  test("@smoke クエリに関連する記事が一致度バッジ付きで先頭に表示されること", async ({ page }) => {
    await search(page, "TypeScript");

    const first = searchResults(page).first();
    await expect(first.getByRole("heading", { name: typeScriptArticle.title })).toBeVisible();

    const badge = page.getByTestId("search-view").getByTestId("similarity-badge").first();
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/一致度\s*\d+%/);

    // 検索結果には公開日バッジが出る
    await expect(first.getByText(TODAY)).toBeVisible();
  });

  test("クエリを変えると並び順が変わること", async ({ page }) => {
    await search(page, "TypeScript");
    await expect(
      searchResults(page).first().getByRole("heading", { name: typeScriptArticle.title }),
    ).toBeVisible();

    await search(page, "Cloudflare Workers D1 サーバーレス");
    await expect(
      searchResults(page).first().getByRole("heading", { name: cloudflareArticle.title }),
    ).toBeVisible();
  });

  test("検索は日付をまたいで全期間を対象とすること", async ({ page }) => {
    await search(page, "エッジコンピューティング オープンソース");

    // 前日の記事が先頭に来る = 日別一覧と違い日付で絞られていない
    await expect(
      searchResults(page).first().getByRole("heading", { name: YESTERDAY_ARTICLES[0].title }),
    ).toBeVisible();
  });

  test("一致度は降順に並ぶこと", async ({ page }) => {
    await search(page, "TypeScript");

    const badges = await page
      .getByTestId("search-view")
      .getByTestId("similarity-badge")
      .allTextContents();
    const values = badges.map((text) => Number(text.replace(/[^\d]/g, "")));

    expect(values.length).toBeGreaterThan(1);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  test("クリアで入力と検索結果がリセットされ、検索画面に留まること", async ({ page }) => {
    await search(page, "TypeScript");
    await expect(
      page.getByTestId("search-view").getByTestId("similarity-badge").first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "クリア" }).click();

    // 検索画面のまま入力欄が空になり、結果だけが消える
    await expect(page.getByPlaceholder(/キーワードで検索/)).toHaveValue("");
    await expect(searchResults(page)).toHaveCount(0);
    await expect(page.getByText("キーワードを入力してください")).toBeVisible();
  });

  test("検索を実行するまで未ヒットの文言が表示されないこと", async ({ page }) => {
    await page.getByPlaceholder(/キーワードで検索/).fill("該当なしのはずのクエリ");

    await expect(page.getByText("キーワードを入力してください")).toBeVisible();
    await expect(page.getByText(/一致する記事はありません/)).toHaveCount(0);
  });

  test("空白のみのクエリでは検索ボタンが押せないこと", async ({ page }) => {
    await page.getByPlaceholder(/キーワードで検索/).fill("   ");

    await expect(page.getByRole("button", { name: "検索", exact: true })).toBeDisabled();
    await expect(page.getByTestId("search-view").getByTestId("similarity-badge")).toHaveCount(0);
  });
});
