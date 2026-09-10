import { describe, it, expect, vi } from "vitest";
import {
  fetchAllArticlesForRescore,
  updateArticleScores,
  RescoreTarget,
} from "../../../src/pipeline/d1-sync";

const credentials = {
  accountId: "test-acc-id",
  databaseId: "test-db-id",
  apiToken: "test-token",
};

function queryResponse(rows: unknown[]) {
  return {
    ok: true,
    json: async () => ({ success: true, result: [{ results: rows }] }),
  } as unknown as Response;
}

describe("再スコアリング用の D1 アクセス (src/pipeline/d1-sync)", () => {
  describe("fetchAllArticlesForRescore - 既存記事の取得", () => {
    it("スコアリングに必要な列だけをオブジェクト形式で取得すること", async () => {
      const customFetch = vi.fn().mockResolvedValue(
        queryResponse([
          { id: "aaa", title: "記事A", summary: "要約A", score: 12 },
          { id: "bbb", title: "記事B", summary: null, score: 34 },
        ]),
      );

      const articles = await fetchAllArticlesForRescore({
        ...credentials,
        pageSize: 500,
        customFetch: customFetch as unknown as typeof fetch,
      });

      expect(articles).toEqual([
        { id: "aaa", title: "記事A", summary: "要約A", score: 12 },
        { id: "bbb", title: "記事B", summary: null, score: 34 },
      ]);

      // 行をオブジェクトで返す /query を使うこと (/raw は値の配列を返すため使えない)
      const [url, init] = customFetch.mock.calls[0];
      expect(url).toContain("/query");
      expect(JSON.parse(init.body).sql).toContain("SELECT id, title, summary, score FROM articles");
    });

    /**
     * 記事が増えても 1 レスポンスが肥大しないよう、id 順にページングする。
     * 最終ページの判定を誤ると無限ループするため境界を固定する。
     */
    it.each([
      [[2, 2, 1], 3, 5, "最終ページが pageSize 未満で打ち切られること"],
      [[2, 0], 2, 2, "最終ページがちょうど空になる場合も打ち切られること"],
      [[1], 1, 1, "1 ページで収まる場合は 1 回で終わること"],
      [[0], 1, 0, "1 件も無い場合も 1 回で終わること"],
    ])(
      "ページ毎の件数が %s のとき fetch が %s 回・合計 %s 件になること (%s)",
      async (pageCounts, expectedCalls, expectedTotal) => {
        let page = 0;
        const customFetch = vi.fn().mockImplementation(async () => {
          const count = pageCounts[page] ?? 0;
          const rows = Array.from({ length: count }, (_, i) => ({
            id: `p${page}-${i}`,
            title: `記事 ${page}-${i}`,
            summary: "要約",
            score: 10,
          }));
          page++;
          return queryResponse(rows);
        });

        const articles = await fetchAllArticlesForRescore({
          ...credentials,
          pageSize: 2,
          customFetch: customFetch as unknown as typeof fetch,
        });

        expect(customFetch).toHaveBeenCalledTimes(expectedCalls);
        expect(articles).toHaveLength(expectedTotal);
      },
    );

    it("直前のページの末尾 id をカーソルとして次ページを取得すること", async () => {
      let page = 0;
      const customFetch = vi.fn().mockImplementation(async () => {
        const rows =
          page === 0
            ? [
                { id: "id-1", title: "A", summary: null, score: 1 },
                { id: "id-2", title: "B", summary: null, score: 2 },
              ]
            : [];
        page++;
        return queryResponse(rows);
      });

      await fetchAllArticlesForRescore({
        ...credentials,
        pageSize: 2,
        customFetch: customFetch as unknown as typeof fetch,
      });

      expect(JSON.parse(customFetch.mock.calls[0][1].body).params).toEqual(["", 2]);
      expect(JSON.parse(customFetch.mock.calls[1][1].body).params).toEqual(["id-2", 2]);
    });

    it("HTTP エラー時に例外を投げること", async () => {
      const customFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "internal error",
      } as unknown as Response);

      await expect(
        fetchAllArticlesForRescore({
          ...credentials,
          customFetch: customFetch as unknown as typeof fetch,
        }),
      ).rejects.toThrow("D1 記事取得失敗");
    });

    it("認証情報が欠けている場合に例外を投げること", async () => {
      await expect(fetchAllArticlesForRescore({ ...credentials, apiToken: "" })).rejects.toThrow(
        "Cloudflare D1 設定エラー",
      );
    });
  });

  describe("updateArticleScores - スコアとベクトルの書き戻し", () => {
    const targets: RescoreTarget[] = [
      { id: "aaa", score: 72, embedding: new Float32Array(1024).fill(0.1) },
      { id: "bbb", score: 15, embedding: new Float32Array(1024).fill(0.2) },
    ];

    /**
     * 記事の同一性は id で確定しているため UPSERT ではなく UPDATE を使う。
     * published_at など他の列に触れてしまうと、公開日が壊れる。
     */
    it("id で対応付けて score と embedding のみを更新すること", async () => {
      const customFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      } as unknown as Response);

      const result = await updateArticleScores({
        ...credentials,
        targets,
        customFetch: customFetch as unknown as typeof fetch,
      });

      expect(result).toEqual({ total: 2, updated: 2 });

      const body = JSON.parse(customFetch.mock.calls[0][1].body);
      expect(body.sql).toContain("UPDATE articles");
      expect(body.sql).toContain("SET score = v.column2, embedding = v.column3");
      expect(body.sql).toContain("WHERE articles.id = v.column1");
      expect(body.sql).not.toContain("published_at");
      expect(body.params).toEqual(["aaa", 72, "bbb", 15]);
    });

    /**
     * D1 は複数ステートメントと params の併用を拒否する
     * ("The request is malformed: params with multiple statements is not supported")。
     * 以前は `UPDATE ...;` をバッチ件数だけ連結して送っており、端数の 1 件だけが通って
     * 残り全件が失敗していた（本番 2256 件中 1 件しか更新できなかった）。
     */
    it.each([
      [1, "1 件のバッチ"],
      [2, "複数件のバッチ"],
      [5, "既定のバッチサイズ"],
    ])("%s 件を送るときも 1 リクエスト 1 ステートメントであること (%s)", async (count) => {
      const customFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      } as unknown as Response);

      await updateArticleScores({
        ...credentials,
        targets: Array.from({ length: count }, (_, i) => ({
          id: `id-${i}`,
          score: i,
          embedding: new Float32Array(1024).fill(0.1),
        })),
        batchSize: count,
        customFetch: customFetch as unknown as typeof fetch,
      });

      const body = JSON.parse(customFetch.mock.calls[0][1].body);
      // 末尾のセミコロンを除くと、文の区切りが 1 つも残らないこと
      const withoutTrailing = body.sql.trim().replace(/;$/, "");
      expect(withoutTrailing).not.toContain(";");
      // 件数分の値タプルが 1 ステートメント内に並ぶこと
      expect(body.sql.match(/X'/g)).toHaveLength(count);
      expect(body.params).toHaveLength(count * 2);
    });

    it("埋め込みベクトルが 4096 バイトの BLOB リテラルとして送られること", async () => {
      const customFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      } as unknown as Response);

      await updateArticleScores({
        ...credentials,
        targets: [targets[0]],
        customFetch: customFetch as unknown as typeof fetch,
      });

      const body = JSON.parse(customFetch.mock.calls[0][1].body);
      const hex = body.sql.match(/X'([0-9a-f]+)'/)![1];
      // 1024 次元 × 4 バイト = 4096 バイト → 16 進表記で 8192 文字
      expect(hex).toHaveLength(8192);
    });

    /**
     * SQLite の VALUES 句は列名を column1, column2, ... で参照する。
     * `AS v(id, score, embedding)` の列名指定構文は SQLite には無いため、
     * それを使うと構文エラーになる。
     */
    it("VALUES 句に SQLite が解釈できない列名指定構文を使わないこと", async () => {
      const customFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      } as unknown as Response);

      await updateArticleScores({
        ...credentials,
        targets,
        customFetch: customFetch as unknown as typeof fetch,
      });

      const body = JSON.parse(customFetch.mock.calls[0][1].body);
      expect(body.sql).toContain(") AS v\n");
      expect(body.sql).not.toMatch(/AS\s+v\s*\(/);
    });

    it("バッチサイズ毎にリクエストが分割されること", async () => {
      const customFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      } as unknown as Response);

      const result = await updateArticleScores({
        ...credentials,
        targets,
        batchSize: 1,
        customFetch: customFetch as unknown as typeof fetch,
      });

      expect(customFetch).toHaveBeenCalledTimes(2);
      expect(result.updated).toBe(2);
    });

    it("対象が空の場合はリクエストを送らないこと", async () => {
      const customFetch = vi.fn();

      const result = await updateArticleScores({
        ...credentials,
        targets: [],
        customFetch: customFetch as unknown as typeof fetch,
      });

      expect(customFetch).not.toHaveBeenCalled();
      expect(result).toEqual({ total: 0, updated: 0 });
    });

    it("D1 がエラーを返した場合に errors へ集約し、更新件数に数えないこと", async () => {
      const customFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: false, errors: [{ message: "constraint failed" }] }),
      } as unknown as Response);

      const result = await updateArticleScores({
        ...credentials,
        targets,
        customFetch: customFetch as unknown as typeof fetch,
      });

      expect(result.updated).toBe(0);
      expect(result.errors).toEqual([{ message: "constraint failed" }]);
    });
  });
});
