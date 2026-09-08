import { getTodayJstDateString, adjustDateString } from "../../../src/shared/date";

/**
 * E2E で D1 に投入する固定データ。
 *
 * 「今日」は実行日の JST 日付に依存するため、日付は実行時に算出する。
 * seed 生成 (global-setup) とテストのアサーションで同じ定義を共有し、
 * 期待値がひとつの場所にだけ存在するようにしている。
 */

export const TODAY = getTodayJstDateString();
export const YESTERDAY = adjustDateString(TODAY, -1);

export interface E2eArticle {
  id: string;
  title: string;
  url: string;
  source_name: string;
  summary: string;
  score: number;
  published_at: string;
}

/** JST の日付と時刻から UTC ISO8601 を作る (JST 09:00 は UTC 00:00) */
function jstNoonIso(dateJst: string): string {
  return `${dateJst}T03:00:00.000Z`;
}

export const TODAY_ARTICLES: E2eArticle[] = [
  {
    id: "e2e-today-1",
    title: "Cloudflare Workers と D1 で作るサーバーレス構成",
    url: "https://example.com/today-1",
    source_name: "Tech Portal",
    summary:
      "Cloudflare Workers Static Assets と Hono、D1 を活用したサーバーレス構成について解説します。",
    score: 95,
    published_at: jstNoonIso(TODAY),
  },
  {
    id: "e2e-today-2",
    title: "TypeScript の新機能とコンパイラ高速化",
    url: "https://example.com/today-2",
    source_name: "TypeScript News",
    summary: "TypeScript のモジュール解決パフォーマンス改善と新しい型アサーション構文の紹介です。",
    score: 82,
    published_at: jstNoonIso(TODAY),
  },
  {
    id: "e2e-today-3",
    title: "低スコアの記事",
    url: "https://example.com/today-3",
    source_name: "Misc Blog",
    summary: "並び順の確認のために用意した、スコアが最も低い記事です。",
    score: 35,
    published_at: jstNoonIso(TODAY),
  },
];

export const YESTERDAY_ARTICLES: E2eArticle[] = [
  {
    id: "e2e-yesterday-1",
    title: "前日の主要テクノロジートレンド総まとめ",
    url: "https://example.com/yesterday-1",
    source_name: "Dev Weekly",
    summary: "エッジコンピューティングの進化とオープンソース LLM の活用手法について解説します。",
    score: 88,
    published_at: jstNoonIso(YESTERDAY),
  },
];

/** ページネーション検証用。1 ページ (30 件) を超える件数を用意する */
export const PAGING_DATE = adjustDateString(TODAY, -2);
export const PAGING_TOTAL = 45;

export const PAGING_ARTICLES: E2eArticle[] = Array.from({ length: PAGING_TOTAL }, (_, i) => ({
  id: `e2e-paging-${i}`,
  title: `ページング記事 ${i + 1}`,
  url: `https://example.com/paging-${i}`,
  source_name: "Paged Source",
  summary: `ページング記事 ${i + 1} の要約です。`,
  score: 90 - i,
  published_at: jstNoonIso(PAGING_DATE),
}));

/** 記事が 1 件も無い日付 (空状態の検証用) */
export const EMPTY_DATE = adjustDateString(TODAY, -3);

export const ALL_ARTICLES: E2eArticle[] = [
  ...TODAY_ARTICLES,
  ...YESTERDAY_ARTICLES,
  ...PAGING_ARTICLES,
];

/** 埋め込み生成に用いるテキスト (パイプラインの passage 形式に合わせる) */
export function articleEmbeddingText(article: E2eArticle): string {
  return `${article.title}\n${article.summary}`;
}
