#!/usr/bin/env bash
#
# mise のツールと pnpm の依存を、このリポジトリの制約を守りながら最新に上げる。
# 使い方: mise run deps:update (mise.toml の [tasks] から呼ばれる)
#
# ============================================================================
# なぜ `pnpm up --latest` をそのまま使わないのか
# ============================================================================
#
# `pnpm up --latest` は package.json のバージョン指定 (完全固定の "3.8.1" も含む)
# をすべて無視して最新に上げる。このリポジトリには「上げてはいけない」
# 「勝手にメジャーを上げてはいけない」依存があり、素の `--latest` ではそれを破る。
# Renovate が動いていた頃は renovate.json の packageRules がこれを担っていたが、
# Renovate を止めたので、同じ制約を手動更新用にここへ書き写している。
#
# ----------------------------------------------------------------------------
# (1) @huggingface/transformers … 3.8.1 から動かさない
# ----------------------------------------------------------------------------
# 何が起きるか:
#   このパッケージは埋め込みモデル (Xenova/bge-m3) を Node.js 上で動かすための
#   ライブラリで、実際の計算は同梱される onnxruntime-node (ONNX Runtime) が行う。
#   4.x は onnxruntime-node 1.24.3 を固定で同梱しており、このバージョンでは
#   fp16 版の bge-m3 を読み込むときの「グラフ最適化」(モデルを高速化するために
#   計算グラフを書き換える処理。SimplifiedLayerNormFusion とキャスト挿入の
#   組み合わせ) が失敗し、モデルの読み込み自体が例外になる。
#   結果として記事収集パイプライン (pnpm pipeline) が起動直後に必ず落ちる。
#   3.8.1 が同梱する onnxruntime-node 1.21.0 では起きない。
#   詳細は src/pipeline/embedder.ts の getExtractor のコメントを参照。
#
# この面倒が要らなくなる条件:
#   @huggingface/transformers の最新版が同梱する onnxruntime-node で、
#   fp16 の Xenova/bge-m3 が読み込めるようになること。
#   ONNX Runtime 側で上記の最適化バグが直り、transformers がその版を
#   同梱するまで待つ、ということ。
#
# 直ったかの確かめ方:
#   1. 同梱版を見る:
#        pnpm view @huggingface/transformers@latest dependencies.onnxruntime-node
#      1.24.3 のままなら、まだ直っていないと見てよい。
#   2. 版が変わっていたら、作業ブランチで実際に読み込んでみる:
#        pnpm add @huggingface/transformers@latest
#        pnpm test:integration   # 実モデルを読み込む L3 (Model)。約 1.1GB DL する
#      これが通れば解禁できる。
#
# 解禁するときに外すもの (どれかを残すと、また誰かが「上げるな」と判断する):
#   - このスクリプトの PINNED から @huggingface/transformers
#   - renovate.json の @huggingface/transformers の packageRule
#   - src/pipeline/embedder.ts の getExtractor のコメントの固定理由
#   - AGENTS.md の「3.8.1 から上げないでください」の行
#
# ----------------------------------------------------------------------------
# (2) vitest / @vitest/* … 今のメジャーの中でだけ上げる
# ----------------------------------------------------------------------------
# 何が起きるか:
#   @cloudflare/vitest-plugin は、L3 (Worker) のテストを本番と同じ workerd 上で
#   動かすための vitest プラグイン。vitest の内部 API に依存しているため、
#   peerDependencies で「対応している vitest のメジャー」を宣言している。
#   これを外れた vitest と組み合わせると、workerd 上でテストワーカーが起動できず
#   L3 (Worker) が 1 件も走らずに落ちる (vitest 5 の PR #78 で実際に起きた)。
#
# このスクリプトでの扱い:
#   vitest のメジャーを上げるのは破壊的変更の確認を伴う作業なので、自動ではやらない。
#   vitest 系は今のメジャーの中で最新にし、プラグインは最新にする。
#   両者が食い違っていないかは、最後の `pnpm peers check` で確かめる
#   (プラグインが今の vitest のメジャーをサポートしなくなったら、そこで止まる)。
#
# vitest のメジャーを上げるとき (手作業):
#   1. プラグインが新メジャーに対応しているか見る:
#        pnpm view @cloudflare/vitest-plugin peerDependencies.vitest
#   2. 対応していれば、vitest 系をまとめて上げる (例: 5 系):
#        pnpm up vitest@^5 @vitest/coverage-v8@^5
#   3. pnpm check で L3 (Worker) まで通ることを確かめる。
#
# この面倒が要らなくなる条件:
#   無くならない (プラグインが vitest 内部に依存する限り続く)。
#   ただし食い違いは peers check が機械的に検出するので、覚えておく必要はない。
#
# ----------------------------------------------------------------------------
# (3) @types/node … Node.js のメジャーに合わせる
# ----------------------------------------------------------------------------
# 何が起きるか:
#   @types/node は「Node.js の API の型定義」で、Node.js 本体とは別に版が進む。
#   `--latest` だと実行環境 (mise.toml の node) より新しい Node の型になり、
#   実際には存在しない API を使ってもコンパイルが通ってしまう。
#
# この面倒が要らなくなる条件:
#   無くならないが、手作業も不要。先に mise で node を上げてから、
#   その node のメジャーに合わせて上げる。
#
# ============================================================================
# このスクリプトの pnpm 部分が要らなくなる条件
# ============================================================================
#   Renovate を再開すれば (renovate.json の "enabled": false を外す)、
#   (1)(2) は renovate.json の packageRules が担う。(3) は renovate.json に
#   無いので、スクリプトを消すなら Renovate 側にも同じ規則を足すこと。
#
# 実行後に手元で確認すること:
#   pnpm check && pnpm test:e2e
#   PR では package.json / pnpm-lock.yaml の変更により
#   embedding-model-smoke-test.yml (実モデルの読み込み) も自動で走る。

set -euo pipefail

# mise up で node / pnpm 自体が新しくなるため、以降は mise exec を通して
# 新しい版で実行する (タスク起動時の PATH は古い版を指したままになる)。
pnpm() { mise exec -- pnpm "$@"; }
node() { mise exec -- node "$@"; }

PINNED=(
  "@huggingface/transformers"
)
# package.json に載っている vitest / @vitest/* を拾う (後から増えても追随する)
mapfile -t VITEST_PKGS < <(node -p '
  const p = require("./package.json");
  Object.keys({ ...p.dependencies, ...p.devDependencies })
    .filter((n) => n === "vitest" || n.startsWith("@vitest/"))
    .join("\n")
')

echo "==> mise のツールを最新に上げます"
mise up --bump

pinned_before="$(node -p 'require("./package.json").dependencies["@huggingface/transformers"]')"

echo "==> 制約の無い pnpm の依存を最新に上げます"
EXCLUDES=()
for name in "${PINNED[@]}" "${VITEST_PKGS[@]}" "@types/node"; do
  EXCLUDES+=("!${name}")
done
pnpm up --latest "${EXCLUDES[@]}"

echo "==> vitest 系を今のメジャーの中で最新に上げます"
pnpm up "${VITEST_PKGS[@]}"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
echo "==> @types/node を Node.js ${NODE_MAJOR} 系の最新に上げます"
pnpm up "@types/node@^${NODE_MAJOR}"

pinned_after="$(node -p 'require("./package.json").dependencies["@huggingface/transformers"]')"
if [[ "$pinned_before" != "$pinned_after" ]]; then
  echo "ERROR: @huggingface/transformers が ${pinned_before} から ${pinned_after} に変わりました。" >&2
  echo "       このスクリプト冒頭のコメント (1) を参照してください。" >&2
  exit 1
fi

if ! pnpm peers check; then
  echo "ERROR: peerDependencies の食い違いがあります。" >&2
  echo "       vitest とプラグインの組み合わせなら、冒頭のコメント (2) を参照してください。" >&2
  exit 1
fi

echo
echo "==> 上げなかった / 上げきれなかった依存 (想定どおりかを確認してください)"
pnpm outdated || true

echo
echo "次に: pnpm check && pnpm test:e2e"
