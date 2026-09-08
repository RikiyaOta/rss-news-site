import { test, expect } from "@playwright/test";
import { TODAY, TODAY_ARTICLES } from "./fixtures/articles";

/**
 * 配信経路そのものの E2E。
 *
 * 本番ビルド (dist/) が Workers の ASSETS バインディング経由で配信され、
 * /api/* は Worker が処理する、という本番と同じ振り分けを検証する。
 * 従来の Vite dev サーバー + API モック構成では一切確認できなかった領域。
 */
test.describe("Worker による配信", () => {
  test("@smoke ヘルスチェックが応答すること", async ({ request }) => {
    const res = await request.get("/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("@smoke 本番ビルドの静的アセットが配信され、SPA が起動すること", async ({ page }) => {
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/RSS News for Me/);

    // バンドルが実際に実行され、React が描画まで到達していること
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("article-card").first()).toBeVisible();
  });

  test("JavaScript バンドルが 200 で取得できること", async ({ page }) => {
    const failed: string[] = [];
    page.on("response", (res) => {
      if (res.url().includes("/assets/") && !res.ok()) {
        failed.push(`${res.status()} ${res.url()}`);
      }
    });

    await page.goto("/");
    await expect(page.getByTestId("article-card").first()).toBeVisible();

    expect(failed).toEqual([]);
  });

  test("/api/articles が D1 の実データを返すこと", async ({ request }) => {
    const res = await request.get(`/api/articles?date=${TODAY}`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.date).toBe(TODAY);
    expect(body.total).toBe(TODAY_ARTICLES.length);
    // スコア降順
    const scores = body.articles.map((a: { score: number }) => a.score);
    expect(scores).toEqual([...scores].sort((a: number, b: number) => b - a));
    // 埋め込みベクトルは API レスポンスに含めない
    expect(body.articles[0]).not.toHaveProperty("embedding");
  });

  test("/api/search がクエリ必須のバリデーションを行うこと", async ({ request }) => {
    const res = await request.get("/api/search");
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ error: "検索クエリ 'q' は必須です" });
  });

  test("ブラウザのコンソールにエラーが出ていないこと", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await expect(page.getByTestId("article-card").first()).toBeVisible();

    expect(errors).toEqual([]);
  });
});
