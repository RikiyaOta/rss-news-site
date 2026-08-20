import { ArticleInput, computePublishedDateJst } from "../server/db/articles";

export interface D1SyncOptions {
  accountId: string;
  databaseId: string;
  apiToken: string;
  articles: ArticleInput[];
  batchSize?: number; // default: 25
  customFetch?: typeof fetch;
}

export interface D1SyncResult {
  total: number;
  inserted: number;
  errors?: any[];
}

export const SCHEMA_STATEMENTS = `
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  source_name TEXT NOT NULL,
  summary TEXT,
  score REAL NOT NULL,
  published_at TEXT NOT NULL,
  published_date_jst TEXT NOT NULL,
  embedding BLOB,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_articles_jst_score ON articles(published_date_jst, score DESC);
CREATE INDEX IF NOT EXISTS idx_articles_url ON articles(url);
CREATE INDEX IF NOT EXISTS idx_articles_score ON articles(score DESC);
`.trim();

export function uint8ArrayToHex(uint8: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < uint8.length; i++) {
    hex += uint8[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Cloudflare D1 に既に登録されている記事の URL 一覧を取得する（重複スコアリング計算のスキップ用）
 */
export async function fetchExistingUrlsFromD1(
  options: Pick<D1SyncOptions, "accountId" | "databaseId" | "apiToken" | "customFetch"> & {
    sinceDateJst?: string;
  },
): Promise<Set<string>> {
  const { accountId, databaseId, apiToken, sinceDateJst } = options;
  if (!accountId || !databaseId || !apiToken) return new Set();

  const fetchFn = options.customFetch ?? fetch;
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/raw`;

  const sql = sinceDateJst
    ? "SELECT url FROM articles WHERE published_date_jst >= ?;"
    : "SELECT url FROM articles;";
  const params = sinceDateJst ? [sinceDateJst] : [];

  try {
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    });

    if (!response.ok) return new Set();
    const resData = (await response.json()) as any;
    const results = resData?.result?.[0]?.results ?? [];
    const urlSet = new Set<string>();
    for (const row of results) {
      if (typeof row?.url === "string" && row.url) {
        urlSet.add(row.url);
      }
    }
    return urlSet;
  } catch {
    return new Set();
  }
}

/**
 * Cloudflare D1 のテーブルおよびインデックススキーマを自動作成・初期化する
 */
export async function ensureD1Schema(
  options: Pick<D1SyncOptions, "accountId" | "databaseId" | "apiToken" | "customFetch">,
): Promise<void> {
  const { accountId, databaseId, apiToken } = options;
  const fetchFn = options.customFetch ?? fetch;
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/raw`;

  const response = await fetchFn(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql: SCHEMA_STATEMENTS }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`D1 スキーマ初期化失敗: ${response.status} ${errorText}`);
  }
}

/**
 * Cloudflare D1 REST API (/raw) を用いて記事データをバッチ同期 (UPSERT) する
 */
export async function syncArticlesToD1(options: D1SyncOptions): Promise<D1SyncResult> {
  const { accountId, databaseId, apiToken, articles, batchSize = 25 } = options;

  if (
    !accountId ||
    !accountId.trim() ||
    !databaseId ||
    !databaseId.trim() ||
    !apiToken ||
    !apiToken.trim()
  ) {
    throw new Error("Cloudflare D1 設定エラー: accountId, databaseId, apiToken が必要です");
  }

  if (!articles || articles.length === 0) {
    return { total: 0, inserted: 0 };
  }

  const fetchFn = options.customFetch ?? fetch;
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/raw`;

  let inserted = 0;
  const errors: any[] = [];

  for (let i = 0; i < articles.length; i += batchSize) {
    const chunk = articles.slice(i, i + batchSize);
    const valuePlaceholders: string[] = [];
    const params: unknown[] = [];

    for (const article of chunk) {
      const publishedDateJst =
        article.published_date_jst ?? computePublishedDateJst(article.published_at);

      let blobLiteral = "NULL";
      if (article.embedding) {
        const uint8 = new Uint8Array(
          article.embedding.buffer,
          article.embedding.byteOffset,
          article.embedding.byteLength,
        );
        blobLiteral = `X'${uint8ArrayToHex(uint8)}'`;
      }

      valuePlaceholders.push(`(?, ?, ?, ?, ?, ?, ?, ?, ${blobLiteral})`);
      params.push(
        article.id,
        article.title,
        article.url,
        article.source_name,
        article.summary ?? null,
        article.score,
        article.published_at,
        publishedDateJst,
      );
    }

    const sql = `
INSERT INTO articles (
  id, title, url, source_name, summary, score, published_at, published_date_jst, embedding
) VALUES
  ${valuePlaceholders.join(",\n  ")}
ON CONFLICT(url) DO UPDATE SET
  title = excluded.title,
  source_name = excluded.source_name,
  summary = excluded.summary,
  score = excluded.score,
  published_at = excluded.published_at,
  published_date_jst = excluded.published_date_jst,
  embedding = COALESCE(excluded.embedding, articles.embedding);
`.trim();

    try {
      const response = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql, params }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        let errorJson: any;
        try {
          errorJson = JSON.parse(errorText);
        } catch {
          errorJson = {
            message: errorText || `HTTP ${response.status} ${response.statusText}`,
            status: response.status,
          };
        }
        errors.push(errorJson);
      } else {
        const resData = (await response.json()) as any;
        if (resData.success === false) {
          errors.push(...(resData.errors ?? [{ message: "D1 sync returned success=false" }]));
        } else {
          inserted += chunk.length;
        }
      }
    } catch (err: any) {
      errors.push({ message: err?.message || String(err) });
    }
  }

  return {
    total: articles.length,
    inserted,
    ...(errors.length > 0 ? { errors } : {}),
  };
}
