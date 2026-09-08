/**
 * 「フィード取得後にプロセスが終了できること」を検証するための子プロセス。
 *
 * process-exit.test.ts から tsx 経由で起動される。本番と同じ既定パーサーを
 * 使って 1 フィードだけ取得し、あとは何もしない。ソケットやタイマーが
 * 残っていればこのプロセスは終了できず、テスト側がタイムアウトする。
 */
import { fetchFeedArticles } from "../../../../src/pipeline/fetcher";

const url = process.argv[2];
if (!url) {
  console.error("フィード URL を引数で渡してください");
  process.exit(2);
}

const articles = await fetchFeedArticles({ name: "test-feed", url });
console.log(`FETCHED:${articles.length}`);
