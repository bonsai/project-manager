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
| `dash.ts` — `progress.html`（本 × 9 工程 + 未達 + キャスト）+ `index.html`（タブ束ね） | 実走確認済み |
| `pm dashboards` / `pm index` — 3 枚を生成してブラウザで開く（`--no-open` あり） | 実走確認済み（Chrome が progress.html を開いた） |
| `scripts/install.sh` — `~/.local/bin/pm` と `video-ontology` を張る | 実走確認済み（`pm` / `video-ontology` が PATH から動く） |
| `openapi.yaml` — CLI 界面の正（`~/.skills/cli/registry/pm.yaml` が symlink） | あり |
| `diagram.ts` / `board.ts` / `pipeline.html` / `script.html` | 生成物 |
| `state/nvidia-ok.json` — 使える NVIDIA モデル一覧 | あり |
| remote `bonsai/project-manager` | push 済み |

## 方針（決定事項）

- **人間は視聴（view）とダメ出し（review）だけ**。企画・制作・投稿（neta〜mux, deploy）は agent が回す。
  型は `wf.yaml` の `human:`（sinks = reviews.jsonl / issue）と `casting.yaml` の `roles.human|agent`。
- 台帳の書き手は videoman（`src/config.ts` の既定が `~/.skills/project-manager/data/videos.jsonl`、`KANAL_JSONL`/`VIDEOMAN_JSONL` で差し替え可）。PM は読むだけ。
- 工程の有無は台帳ではなく成果物ファイル（`wf.yaml` の roots × artifacts を glob）。例外は `deploy`=`youtube_id` / `metrics`=`stats.views`。
- 派生（SQLite `pipeline.db` / HTML / BQ）は `kanalvideo-analysis` 側に残す。

## かんばん（作成済み）

`kanban.html` — 台帳 status（idea / script / audio / video / ready / uploaded / held / dropped）の列 × カード。
カードはサムネ + `n/9` の到達 + gate 不合数 + 次の一手。表形式の一覧も同居。
`pm dashboards` が 4 枚（かんばん / 進捗 / 工程図 / 台本部）を作って開き、`index.html` は 4 タブ。

## crawl（巡回検査・作成済み）

`pm crawl` が台帳 + 成果物 + 実体ファイル（MEGA）+ 整合を 1 周する。`--write` で `state/crawl-latest.json` と `state/crawl.jsonl`（履歴）に記録。問題があれば exit 1。

- cron 登録済み（2026-09-29、6 時間毎 `17 */6 * * *`）。ログは `state/crawl.log`。PATH に依存しないよう `bun` は絶対パス、`env -i` での実走も確認
- 初回の実測: 13 本中 9 本クリーン、問題 4 件 → `ai-dev-5stages` / `star1-30s`（status=script なのに file 空）、`yt-YdnZICIRgO8` / `yt-PbENAC6-kao`（status=uploaded なのに file 空＝チャンネル取り込み）
- gate 不合格 129 件（主に未制作の本の成果物不足）

## gate（通過条件）の検査（作成済み）

`wf.yaml` の `checks`（15 種）を `lib/gates.ts` が実行する。presence だけでなく中身を見る。

- `pm gate`（全本の不合成約）/ `pm gate <slug>` / `pm gate <slug> <stage>`、`pm <slug>` にも gate 節
- 判定は 3 値: ✅ 合格 / ✗ 不合格 / ・ 人手で確認（`manual` は「通った」扱いにしない）
- 尺の期待値は台帳の `target_seconds` → 型の `seconds`（±35%）。`data/SCHEMA.md` に追記し、判明分（typesafe-jev=90s, douga-hensyu=30s）を台帳へ入れた
- 実測で見つかった実態: `script-thumb-aspect` は 13/13 未、`mux-final`（`-final.mp4` 命名）は 13/13 未、`tts-duration` は 12 本未（未制作）。現状の穴が定量的に見える
- オントロジ: `gate_checks` / `stage_check` テーブル + ビュー `v_gate_fail`、クエリ `gate-fail` / `manual`

## オントロジ（作成済み）

`bun ontology.ts build` で `data/video-ontology.db` を作る派生 DB。正は `wf.yaml` / `casting.yaml` / `data/videos.jsonl` / `data/SCHEMA.md`。

- nodes 134 / edges 186 / 到達セル 27/117（13 本 × 9 工程）
- 型付き 8 テーブル + 汎用グラフ + ビュー `v_progress` / `v_missing` / `v_next`
- 判定は `lib/stages.ts` に一本化（`pm.ts` も同モジュールを使う＝二重実装なし。`pm.ts` の出力が移行前後で一致することを確認）

## 次の一手

- 人間の関所に合わせて、neta〜mux を agent が回して 1 本 9/9 にする（最短は `typesafe-jev` の 5/9）。
- 9/9 のプロジェクトが 0 本（最短は `typesafe-jev` の 5/9）。
- オントロジの残: `role:prompt` にキャストが無い（`casting.yaml` の defaults に prompt が欠けている）。legacy kind `long`（types に無い）の扱いを決める。

## ISSUE_LOG

- 2026-09-29 `kanban.html` を追加（台帳 status の列 × カード。サムネ・n/9・gate 不合・次の一手）。`pm dashboards` の 4 枚目に組み込み、index の既定タブを かんばん に。
- 2026-09-29 `pm crawl` を追加（MEGA の実体・命名・status の整合・gate を 1 周）。cron 6h 毎に登録し、`state/crawl.jsonl` に履歴を残す。初回で 4 件のドリフトを検出。
- 2026-09-29 gate を「在るか」から「中身」へ: `wf.yaml` に `checks` 15 種、`lib/gates.ts`（語数・字数・枚数・尺・aspect・命名・数値・manual）、`pm gate`、オントロジ `gate_checks`/`stage_check`/`v_gate_fail`、dash の gate 表。尺の期待値は台帳 `target_seconds` を追加して優先。
- 2026-09-29 役割分担を型に反映: neta/deploy を agent へ移し、人間は視聴（view）とダメ出し（review）のみに。`wf.yaml` の `human:`、`casting.yaml` の `roles`、オントロジの `gate` ノードとクエリ `human` / `human-vs-agent`、dash の「人間が触るところ」を追加。
- 2026-09-29 `openapi.yaml` を追加し、`~/.local/bin/pm` / `video-ontology` を張る `scripts/install.sh` を追加。壊れていた `~/.skills/cli/registry/videoman.yaml` も貼り直した。
- 2026-09-29 `pm dashboards` / `pm index` を追加（`videoman dashboards` と同じ流儀: 生成 → 開く）。`dash.ts` が進捗マトリクスを HTML 化。Chrome での実オープンを確認。
- 2026-09-29 動画ドメインのオントロジを追加（`ontology.ts` + `data/video-ontology.sql` + `data/queries.sql`）。工程判定を `lib/stages.ts` に抽出し pm.ts と共有。
- 2026-09-29 台帳 `videos.jsonl` + `SCHEMA.md` を `kanalvideo-analysis/pipeline/` から `data/` へ移設し、videoman の既定パスを更新（統合管理）。PM/videoman の実走で確認。
