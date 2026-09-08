import { test, expect, type Page } from "@playwright/test";
import { TODAY, YESTERDAY, TODAY_ARTICLES, YESTERDAY_ARTICLES } from "./fixtures/articles";

/**
 * モバイルのページめくり操作の E2E。
 *
 * 指の追従・しきい値・抵抗といった細かな挙動は
 * tests/component/web/daily-pager.test.tsx で網羅しているため、
 * ここでは「実ブラウザのタッチイベントで日付移動が成立するか」を検証する。
 */
test.describe("モバイルのページめくり", () => {
  test.skip(({ hasTouch }) => !hasTouch, "タッチ操作のあるプロファイルのみ対象");

  interface DragOptions {
    release?: boolean;
    deltaY?: number;
  }

  /** 日別一覧領域に実際の TouchEvent を発火させて横ドラッグを再現する */
  async function dragDailyList(page: Page, fromX: number, toX: number, options: DragOptions = {}) {
    await page.evaluate(
      ({ fromX, toX, release, deltaY }) => {
        const target = document.querySelector('[data-testid="daily-swipe-area"]');
        if (!target) throw new Error("日別一覧のドラッグ領域が見つかりません");

        const startY = 400;
        const createTouch = (clientX: number, clientY: number) =>
          new Touch({ identifier: 1, target, clientX, clientY });

        const dispatch = (type: string, touches: Touch[], changedTouches: Touch[]) => {
          target.dispatchEvent(
            new TouchEvent(type, {
              bubbles: true,
              cancelable: true,
              touches,
              targetTouches: touches,
              changedTouches,
            }),
          );
        };

        const start = createTouch(fromX, startY);
        const end = createTouch(toX, startY + deltaY);
        dispatch("touchstart", [start], [start]);
        dispatch("touchmove", [end], [end]);
        if (release) dispatch("touchend", [], [end]);
      },
      { fromX, toX, release: options.release ?? true, deltaY: options.deltaY ?? 0 },
    );
  }

  test("@smoke 指を左から右へ動かすと前日へ移動し、逆方向で戻ること", async ({ page }) => {
    await page.goto("/");

    const dateInput = page.getByTestId("date-picker-input");
    await expect(dateInput).toHaveValue(TODAY);
    await expect(page.getByText(TODAY_ARTICLES[0].title)).toBeVisible();

    // 指を左から右へ = 左側にある前日が現れる
    await dragDailyList(page, 60, 320);
    await expect(dateInput).toHaveValue(YESTERDAY);
    await expect(page.getByText(YESTERDAY_ARTICLES[0].title)).toBeVisible();

    // 指を右から左へ = 右側にある当日へ戻る
    await dragDailyList(page, 320, 60);
    await expect(dateInput).toHaveValue(TODAY);
    await expect(page.getByText(TODAY_ARTICLES[0].title)).toBeVisible();
  });

  test("めくっている最中は遷移元と遷移先の両方が見えていること", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(TODAY_ARTICLES[0].title)).toBeVisible();

    // 静止時は隣接する日付のページは描画されていない
    await expect(page.getByText(YESTERDAY_ARTICLES[0].title)).toHaveCount(0);

    await dragDailyList(page, 60, 160, { release: false });

    await expect(page.getByTestId("daily-pager-track")).toHaveAttribute(
      "data-pager-phase",
      "dragging",
    );
    await expect(page.getByText(TODAY_ARTICLES[0].title)).toBeVisible();
    await expect(page.getByText(YESTERDAY_ARTICLES[0].title)).toBeVisible();
    // 日付はまだ確定していない
    await expect(page.getByTestId("date-picker-input")).toHaveValue(TODAY);
  });

  test("移動量がしきい値に満たない場合は元のページへ戻ること", async ({ page }) => {
    await page.goto("/");

    await dragDailyList(page, 60, 100);

    await expect(page.getByTestId("daily-pager-track")).toHaveAttribute("data-pager-phase", "idle");
    await expect(page.getByTestId("date-picker-input")).toHaveValue(TODAY);
  });

  test("当日を表示中に翌日方向へめくっても日付が進まないこと", async ({ page }) => {
    await page.goto("/");

    await dragDailyList(page, 320, 60);

    await expect(page.getByTestId("daily-pager-track")).toHaveAttribute("data-pager-phase", "idle");
    await expect(page.getByTestId("date-picker-input")).toHaveValue(TODAY);
  });

  test("縦方向のスワイプでは日付が変更されないこと", async ({ page }) => {
    await page.goto("/");

    await dragDailyList(page, 300, 220, { deltaY: -300 });

    await expect(page.getByTestId("daily-pager-track")).toHaveAttribute("data-pager-phase", "idle");
    await expect(page.getByTestId("date-picker-input")).toHaveValue(TODAY);
  });
});
