import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_ARTICLES, articleEmbeddingText, E2eArticle } from "./fixtures/articles";
import { fakeEmbedding } from "./fixtures/fake-embedding";
import { computePublishedDateJst } from "../../src/shared/date";

/**
 * E2E 用ローカル D1 の準備。
 *
 * 1. 本番と同じ migrations/ をローカル D1 へ適用する
 * 2. 固定データを実 SQL で投入する
 *
 * `pnpm e2e:server` から wrangler dev の起動前に実行される。
 * すべてローカル (Miniflare) で完結し、Cloudflare へは接続しない。
 */

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CONFIG = "wrangler.e2e.jsonc";
const DATABASE = "rss-news-e2e";

function wrangler(args: string[]): void {
  execFileSync("pnpm", ["exec", "wrangler", ...args], { cwd: rootDir, stdio: "inherit" });
}

/** SQL の文字列リテラルとしてエスケープする */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Float32Array を SQLite の BLOB リテラル X'..' へ変換する */
function toBlobLiteral(vector: Float32Array): string {
  const bytes = new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return `X'${hex}'`;
}

function toInsertStatement(article: E2eArticle): string {
  const embedding = toBlobLiteral(fakeEmbedding(articleEmbeddingText(article)));
  const values = [
    quote(article.id),
    quote(article.title),
    quote(article.url),
    quote(article.source_name),
    quote(article.summary),
    String(article.score),
    quote(article.published_at),
    quote(computePublishedDateJst(article.published_at)),
    embedding,
  ].join(", ");

  return `INSERT INTO articles (id, title, url, source_name, summary, score, published_at, published_date_jst, embedding) VALUES (${values});`;
}

export function seedE2eDatabase(): void {
  // 本番へ適用されるものと同一の migrations をローカル D1 へ適用する
  wrangler(["d1", "migrations", "apply", DATABASE, "--local", "--config", CONFIG]);

  // 毎回まっさらな状態から固定データを投入する
  const statements = ["DELETE FROM articles;", ...ALL_ARTICLES.map(toInsertStatement)].join("\n");

  const seedPath = path.join(rootDir, ".wrangler", "e2e-seed.sql");
  fs.mkdirSync(path.dirname(seedPath), { recursive: true });
  fs.writeFileSync(seedPath, statements, "utf-8");

  wrangler([
    "d1",
    "execute",
    DATABASE,
    "--local",
    "--config",
    CONFIG,
    "--file",
    path.relative(rootDir, seedPath),
  ]);
}

seedE2eDatabase();
