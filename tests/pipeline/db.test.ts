import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  initDailyDatabase,
  initLocalDatabase,
  initSearchIndexDatabase,
  getExistingArticleIds,
  getExistingSearchIndexIds,
  insertArticles,
  insertVectors,
  upsertArticlesLocal,
  getArticlesByScore,
  getAllSearchVectors,
} from "../../src/pipeline/db";
import { Article } from "../../src/shared/types";
import { ArticleInput } from "../../src/server/db/articles";

describe("SQLite データベース操作モジュール (src/pipeline/db) のテスト", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rss-news-site-db-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("日別データベース (Daily Database)", () => {
    it("指定したファイルパス（深い階層のディレクトリ含む）に日別DBを初期化し、テーブルとインデックスを作成できること", () => {
      const dbPath = path.join(tempDir, "deep", "nested", "data", "2026-08-19.db");
      const db = initDailyDatabase(dbPath);

      try {
        expect(fs.existsSync(dbPath)).toBe(true);

        // テーブル存在確認
        const tableInfo = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='articles'")
          .get() as { name: string } | undefined;
        expect(tableInfo?.name).toBe("articles");

        // インデックス存在確認
        const indexInfo = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_articles_score'",
          )
          .get() as { name: string } | undefined;
        expect(indexInfo?.name).toBe("idx_articles_score");

        // カラム定義の確認
        const columns = db.pragma("table_info(articles)") as Array<{
          name: string;
          type: string;
          pk: number;
        }>;
        const columnMap = new Map(columns.map((c) => [c.name, c]));

        expect(columnMap.get("id")?.type).toBe("TEXT");
        expect(columnMap.get("id")?.pk).toBe(1);
        expect(columnMap.get("title")?.type).toBe("TEXT");
        expect(columnMap.get("url")?.type).toBe("TEXT");
        expect(columnMap.get("source_name")?.type).toBe("TEXT");
        expect(columnMap.get("summary")?.type).toBe("TEXT");
        expect(columnMap.get("score")?.type).toBe("INTEGER");
        expect(columnMap.get("published_at")?.type).toBe("TEXT");
      } finally {
        db.close();
      }
    });

    it("既存の日別DBに対して initDailyDatabase を再実行しても冪等に動作しデータが維持されること", () => {
      const dbPath = path.join(tempDir, "idempotent.db");
      let db = initDailyDatabase(dbPath);
      const article: Article = {
        id: "art-persist",
        title: "永続化テスト記事",
        url: "https://example.com/persist",
        source_name: "Test Source",
        summary: "永続化確認用要約",
        score: 88,
        published_at: "2026-08-19T00:00:00.000Z",
      };

      insertArticles(db, [article]);
      db.close();

      // 再オープン
      db = initDailyDatabase(dbPath);
      try {
        const articles = getArticlesByScore(db);
        expect(articles).toHaveLength(1);
        expect(articles[0].id).toBe("art-persist");
        expect(articles[0].title).toBe("永続化テスト記事");
      } finally {
        db.close();
      }
    });

    it("空のデータベースから既存記事IDセットを取得した場合、空のSetを返すこと", () => {
      const dbPath = path.join(tempDir, "empty.db");
      const db = initDailyDatabase(dbPath);

      try {
        const ids = getExistingArticleIds(db);
        expect(ids).toBeInstanceOf(Set);
        expect(ids.size).toBe(0);
      } finally {
        db.close();
      }
    });

    it("記事リストを一括挿入し、getExistingArticleIds で全IDを取得できること", () => {
      const dbPath = path.join(tempDir, "articles.db");
      const db = initDailyDatabase(dbPath);

      const articles: Article[] = [
        {
          id: "id-001",
          title: "TypeScript 5.8 の新機能",
          url: "https://example.com/ts-58",
          source_name: "Tech Blog",
          summary: "TypeScript 5.8の主な変更点についてのまとめ",
          score: 85,
          published_at: "2026-08-19T07:00:00.000Z",
        },
        {
          id: "id-002",
          title: "Cloudflare R2 の活用法",
          url: "https://example.com/cloudflare-r2",
          source_name: "Cloud News",
          summary: "Egress無料のR2を活用したアーキテクチャ設計",
          score: 92,
          published_at: "2026-08-19T08:30:00.000Z",
        },
      ];

      try {
        insertArticles(db, articles);

        const ids = getExistingArticleIds(db);
        expect(ids.size).toBe(2);
        expect(ids.has("id-001")).toBe(true);
        expect(ids.has("id-002")).toBe(true);
        expect(ids.has("id-999")).toBe(false);
      } finally {
        db.close();
      }
    });

    it("getArticlesByScore で記事がスコア降順にソートされて取得できること", () => {
      const dbPath = path.join(tempDir, "scores.db");
      const db = initDailyDatabase(dbPath);

      const articles: Article[] = [
        {
          id: "id-low",
          title: "低スコア記事",
          url: "https://example.com/low",
          source_name: "Source A",
          summary: "スコア30の記事",
          score: 30,
          published_at: "2026-08-19T01:00:00.000Z",
        },
        {
          id: "id-high",
          title: "最高スコア記事",
          url: "https://example.com/high",
          source_name: "Source B",
          summary: "スコア98の記事",
          score: 98,
          published_at: "2026-08-19T02:00:00.000Z",
        },
        {
          id: "id-mid",
          title: "中スコア記事",
          url: "https://example.com/mid",
          source_name: "Source C",
          summary: "スコア75の記事",
          score: 75,
          published_at: "2026-08-19T03:00:00.000Z",
        },
      ];

      try {
        insertArticles(db, articles);

        const results = getArticlesByScore(db);
        expect(results).toHaveLength(3);
        expect(results[0].id).toBe("id-high");
        expect(results[0].score).toBe(98);
        expect(results[1].id).toBe("id-mid");
        expect(results[1].score).toBe(75);
        expect(results[2].id).toBe("id-low");
        expect(results[2].score).toBe(30);

        // 各フィールドの型と値の正確性を検証
        expect(results[0]).toEqual({
          id: "id-high",
          title: "最高スコア記事",
          url: "https://example.com/high",
          source_name: "Source B",
          summary: "スコア98の記事",
          score: 98,
          published_at: "2026-08-19T02:00:00.000Z",
        });
      } finally {
        db.close();
      }
    });

    it("同一IDの記事を再挿入した際に情報が正常に更新（REPLACE）されること", () => {
      const dbPath = path.join(tempDir, "replace.db");
      const db = initDailyDatabase(dbPath);

      const initialArticle: Article = {
        id: "id-update",
        title: "更新前のタイトル",
        url: "https://example.com/update",
        source_name: "Old Source",
        summary: "初期要約",
        score: 50,
        published_at: "2026-08-19T00:00:00.000Z",
      };

      const updatedArticle: Article = {
        id: "id-update",
        title: "更新後の最新タイトル",
        url: "https://example.com/update",
        source_name: "New Source",
        summary: "再生成された最新要約",
        score: 95,
        published_at: "2026-08-19T05:00:00.000Z",
      };

      try {
        insertArticles(db, [initialArticle]);
        expect(getArticlesByScore(db)[0].title).toBe("更新前のタイトル");

        insertArticles(db, [updatedArticle]);
        const articles = getArticlesByScore(db);
        expect(articles).toHaveLength(1);
        expect(articles[0].title).toBe("更新後の最新タイトル");
        expect(articles[0].score).toBe(95);
        expect(articles[0].summary).toBe("再生成された最新要約");
      } finally {
        db.close();
      }
    });

    it("空の記事配列を挿入した場合に例外が発生せず安全に終了すること", () => {
      const dbPath = path.join(tempDir, "empty-insert.db");
      const db = initDailyDatabase(dbPath);

      try {
        expect(() => insertArticles(db, [])).not.toThrow();
        expect(getArticlesByScore(db)).toEqual([]);
      } finally {
        db.close();
      }
    });
  });

  describe("ローカル D1 互換データベース (upsertArticlesLocal)", () => {
    it("同一 URL の記事を再 upsert しても公開日時が後の日付へ前進しないこと", () => {
      const dbPath = path.join(tempDir, "local_articles.db");
      const db = initLocalDatabase(dbPath);

      const initialArticle: ArticleInput = {
        id: "local-keep-date",
        title: "初回タイトル",
        url: "https://example.com/local-keep-date",
        source_name: "Source",
        summary: "初回要約",
        score: 65,
        published_at: "2026-08-25T01:00:00.000Z",
        published_date_jst: "2026-08-25",
      };

      try {
        upsertArticlesLocal(db, [initialArticle]);
        upsertArticlesLocal(db, [
          {
            ...initialArticle,
            title: "再巡回後タイトル",
            published_at: "2026-08-28T01:00:00.000Z",
            published_date_jst: "2026-08-28",
          },
        ]);

        const row = db
          .prepare("SELECT title, published_at, published_date_jst FROM articles WHERE url = ?")
          .get("https://example.com/local-keep-date") as {
          title: string;
          published_at: string;
          published_date_jst: string;
        };

        expect(row.title).toBe("再巡回後タイトル");
        expect(row.published_at).toBe("2026-08-25T01:00:00.000Z");
        expect(row.published_date_jst).toBe("2026-08-25");
      } finally {
        db.close();
      }
    });
  });

  describe("全体検索インデックスデータベース (Search Index Database)", () => {
    it("指定したファイルパス（深い階層のディレクトリ含む）に全体検索DBを初期化し、テーブルとインデックスを作成できること", () => {
      const dbPath = path.join(tempDir, "deep", "nested", "search_index.db");
      const db = initSearchIndexDatabase(dbPath);

      try {
        expect(fs.existsSync(dbPath)).toBe(true);

        // テーブル存在確認
        const tableInfo = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='search_index'")
          .get() as { name: string } | undefined;
        expect(tableInfo?.name).toBe("search_index");

        // インデックス存在確認
        const indexInfo = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_search_index_date'",
          )
          .get() as { name: string } | undefined;
        expect(indexInfo?.name).toBe("idx_search_index_date");

        // カラム定義の確認
        const columns = db.pragma("table_info(search_index)") as Array<{
          name: string;
          type: string;
          pk: number;
        }>;
        const columnMap = new Map(columns.map((c) => [c.name, c]));

        expect(columnMap.get("article_id")?.type).toBe("TEXT");
        expect(columnMap.get("article_id")?.pk).toBe(1);
        expect(columnMap.get("date")?.type).toBe("TEXT");
        expect(columnMap.get("embedding")?.type).toBe("BLOB");
      } finally {
        db.close();
      }
    });

    it("384次元の Float32Array ベクトル（オフセット付きを含む）を BLOB として保存し、完全一致で復元できること", () => {
      const dbPath = path.join(tempDir, "vector_test.db");
      const db = initSearchIndexDatabase(dbPath);

      // 384次元のテスト用 Float32Array を作成（正・負・小数・境界値を含む）
      const dim = 384;
      const embedding1 = new Float32Array(dim);
      for (let i = 0; i < dim; i++) {
        embedding1[i] = Math.sin(i) * 0.5;
      }

      // オフセット付きの Float32Array（大きなバッファの一部）をテスト
      const largeBuffer = new ArrayBuffer(dim * 4 * 2);
      const embedding2 = new Float32Array(largeBuffer, dim * 4, dim);
      for (let i = 0; i < dim; i++) {
        embedding2[i] = Math.cos(i) * 0.5;
      }

      const items = [
        {
          article_id: "art-001",
          date: "2026-08-19",
          embedding: embedding1,
        },
        {
          article_id: "art-002",
          date: "2026-08-18",
          embedding: embedding2,
        },
      ];

      try {
        insertVectors(db, items);

        const results = getAllSearchVectors(db);
        expect(results).toHaveLength(2);

        const item1 = results.find((r) => r.article_id === "art-001");
        const item2 = results.find((r) => r.article_id === "art-002");

        expect(item1).toBeDefined();
        expect(item1?.date).toBe("2026-08-19");
        expect(item1?.embedding).toBeInstanceOf(Float32Array);
        expect(item1?.embedding.length).toBe(384);

        // 384次元すべての要素が完全一致することを確認
        for (let i = 0; i < dim; i++) {
          expect(item1!.embedding[i]).toBeCloseTo(embedding1[i], 6);
        }

        expect(item2).toBeDefined();
        expect(item2?.date).toBe("2026-08-18");
        expect(item2?.embedding).toBeInstanceOf(Float32Array);
        expect(item2?.embedding.length).toBe(384);

        for (let i = 0; i < dim; i++) {
          expect(item2!.embedding[i]).toBeCloseTo(embedding2[i], 6);
        }
      } finally {
        db.close();
      }
    });

    it("同一 article_id のベクトルを再挿入した際に上書き（REPLACE）されること", () => {
      const dbPath = path.join(tempDir, "vector_replace.db");
      const db = initSearchIndexDatabase(dbPath);

      const oldVec = new Float32Array(384).fill(0.1);
      const newVec = new Float32Array(384).fill(0.9);

      try {
        insertVectors(db, [
          {
            article_id: "art-same",
            date: "2026-08-19",
            embedding: oldVec,
          },
        ]);

        let vectors = getAllSearchVectors(db);
        expect(vectors).toHaveLength(1);
        expect(vectors[0].embedding[0]).toBeCloseTo(0.1, 6);

        insertVectors(db, [
          {
            article_id: "art-same",
            date: "2026-08-20",
            embedding: newVec,
          },
        ]);

        vectors = getAllSearchVectors(db);
        expect(vectors).toHaveLength(1);
        expect(vectors[0].date).toBe("2026-08-20");
        expect(vectors[0].embedding[0]).toBeCloseTo(0.9, 6);
      } finally {
        db.close();
      }
    });

    it("空のベクトル配列を挿入した場合に例外が発生せず安全に終了すること", () => {
      const dbPath = path.join(tempDir, "empty_vec.db");
      const db = initSearchIndexDatabase(dbPath);

      try {
        expect(() => insertVectors(db, [])).not.toThrow();
        expect(getAllSearchVectors(db)).toEqual([]);
      } finally {
        db.close();
      }
    });

    it("getExistingSearchIndexIds で search_index テーブル内の全 article_id を Set として取得できること", () => {
      const dbPath = path.join(tempDir, "search_ids.db");
      const db = initSearchIndexDatabase(dbPath);

      try {
        // 空DBの確認
        let ids = (db as any).getExistingSearchIndexIds
          ? (db as any).getExistingSearchIndexIds(db)
          : getExistingSearchIndexIds(db);
        expect(ids).toBeInstanceOf(Set);
        expect(ids.size).toBe(0);

        insertVectors(db, [
          {
            article_id: "art-101",
            date: "2026-08-18",
            embedding: new Float32Array(384),
          },
          {
            article_id: "art-102",
            date: "2026-08-19",
            embedding: new Float32Array(384),
          },
        ]);

        ids = getExistingSearchIndexIds(db);
        expect(ids.size).toBe(2);
        expect(ids.has("art-101")).toBe(true);
        expect(ids.has("art-102")).toBe(true);
        expect(ids.has("art-999")).toBe(false);
      } finally {
        db.close();
      }
    });
  });

  describe("トランザクションとエラー処理の堅牢性", () => {
    it("insertArticles の途中で異常が発生した場合にロールバックされデータが壊れないこと", () => {
      const dbPath = path.join(tempDir, "rollback_article.db");
      const db = initDailyDatabase(dbPath);

      const validArticle: Article = {
        id: "valid-1",
        title: "正常記事",
        url: "https://example.com/ok",
        source_name: "Source",
        summary: "要約",
        score: 80,
        published_at: "2026-08-19T00:00:00.000Z",
      };

      const invalidArticle = {
        id: "invalid-2",
        title: null as unknown as string, // NOT NULL制約違反
        url: "https://example.com/ng",
        source_name: "Source",
        summary: "要約",
        score: 50,
        published_at: "2026-08-19T00:00:00.000Z",
      } as Article;

      try {
        expect(() => {
          insertArticles(db, [validArticle, invalidArticle]);
        }).toThrow();

        // ロールバックされて1件も挿入されていないこと
        const articles = getArticlesByScore(db);
        expect(articles).toHaveLength(0);
      } finally {
        db.close();
      }
    });

    it("insertVectors の途中で異常が発生した場合にロールバックされデータが壊れないこと", () => {
      const dbPath = path.join(tempDir, "rollback_vector.db");
      const db = initSearchIndexDatabase(dbPath);

      const validItem = {
        article_id: "vec-valid-1",
        date: "2026-08-19",
        embedding: new Float32Array(384),
      };

      const invalidItem = {
        article_id: "vec-invalid-2",
        date: null as unknown as string, // NOT NULL制約違反
        embedding: new Float32Array(384),
      };

      try {
        expect(() => {
          insertVectors(db, [validItem, invalidItem]);
        }).toThrow();

        const vectors = getAllSearchVectors(db);
        expect(vectors).toHaveLength(0);
      } finally {
        db.close();
      }
    });
  });
});
