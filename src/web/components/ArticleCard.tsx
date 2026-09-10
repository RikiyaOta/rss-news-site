import { useState } from "react";
import { Article, SearchResultItem } from "../../shared/types";
import { getScoreBand } from "../../shared/score-bands";
import { getFaviconUrl } from "../lib/favicon";
import { ExternalLink, Sparkles, Calendar, Tag } from "lucide-react";

export interface ArticleCardProps {
  article: Article | SearchResultItem;
}

function formatPublishedDate(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const mins = String(d.getMinutes()).padStart(2, "0");
    return `${year}/${month}/${day} ${hours}:${mins}`;
  } catch {
    return isoStr;
  }
}

/**
 * 配信元サイトの favicon。
 *
 * 記事 URL からホスト名を解決できない場合と、画像の取得に失敗した場合は
 * 汎用アイコンへフォールバックする。配信元名は隣にテキストで併記されるため、
 * 画像自体は装飾として扱う (alt="")。
 */
function SourceFavicon({ articleUrl }: { articleUrl: string }) {
  const faviconUrl = getFaviconUrl(articleUrl);
  const [isBroken, setIsBroken] = useState(false);

  if (!faviconUrl || isBroken) {
    return (
      <Tag data-testid="source-favicon-fallback" className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
    );
  }

  return (
    <img
      data-testid="source-favicon"
      src={faviconUrl}
      alt=""
      aria-hidden="true"
      width={14}
      height={14}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className="w-3.5 h-3.5 shrink-0 rounded-sm object-contain"
      onError={() => setIsBroken(true)}
    />
  );
}

export function ArticleCard({ article }: ArticleCardProps) {
  const isSearchResult =
    "similarity" in article && typeof (article as SearchResultItem).similarity === "number";
  const searchItem = isSearchResult ? (article as SearchResultItem) : null;
  const scoreBand = getScoreBand(article.score);

  return (
    <article
      data-testid="article-card"
      className="group relative flex flex-col justify-between rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 p-5 shadow-sm hover:shadow-md transition-all duration-200 hover:border-zinc-300 dark:hover:border-zinc-700"
    >
      <div>
        {/* メタ情報ヘッダー */}
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
              {/* 配信元の favicon。記事ごとに URL が変わるため key で状態を作り直す */}
              <SourceFavicon key={article.url} articleUrl={article.url} />
              {article.source_name}
            </span>

            {searchItem && article.published_date_jst && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                <Calendar className="w-3 h-3" />
                {article.published_date_jst}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* 類似度バッジ（検索時） */}
            {searchItem && (
              <span
                data-testid="similarity-badge"
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/30"
              >
                <Sparkles className="w-3 h-3" />
                一致度 {Math.round(searchItem.similarity * 100)}%
              </span>
            )}

            {/* スコアバッジ */}
            <span
              data-testid="score-badge"
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${scoreBand.badgeClassName}`}
            >
              スコア: {article.score}点
            </span>
          </div>
        </div>

        {/* 記事タイトル */}
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 leading-snug mb-2">
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group-hover:text-blue-600 dark:group-hover:text-blue-400 inline-flex items-start gap-1.5 transition-colors"
          >
            <span>{article.title}</span>
            <ExternalLink className="w-4 h-4 mt-0.5 flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" />
          </a>
        </h3>

        {/* 抜粋テキスト（スニペット） */}
        {article.summary && article.summary.trim().length > 0 && (
          <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-relaxed mb-3">
            {article.summary}
          </p>
        )}
      </div>

      {/* フッター（公開日時） */}
      <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/60 flex items-center justify-between text-xs text-zinc-400 dark:text-zinc-500">
        <span className="flex items-center gap-1">
          <Calendar className="w-3.5 h-3.5" />
          {formatPublishedDate(article.published_at)}
        </span>
      </div>
    </article>
  );
}
