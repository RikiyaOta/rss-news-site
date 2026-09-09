/**
 * 記事の配信元サイトを表す favicon の URL を組み立てる。
 *
 * favicon の実体はサイトごとに置き場所が異なり (`/favicon.ico` /
 * `<link rel="icon">` / apple-touch-icon)、記事 URL だけから確実に解決する
 * 手段が無い。そのためホスト名を渡すと解決済みの画像を返す Google の
 * ファビコンサービスを利用する。API キーも課金も不要で、送信するのは
 * 記事 URL のホスト名のみ（パス・クエリは持ち込まない）。
 *
 * 画像の取得に失敗した場合は呼び出し側で代替アイコンへフォールバックする。
 */
const FAVICON_ENDPOINT = "https://www.google.com/s2/favicons";

/** 表示サイズ (12〜16px 相当) に対して高 DPI でも粗く見えない解像度 */
const FAVICON_SIZE = 64;

/** favicon を取得できるスキーム。data: や javascript: 等は対象外とする。 */
const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * 記事 URL から favicon の取得対象となるホスト名を取り出す。
 * URL として解釈できない、または対象外スキームの場合は null を返す。
 */
export function extractFaviconHost(articleUrl: string): string | null {
  if (!articleUrl || !articleUrl.trim()) return null;

  let parsed: URL;
  try {
    parsed = new URL(articleUrl.trim());
  } catch {
    return null;
  }

  if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) return null;

  // http(s) の URL はホストを省略できない (省略された文字列は new URL が例外を投げる)
  return parsed.hostname;
}

/**
 * 記事 URL に対応する favicon 画像の URL を返す。
 * ホスト名を解決できない場合は null を返す。
 */
export function getFaviconUrl(articleUrl: string): string | null {
  const host = extractFaviconHost(articleUrl);
  if (!host) return null;

  return `${FAVICON_ENDPOINT}?domain=${encodeURIComponent(host)}&sz=${FAVICON_SIZE}`;
}
