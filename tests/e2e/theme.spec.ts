import { test, expect, type Page } from "@playwright/test";

/**
 * 配色の E2E。
 *
 * 本プロジェクトは配色の切り替え UI を持たず、OS / ブラウザの
 * `prefers-color-scheme` にのみ追従する (Tailwind の `dark:` の既定の挙動)。
 * 「ダークを選好するブラウザで実際にダークが描かれるか」は実ブラウザでしか
 * 確認できないため、ここで両方の選好を通す。
 *
 * Playwright の `colorScheme` の既定値は `light` なので、明示しない限り
 * 他の E2E はすべてライトで走っている。
 */

interface RenderedTheme {
  /** body 背景の明るさ (0 = 黒, 1 = 白) */
  backgroundBrightness: number;
  /** ネイティブ UI (日付ピッカー等) が受け取る配色 */
  colorScheme: string;
}

/**
 * 実際に描かれた配色を読み出す。
 *
 * 背景色の表記は Tailwind やブラウザの版で `rgb()` にも `oklch()` にもなるため、
 * 文字列では比較せず canvas にブラウザ自身で解決させて明るさを求める。
 */
async function readTheme(page: Page): Promise<RenderedTheme> {
  await page.goto("/");
  await expect(page.getByTestId("article-card").first()).toBeVisible();

  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;

    return {
      backgroundBrightness: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
    };
  });
}

const CASES = [
  { colorScheme: "light", label: "ライト", maxBrightness: 1, minBrightness: 0.8 },
  { colorScheme: "dark", label: "ダーク", maxBrightness: 0.2, minBrightness: 0 },
] as const;

for (const { colorScheme, label, minBrightness, maxBrightness } of CASES) {
  test.describe(`${label}を選好するブラウザ`, () => {
    test.use({ colorScheme });

    test(`画面が${label}配色で描画されること`, async ({ page }) => {
      const theme = await readTheme(page);

      expect(theme.backgroundBrightness).toBeGreaterThanOrEqual(minBrightness);
      expect(theme.backgroundBrightness).toBeLessThanOrEqual(maxBrightness);
    });

    test("日付ピッカーなどのネイティブ UI も同じ配色で描かれること", async ({ page }) => {
      const theme = await readTheme(page);

      // `normal` だと UA は常にライト前提で描くため、ダークでは
      // 日付ピッカーだけが白いまま浮いてしまう
      expect(theme.colorScheme).toBe("light dark");
    });
  });
}
