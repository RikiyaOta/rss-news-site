#!/usr/bin/env node
/**
 * vitest の coverage/coverage-summary.json から Markdown のカバレッジ表を生成する。
 *
 * `pnpm test:coverage` のテキスト出力をパイプで加工すると、
 * GitHub Actions の既定シェル (bash -e、pipefail 無効) ではテストが失敗しても
 * パイプ全体が成功扱いになる。JSON を後段のステップで読む形にすることで、
 * パイプそのものを CI から排除している。
 */
import fs from "node:fs";
import path from "node:path";

const summaryPath = path.resolve("coverage/coverage-summary.json");

if (!fs.existsSync(summaryPath)) {
  console.error(`カバレッジサマリーが見つかりません: ${summaryPath}`);
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
const { total, ...files } = summary;

/** 閾値を下回っていれば ⚠️、それ以外は ✅ */
function mark(pct) {
  return pct >= 80 ? "✅" : "⚠️";
}

function row(label, metrics) {
  const cells = ["statements", "branches", "functions", "lines"].map((key) => {
    const m = metrics[key];
    return `${m.pct.toFixed(2)}% (${m.covered}/${m.total})`;
  });
  return `| ${label} | ${cells.join(" | ")} |`;
}

const cwd = process.cwd();
const lines = [
  "### 📊 テストカバレッジ",
  "",
  `**全体: ${mark(total.lines.pct)} Lines ${total.lines.pct.toFixed(2)}% / Branches ${total.branches.pct.toFixed(2)}%**`,
  "",
  "| ファイル | Statements | Branches | Functions | Lines |",
  "|---|---|---|---|---|",
  row("**合計**", total),
];

for (const [absPath, metrics] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
  lines.push(row(path.relative(cwd, absPath), metrics));
}

process.stdout.write(lines.join("\n") + "\n");
