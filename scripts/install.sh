#!/usr/bin/env bash
# install.sh — pm（project-manager）を ~/.local/bin から実行できるようにする。
# 実体はこの repo。symlink を張るだけ（コピーしない＝1 データ 1 箇所）。
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$BIN"
chmod +x "$HERE"/pm.ts "$HERE"/ontology.ts "$HERE"/dash.ts "$HERE"/diagram.ts "$HERE"/board.ts
ln -sfn "$HERE/pm.ts" "$BIN/pm"
ln -sfn "$HERE/ontology.ts" "$BIN/video-ontology"
printf 'ok: %s -> %s\n' "$BIN/pm" "$HERE/pm.ts"
printf 'ok: %s -> %s\n' "$BIN/video-ontology" "$HERE/ontology.ts"
printf '\n使い方: pm | pm <slug> | pm wf script | pm dashboards | pm index | pm plan json\n'
