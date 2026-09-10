import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ArticleInput, computePublishedDateJst } from "../server/db/articles";

export interface D1SyncOptions {
  accountId: string;
  databaseId: string;
  apiToken: string;
  articles: ArticleInput[];
  batchSize?: number; // default: 5 (100KB SQLITE_MAX_SQL_LENGTH 制約に対応)
  customFetch?: typeof fetch;
}

export interface D1SyncResult {
  total: number;
  inserted: number;
  errors?: any[];
}

/** 再スコアリング対象として D1 から読み出す記事 */
export interface RescoreSource {
  id: string;
  title: string;
  summary: string | null;
  score: number;
}

/** 再スコアリング結果として D1 へ書き戻す値 */
export interface RescoreTarget {
  id: string;
  score: number;
  embedding: Float32Array;
}

export interface RescoreUpdateResult {
  total: number;
  updated: number;
  errors?: any[];
}

/** migrations/ ディレクトリ (本番 D1 へ wrangler が適用するものと同一) */
const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);

/**
 * migrations/ 配下の SQL をファイル名順に連結して返す。
 *
 * スキーマ定義を複数箇所に持つとテストと本番で食い違うため、
 * wrangler が適用する migrations/ を唯一の正とし、ここから読み出す。
 */
export function readMigrationStatements(migrationsDir: string = MIGRATIONS_DIR): string {
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => fs.readFileSync(path.join(migrationsDir, file), "utf-8"))
    .join("\n")
    .trim();
}

export function uint8ArrayToHex(uint8: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < uint8.length; i++) {
    hex += uint8[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Cloudflare D1 に既に登録されている記事の URL 一覧を取得する（重複スコアリング計算のスキップ用）。
 *
 * NOTE: 必ず /query エンドポイントを使うこと。
 * 書き込みで使っている /raw は行を「値の配列」で返し、カラム名は別フィールドになるため、
 * `row.url` ではアクセスできない。以前は /raw を叩きながら /query の形（オブジェクトの配列）で
 * パースしていたため、URL が 1 件も集まらず重複排除が常に無効化されていた。
 * さらに例外を握りつぶしていたので、失敗が表に出ないまま同じ記事を再スコアリング・再同期し続けていた。
 */
export async function fetchExistingUrlsFromD1(
  options: Pick<D1SyncOptions, "accountId" | "databaseId" | "apiToken" | "customFetch"> & {
    sinceDateJst?: string;
  },
): Promise<Set<string>> {
  const { accountId, databaseId, apiToken, sinceDateJst } = options;
  if (!accountId || !databaseId || !apiToken) return new Set();

  const fetchFn = options.customFetch ?? fetch;
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

  const sql = sinceDateJst
    ? "SELECT url FROM articles WHERE published_date_jst >= ?;"
    : "SELECT url FROM articles;";
  const params = sinceDateJst ? [sinceDateJst] : [];

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
    throw new Error(`D1 既存 URL 照会失敗: ${response.status} ${errorText}`);
  }

  const resData = (await response.json()) as any;
  if (resData?.success === false) {
    throw new Error(`D1 既存 URL 照会失敗: ${JSON.stringify(resData?.errors ?? [])}`);
  }

  const rows = resData?.result?.[0]?.results;
  if (!Array.isArray(rows)) {
    throw new Error(
      `D1 既存 URL 照会のレスポンス形式が想定と異なります: ${JSON.stringify(resData)?.slice(0, 200)}`,
    );
  }

  const urlSet = new Set<string>();
  for (const row of rows) {
    if (typeof row?.url === "string" && row.url) {
      urlSet.add(row.url);
    }
  }
  return urlSet;
}

/**
 * 再スコアリングのため、D1 の全記事からスコアリングに必要な列だけを取得する。
 *
 * 件数が増えても 1 回のレスポンスが肥大しないよう id 順にページングする。
 * embedding (BLOB 4096バイト) は再生成するので読み出さない。
 */
export async function fetchAllArticlesForRescore(
  options: Pick<D1SyncOptions, "accountId" | "databaseId" | "apiToken" | "customFetch"> & {
    pageSize?: number;
  },
): Promise<RescoreSource[]> {
  const { accountId, databaseId, apiToken, pageSize = 500 } = options;
  if (!accountId || !databaseId || !apiToken) {
    throw new Error("Cloudflare D1 設定エラー: accountId, databaseId, apiToken が必要です");
  }

  const fetchFn = options.customFetch ?? fetch;
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

  const articles: RescoreSource[] = [];
  let lastId = "";

  for (;;) {
    // NOTE: fetchExistingUrlsFromD1 と同じく、行をオブジェクトで返す /query を使う。
    // /raw は行を値の配列で返すため row.title ではアクセスできない。
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sql: "SELECT id, title, summary, score FROM articles WHERE id > ? ORDER BY id LIMIT ?;",
        params: [lastId, pageSize],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`D1 記事取得失敗: ${response.status} ${errorText}`);
    }

    const resData = (await response.json()) as any;
    if (resData?.success === false) {
      throw new Error(`D1 記事取得失敗: ${JSON.stringify(resData?.errors ?? [])}`);
    }

    const rows = resData?.result?.[0]?.results;
    if (!Array.isArray(rows)) {
      throw new Error(
        `D1 記事取得のレスポンス形式が想定と異なります: ${JSON.stringify(resData)?.slice(0, 200)}`,
      );
    }

    for (const row of rows) {
      if (typeof row?.id !== "string" || !row.id) continue;
      articles.push({
        id: row.id,
        title: typeof row.title === "string" ? row.title : "",
        summary: typeof row.summary === "string" ? row.summary : null,
        score: typeof row.score === "number" ? row.score : 0,
      });
      lastId = row.id;
    }

    if (rows.length < pageSize) break;
  }

  return articles;
}

/**
 * 再スコアリング結果 (score と embedding) を D1 へ書き戻す。
 *
 * 記事の同一性は id で確定しているため UPSERT ではなく UPDATE を使う。
 * published_at など他の列には触れない。
 */
export async function updateArticleScores(
  options: Pick<D1SyncOptions, "accountId" | "databaseId" | "apiToken" | "customFetch"> & {
    targets: RescoreTarget[];
    batchSize?: number;
  },
): Promise<RescoreUpdateResult> {
  const { accountId, databaseId, apiToken, targets, batchSize = 5 } = options;

  if (!accountId || !databaseId || !apiToken) {
    throw new Error("Cloudflare D1 設定エラー: accountId, databaseId, apiToken が必要です");
  }
  if (!targets || targets.length === 0) {
    return { total: 0, updated: 0 };
  }

  const fetchFn = options.customFetch ?? fetch;
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/raw`;

  let updated = 0;
  const errors: any[] = [];

  for (let i = 0; i < targets.length; i += batchSize) {
    const chunk = targets.slice(i, i + batchSize);
    const valueTuples: string[] = [];
    const params: unknown[] = [];

    for (const target of chunk) {
      const uint8 = new Uint8Array(
        target.embedding.buffer,
        target.embedding.byteOffset,
        target.embedding.byteLength,
      );
      // BLOB は syncArticlesToD1 と同じく X'..' リテラルで埋め込む
      valueTuples.push(`(?, ?, X'${uint8ArrayToHex(uint8)}')`);
      params.push(target.id, target.score);
    }

    // NOTE: 1 リクエストにつき必ず 1 ステートメントにすること。
    // D1 は複数ステートメントと params の併用を拒否する
    // ("The request is malformed: params with multiple statements is not supported")。
    // 以前は `UPDATE ...;` をバッチ件数だけ改行連結して params と一緒に送っており、
    // 端数の 1 件だけが通って残り全件が失敗していた。
    //
    // UPDATE ... FROM (VALUES ...) なら 1 ステートメントのまま複数行を更新できる。
    // SQLite の VALUES 句は列名を column1, column2, ... で参照する
    // (`AS v(id, score, ...)` の列名指定構文は SQLite にはない)。
    const sql = `
UPDATE articles
SET score = v.column2, embedding = v.column3
FROM (VALUES ${valueTuples.join(", ")}) AS v
WHERE articles.id = v.column1;
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
        if (resData?.success === false) {
          errors.push(...(resData.errors ?? [{ message: "D1 update returned success=false" }]));
        } else {
          updated += chunk.length;
        }
      }
    } catch (err: any) {
      errors.push({ message: err?.message || String(err) });
    }
  }

  return {
    total: targets.length,
    updated,
    ...(errors.length > 0 ? { errors } : {}),
  };
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
    body: JSON.stringify({ sql: readMigrationStatements() }),
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
  const { accountId, databaseId, apiToken, articles, batchSize = 5 } = options;

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
  published_at = MIN(excluded.published_at, articles.published_at),
  published_date_jst = MIN(excluded.published_date_jst, articles.published_date_jst),
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
