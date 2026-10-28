#!/usr/bin/env bash
#
# pnpm の依存を、このリポジトリの制約を守りながら最新に上げる。
# 使い方: mise run deps:update (mise.toml の [tasks] から呼ばれる)
#
# ============================================================================
# なぜ `pnpm up --latest` をそのまま使わないのか
# ============================================================================
#
# `pnpm up --latest` は package.json のバージョン指定 (完全固定の "3.8.1" も含む)
# をすべて無視して最新に上げる。このリポジトリには「一緒に上げてはいけない」
# 「この範囲までしか上げられない」依存があり、素の `--latest` ではそれを破る。
# Renovate が動いていた頃は renovate.json の packageRules がこれを担っていたが、
# Renovate を止めたので、同じ制約を手動更新用にここへ書き写している。
#
# 依存ごとの扱いは次の 3 つ。
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
#   - このスクリプトの EXCLUDES から @huggingface/transformers
#   - renovate.json の @huggingface/transformers の packageRule
#   - src/pipeline/embedder.ts の getExtractor のコメントの固定理由
#   - AGENTS.md の「3.8.1 から上げないでください」の行
#
# ----------------------------------------------------------------------------
# (2) vitest / @vitest/* / @cloudflare/vitest-pool-workers … pool-workers に合わせる
# ----------------------------------------------------------------------------
# 何が起きるか:
#   @cloudflare/vitest-pool-workers は、L3 (Worker) のテストを本番と同じ
#   workerd 上で動かすための vitest プラグイン。vitest の内部 API に依存しているため、
#   peerDependencies で「対応している vitest のメジャー」を固定している
#   (例: 0.23.0 は vitest ^4.1.0 のみ)。vitest だけを新しいメジャーに上げると、
#   workerd 上でテストワーカーが起動できず L3 (Worker) が 1 件も走らずに落ちる
#   (vitest 5 の PR #78 で実際に起きた)。
#
#   そこでこのスクリプトでは、先に pool-workers を最新にしてから、
#   それが peerDependencies で宣言している範囲の中で vitest 系を最新にする。
#   範囲は毎回 pool-workers 自身から読むので、ここに数字は書いていない。
#
# この面倒が要らなくなる条件:
#   「プラグインと vitest を揃える」こと自体は無くならない (プラグインが vitest
#   内部に依存する限り続く)。ただし範囲はプラグインから毎回読むので、
#   プラグインが新しい vitest に対応すれば、このスクリプトを流すだけでそこまで上がる。
#
#   注意: @cloudflare/vitest-pool-workers は deprecated になり、
#   @cloudflare/vitest-plugin に改名された (旧名は今後更新されない)。
#   旧名のままだと vitest は 4 系で止まり続ける。新名は vitest 5 にも対応している
#   (`pnpm view @cloudflare/vitest-plugin peerDependencies`)。
#   vitest.worker.config.ts などを新パッケージへ移行したら、
#   下の POOL_WORKERS を新しい名前に変えること。
#
# ----------------------------------------------------------------------------
# (3) @types/node … mise で使っている Node.js のメジャーに合わせる
# ----------------------------------------------------------------------------
# 何が起きるか:
#   @types/node は「Node.js の API の型定義」で、Node.js 本体とは別に版が進む。
#   `--latest` だと実行環境 (mise.toml の node) より新しい Node の型になり、
#   実際には存在しない API を使ってもコンパイルが通ってしまう。
#
# この面倒が要らなくなる条件:
#   無くならないが、手作業も不要。メジャーは mise.toml の node から読むので、
#   mise.toml の node を上げれば、次にこのスクリプトを流したときに追随する。
#
# ============================================================================
# このスクリプト自体が要らなくなる条件
# ============================================================================
#   Renovate を再開すれば (renovate.json の "enabled": false を外す)、
#   上の (1)〜(3) のうち (1)(2) は renovate.json の packageRules が担うので、
#   このスクリプトは削除してよい。(3) は renovate.json に無いので、
#   消すなら Renovate 側にも同じ規則を足すこと。
#
# 実行後に手元で確認すること:
#   pnpm check && pnpm test:e2e
#   PR では package.json / pnpm-lock.yaml の変更により
#   embedding-model-smoke-test.yml (実モデルの読み込み) も自動で走る。

set -euo pipefail

# --- (1) 上げない依存 -------------------------------------------------------
PINNED=(
  "@huggingface/transformers"
)

# --- (2) pool-workers に合わせる依存 ----------------------------------------
POOL_WORKERS="@cloudflare/vitest-pool-workers"
# package.json に実際に載っている vitest / @vitest/* を拾う (後から増えても追随する)
mapfile -t VITEST_PKGS < <(node -p '
  const p = require("./package.json");
  Object.keys({ ...p.dependencies, ...p.devDependencies })
    .filter((n) => n === "vitest" || n.startsWith("@vitest/"))
    .join("\n")
')

# --- (3) Node.js のメジャーに合わせる依存 ------------------------------------
# 実行中の node ではなく mise.toml から読む (mise を通さずに実行しても正しくなるように)
NODE_MAJOR="$(sed -n 's/^node = "\([0-9]*\)\..*/\1/p' mise.toml)"
if [[ -z "$NODE_MAJOR" ]]; then
  echo "ERROR: mise.toml から node のバージョンを読めませんでした。" >&2
  exit 1
fi

pinned_before="$(node -p 'require("./package.json").dependencies["@huggingface/transformers"]')"

echo "==> 制約の無い依存を最新に上げます"
EXCLUDES=()
for name in "${PINNED[@]}" "$POOL_WORKERS" "${VITEST_PKGS[@]}" "@types/node"; do
  EXCLUDES+=("!${name}")
done
pnpm up --latest "${EXCLUDES[@]}"

echo "==> ${POOL_WORKERS} を最新に上げます"
pnpm up --latest "$POOL_WORKERS"

# `pnpm view ...@latest` ではなく、実際に入った版の package.json から読む。
# minimumReleaseAge (7 日) により、latest タグより古い版が入ることがあるため。
VITEST_RANGE="$(node -p "require('./node_modules/${POOL_WORKERS}/package.json').peerDependencies.vitest")"

echo "==> vitest 系を ${POOL_WORKERS} の対応範囲 (${VITEST_RANGE}) 内で最新に上げます"
VITEST_SPECS=()
for name in "${VITEST_PKGS[@]}"; do
  VITEST_SPECS+=("${name}@${VITEST_RANGE}")
done
pnpm up "${VITEST_SPECS[@]}"

echo "==> @types/node を Node.js ${NODE_MAJOR} 系の最新に上げます"
pnpm up "@types/node@^${NODE_MAJOR}"

# 念のため、固定した依存が本当に動いていないかを確かめる
pinned_after="$(node -p 'require("./package.json").dependencies["@huggingface/transformers"]')"
if [[ "$pinned_before" != "$pinned_after" ]]; then
  echo "ERROR: @huggingface/transformers が ${pinned_before} から ${pinned_after} に変わりました。" >&2
  echo "       このスクリプト冒頭のコメント (1) を参照してください。" >&2
  exit 1
fi

echo
echo "==> 上げなかった / 上げきれなかった依存 (想定どおりかを確認してください)"
pnpm outdated || true

echo
echo "次に: pnpm check && pnpm test:e2e"
