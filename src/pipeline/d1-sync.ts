import { ArticleInput, computePublishedDateJst, serializeVector } from "../server/db/articles";

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

const UPSERT_STATEMENT = `
INSERT INTO articles (
  id, title, url, source_name, summary, score, published_at, published_date_jst, embedding
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(url) DO UPDATE SET
  title = excluded.title,
  source_name = excluded.source_name,
  summary = excluded.summary,
  score = excluded.score,
  published_at = excluded.published_at,
  published_date_jst = excluded.published_date_jst,
  embedding = COALESCE(excluded.embedding, articles.embedding);
`.trim();

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

    const sql = Array(chunk.length).fill(UPSERT_STATEMENT).join("\n");
    const params: unknown[] = [];

    for (const article of chunk) {
      const publishedDateJst =
        article.published_date_jst ?? computePublishedDateJst(article.published_at);
      const serializedEmbedding = article.embedding
        ? Array.from(serializeVector(article.embedding))
        : null;

      params.push(
        article.id,
        article.title,
        article.url,
        article.source_name,
        article.summary ?? null,
        article.score,
        article.published_at,
        publishedDateJst,
        serializedEmbedding,
      );
    }

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
