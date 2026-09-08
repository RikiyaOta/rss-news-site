import { test, expect } from "@playwright/test";
import {
  TODAY,
  YESTERDAY,
  EMPTY_DATE,
  PAGING_DATE,
  PAGING_TOTAL,
  TODAY_ARTICLES,
  YESTERDAY_ARTICLES,
} from "./fixtures/articles";

/**
 * 日別記事一覧の E2E。
 *
 * API はモックせず、実際に Worker → D1 → SQL を通した結果を検証する。
 */
test.describe("日別記事一覧", () => {
  test("@smoke 当日の記事がスコア降順で表示されること", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: /RSS News for Me/ })).toBeVisible();

    const dateInput = page.getByTestId("date-picker-input");
    await expect(dateInput).toHaveValue(TODAY);

    const cards = page.getByTestId("article-card");
    await expect(cards).toHaveCount(TODAY_ARTICLES.length);

    // D1 の ORDER BY score DESC が効いていること
    const titles = await cards.getByRole("heading").allTextContents();
    expect(titles).toEqual(
      [...TODAY_ARTICLES].sort((a, b) => b.score - a.score).map((a) => a.title),
    );

    // 件数表示はその日の全件数
    await expect(page.getByText(`全 ${TODAY_ARTICLES.length} 件の記事`)).toBeVisible();
  });

  test("@smoke 記事カードに発信元・スコア・要約・リンクが表示されること", async ({ page }) => {
    await page.goto("/");

    const top = TODAY_ARTICLES.reduce((a, b) => (a.score >= b.score ? a : b));
    const card = page.getByTestId("article-card").first();

    await expect(card.getByRole("heading", { name: top.title })).toBeVisible();
    await expect(card.getByText(top.source_name)).toBeVisible();
    await expect(card.getByTestId("score-badge")).toHaveText(
      new RegExp(`スコア:\\s*${top.score}点`),
    );
    await expect(card.getByText(top.summary)).toBeVisible();

    const link = card.getByRole("link", { name: top.title });
    await expect(link).toHaveAttribute("href", top.url);
    await expect(link).toHaveAttribute("target", "_blank");
  });

  test("前日・翌日ボタンで日付が移動し、該当日の記事が表示されること", async ({ page }) => {
    await page.goto("/");

    const dateInput = page.getByTestId("date-picker-input");
    await expect(dateInput).toHaveValue(TODAY);

    await page.getByRole("button", { name: "前日" }).click();

    await expect(dateInput).toHaveValue(YESTERDAY);
    await expect(page.getByTestId("article-card")).toHaveCount(YESTERDAY_ARTICLES.length);
    await expect(page.getByText(YESTERDAY_ARTICLES[0].title)).toBeVisible();

    await page.getByRole("button", { name: "翌日" }).click();

    await expect(dateInput).toHaveValue(TODAY);
    await expect(page.getByText(TODAY_ARTICLES[0].title)).toBeVisible();
  });

  test("当日を表示中は翌日ボタンが無効であること", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByTestId("date-picker-input")).toHaveValue(TODAY);
    await expect(page.getByRole("button", { name: "翌日" })).toBeDisabled();
  });

  test("日付ピッカーから直接移動できること", async ({ page }) => {
    await page.goto("/");

    await page.getByTestId("date-picker-input").fill(YESTERDAY);

    await expect(page.getByText(YESTERDAY_ARTICLES[0].title)).toBeVisible();
    await expect(page.getByTestId("article-card")).toHaveCount(YESTERDAY_ARTICLES.length);
  });

  test("記事が無い日には空状態が表示されること", async ({ page }) => {
    await page.goto("/");

    await page.getByTestId("date-picker-input").fill(EMPTY_DATE);

    await expect(page.getByText(`${EMPTY_DATE} の記事はまだありません`)).toBeVisible();
    await expect(page.getByTestId("article-card")).toHaveCount(0);
  });

  test.describe("ページネーション", () => {
    test("読み込み前から全件数が表示され、追加読み込みで残りが取得されること", async ({ page }) => {
      await page.goto("/");
      await page.getByTestId("date-picker-input").fill(PAGING_DATE);

      // 1 ページ目 (30 件) しか読み込んでいない時点で全 45 件と表示される
      await expect(page.getByText(`全 ${PAGING_TOTAL} 件の記事`)).toBeVisible();
      await expect(page.getByTestId("article-card")).toHaveCount(30);

      await page.getByRole("button", { name: /さらに読み込む/ }).click();

      await expect(page.getByTestId("article-card")).toHaveCount(PAGING_TOTAL);
      // 追加読み込み後も件数表示は変わらない
      await expect(page.getByText(`全 ${PAGING_TOTAL} 件の記事`)).toBeVisible();
      // 全件読み込み済みのため導線が消える
      await expect(page.getByRole("button", { name: /さらに読み込む/ })).toHaveCount(0);
    });

    test("2 ページ目の記事が 1 ページ目と重複しないこと", async ({ page }) => {
      await page.goto("/");
      await page.getByTestId("date-picker-input").fill(PAGING_DATE);
      await expect(page.getByTestId("article-card")).toHaveCount(30);

      await page.getByRole("button", { name: /さらに読み込む/ }).click();
      await expect(page.getByTestId("article-card")).toHaveCount(PAGING_TOTAL);

      const titles = await page.getByTestId("article-card").getByRole("heading").allTextContents();
      expect(new Set(titles).size).toBe(PAGING_TOTAL);
    });
  });
});
