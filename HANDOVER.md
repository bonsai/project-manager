# HANDOVER — project-manager

現在地（2026-09-29）

## 一言

動画プロジェクトを 9 要素（工程）で検査する PM。検査のみで、作らない・投稿しない。
**2026-09-29 に台帳（canonical）の持ち主になった**（旧 `kanalvideo-analysis/pipeline/videos.jsonl`）。

## 持っている物

| 物 | 状態 |
|---|---|
| `pm.ts` — 全プロジェクトのマトリクス / 1 本の詳細 + 次の一手 / wf ボード | 実走確認済み |
| `wf.yaml` — 9 要素の定義・roots・成果物パターン・WF↔repo | あり（正は video-studio/contract/index.yaml の flow） |
| `casting.yaml` — 動画タイプ別の誰に・どのモデルで・どの鍵で | あり |
| `data/videos.jsonl` — 台帳（canonical、13 本） | 移設済み・実走確認済み |
| `data/SCHEMA.md` — 型・status 語彙・命名規則 | 移設済み |
| `diagram.ts` / `board.ts` / `pipeline.html` / `script.html` | 生成物 |
| `state/nvidia-ok.json` — 使える NVIDIA モデル一覧 | あり |
| remote `bonsai/project-manager` | push 済み |

## 方針（決定事項）

- 台帳の書き手は videoman（`src/config.ts` の既定が `~/.skills/project-manager/data/videos.jsonl`、`KANAL_JSONL`/`VIDEOMAN_JSONL` で差し替え可）。PM は読むだけ。
- 工程の有無は台帳ではなく成果物ファイル（`wf.yaml` の roots × artifacts を glob）。例外は `deploy`=`youtube_id` / `metrics`=`stats.views`。
- 派生（SQLite `pipeline.db` / HTML / BQ）は `kanalvideo-analysis` 側に残す。

## 次の一手

- 9/9 のプロジェクトが 0 本（最短は `typesafe-jev` の 5/9）。
- 動画ドメインのオントロジ（`data/video-ontology.db` + schema.sql）をこの repo に作る（決定済み、未着手）。

## ISSUE_LOG

- 2026-09-29 台帳 `videos.jsonl` + `SCHEMA.md` を `kanalvideo-analysis/pipeline/` から `data/` へ移設し、videoman の既定パスを更新（統合管理）。PM/videoman の実走で確認。
