import { Hono } from "hono";
import {
  getArticlesByPublishedDate,
  searchArticlesByVector,
  D1DatabaseLike,
} from "./db/articles.ts";

/**
 * Cloudflare Workers 環境バインディングの型定義
 */
export interface Bindings {
  DB: D1DatabaseLike | any;
  AI: any;
  ASSETS?: any;
}

/**
 * 現在の日本時間 (JST: UTC+9) の日付文字列 (YYYY-MM-DD) を取得する
 */
export function getCurrentJstDate(): string {
  const now = new Date();
  const jstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = jstDate.getUTCFullYear();
  const mm = String(jstDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(jstDate.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Workers AI のレスポンスから Float32Array 埋め込みベクトルを抽出する
 */
export function extractEmbeddingVector(aiRes: any): Float32Array {
  if (aiRes instanceof Float32Array) {
    return aiRes;
  }
  if (Array.isArray(aiRes)) {
    const first = aiRes[0];
    if (Array.isArray(first) || first instanceof Float32Array) {
      return new Float32Array(first);
    }
    return new Float32Array(aiRes);
  }
  if (aiRes && aiRes.data) {
    if (aiRes.data instanceof Float32Array) {
      return aiRes.data;
    }
    if (Array.isArray(aiRes.data)) {
      const first = aiRes.data[0];
      if (Array.isArray(first) || first instanceof Float32Array) {
        return new Float32Array(first);
      }
      return new Float32Array(aiRes.data);
    }
  }
  throw new Error("Invalid AI embedding response format");
}

const app = new Hono<{ Bindings: Bindings }>();

// グローバルエラーハンドラ
app.onError((err, c) => {
  return c.json({ error: err.message || "Internal Server Error" }, 500);
});

// GET /health
app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

// GET /api/articles
app.get("/api/articles", async (c) => {
  const dateParam = c.req.query("date");
  const date = dateParam && dateParam.trim() ? dateParam.trim() : getCurrentJstDate();

  const limitParam = c.req.query("limit");
  const offsetParam = c.req.query("offset");

  const limit = limitParam ? parseInt(limitParam, 10) : 50;
  const offset = offsetParam ? parseInt(offsetParam, 10) : 0;

  const articles = await getArticlesByPublishedDate(c.env.DB, date, {
    limit: isNaN(limit) ? 50 : limit,
    offset: isNaN(offset) ? 0 : offset,
  });

  return c.json({
    date,
    total: articles.length,
    articles,
  });
});

// GET /api/search
app.get("/api/search", async (c) => {
  const q = c.req.query("q");
  if (!q || !q.trim()) {
    return c.json({ error: "検索クエリ 'q' は必須です" }, 400);
  }

  const query = q.trim();
  const limitParam = c.req.query("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 30;

  const aiRes = await c.env.AI.run("@cf/baai/bge-m3", { text: query });
  const queryVector = extractEmbeddingVector(aiRes);

  const results = await searchArticlesByVector(c.env.DB, queryVector, {
    limit: isNaN(limit) ? 30 : limit,
  });

  return c.json({
    query,
    total: results.length,
    results,
  });
});

export default app;
