/**
 * R2 のパブリックベースURLを取得する
 * Vite の環境変数 (VITE_R2_PUBLIC_URL)、Node.js 環境変数 (process.env.VITE_R2_PUBLIC_URL / process.env.R2_PUBLIC_URL)、
 * または未設定時のフォールバックURL（空文字）を返却する。
 */
export function getR2PublicBaseUrl(): string {
  let url = "";

  try {
    if (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_R2_PUBLIC_URL) {
      url = (import.meta as any).env.VITE_R2_PUBLIC_URL;
    }
  } catch {
    // import.meta.env が利用できない環境を許容
  }

  if (!url && typeof process !== "undefined" && process.env) {
    url = process.env.VITE_R2_PUBLIC_URL || process.env.R2_PUBLIC_URL || "";
  }

  // 末尾のスラッシュを除去して正規化
  return url ? url.trim().replace(/\/+$/, "") : "";
}
