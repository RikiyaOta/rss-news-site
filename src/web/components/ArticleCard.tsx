import { Article, SearchResultItem } from "../../shared/types";
import { ExternalLink, Sparkles, Calendar, Tag, CheckCircle2 } from "lucide-react";

export interface ArticleCardProps {
  article: Article | SearchResultItem;
}

function getScoreBadgeStyle(score: number): { container: string; label: string } {
  if (score >= 80) {
    return {
      container: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
      label: "高重要度",
    };
  }
  if (score >= 60) {
    return {
      container: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
      label: "注目",
    };
  }
  if (score >= 40) {
    return {
      container: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
      label: "標準",
    };
  }
  return {
    container: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30",
    label: "参考",
  };
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

export function ArticleCard({ article }: ArticleCardProps) {
  const isSearchResult =
    "similarity" in article && typeof (article as SearchResultItem).similarity === "number";
  const searchItem = isSearchResult ? (article as SearchResultItem) : null;

  const scoreStyle = getScoreBadgeStyle(article.score);

  // 要約を行ごとに分割して整形
  const summaryLines = (article.summary || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^[・\-*•\d.\s]+/, "").trim())
    .filter((line) => line.length > 0);

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
              <Tag className="w-3 h-3 text-zinc-500" />
              {article.source_name}
            </span>

            {searchItem && searchItem.date && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                <Calendar className="w-3 h-3" />
                {searchItem.date}
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
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${scoreStyle.container}`}
            >
              スコア: {article.score}点
            </span>
          </div>
        </div>

        {/* 記事タイトル */}
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 leading-snug mb-3">
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

        {/* 3行要約 */}
        {summaryLines.length > 0 && (
          <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-3 mb-4 border border-zinc-100 dark:border-zinc-800/80">
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-500" />
              AI 3行要約
            </p>
            <ul className="space-y-1.5 text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
              {summaryLines.map((line, idx) => (
                <li key={idx} className="flex items-start gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-emerald-500 dark:text-emerald-400" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
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
