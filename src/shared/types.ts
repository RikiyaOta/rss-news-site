export interface Article {
  id: string; // URLのSHA-256ハッシュ (先頭16文字)
  title: string; // 記事タイトル
  url: string; // 記事URL
  source_name: string; // フィード名 (例: "Zenn", "Hacker News")
  summary: string; // 記事の抜粋 (og:description / description)
  score: number; // 0〜100 の興味関心スコア
  published_at: string; // ISO 8601 形式の公開日時
  published_date_jst?: string; // JST の公開日 (YYYY-MM-DD)。API が返す
}

export interface FeedSource {
  name: string;
  url: string;
}

export interface UserProfile {
  interests: string[];
  exclude_keywords: string[];
}

export interface PipelineConfig {
  feeds: FeedSource[];
  profile: UserProfile;
}

export interface SearchResultItem extends Article {
  similarity: number; // クエリベクトルとのコサイン類似度 (0〜1)
}
