---
name: project-manager
description: >
  動画プロジェクトの進み具合を 9 要素（工程）で検査する PM。ネタワード/台本/読み上げ/画像プロンプト/
  画像/SE/結合動画/デプロイ/統計 のどこまで来ているか、次は何かを、videoman の台帳と各 repo の
  成果物ファイルから判定する。実処理はしない（実体は各 repo と videoman が持つ）。
  「PM」「プロジェクトマネージャ」「9要素チェック」「どこまで進んだ」「次の一手」「工程の抜け」
  「台本部ボード」「wf ボード」で発動。Use to audit a video project against the 9 pipeline stages.
---

# project-manager（PM）

動画プロジェクトを **9 要素（工程）** で検査する。検査するだけで、作らない・投稿しない。
実体は videoman（台帳・投稿・統計）と各 repo（成果物）。

```
neta(ネタワード) → script(台本) → tts(読み上げ) → prompt(画像プロンプト) → image(画像)
  → se(SE) → mux(結合動画) → deploy(デプロイ) → metrics(統計)
```

- 定義は `wf.yaml`（正: `~/.skills/video-studio/contract/index.yaml` の flow）。
- 台帳は `data/videos.jsonl`（videoman の canonical。`VIDEOMAN_JSONL` で差し替え）。スキーマは `data/SCHEMA.md`。
  videoman は `src/config.ts` の既定でこのパスを見る（旧 `kanalvideo-analysis/pipeline/` から 2026-09-29 に移設）。
- 成果物は `wf.yaml` の `roots` × `artifacts` を glob して見る（ファイルの有無が状態）。

## インストール

```bash
bash ~/.skills/project-manager/scripts/install.sh   # ~/.local/bin/pm と video-ontology を張る
```

界面の正は `openapi.yaml`（CLI registry からは `~/.skills/cli/registry/pm.yaml` が symlink）。

## 使い方

```bash
pm                                             # 全プロジェクトのマトリクス（9 要素）
video-ontology q missing                       # 工程別の未達（オントロジ）
bun ~/.skills/project-manager/pm.ts <slug>     # 1 本の詳細 + 次の一手
bun ~/.skills/project-manager/pm.ts wf script  # 台本部ボード（seed / review / done）
bun ~/.skills/project-manager/pm.ts wf         # WF 一覧
pm dashboards                                  # かんばん/進捗/工程図/台本部 の HTML を作って開く（--no-open で生成のみ）
bun ~/.skills/project-manager/pm.ts index       # 3 枚をタブで束ねた index.html を開く
```

## オントロジ（動画ドメイン）

9 工程・動画タイプ・キャスト・repo・台帳を 1 つの関係グラフにしたもの（派生 DB）。
正は `wf.yaml` / `casting.yaml` / `data/videos.jsonl` / `data/SCHEMA.md` で、DB は作り直せる。

```bash
bun ~/.skills/project-manager/ontology.ts build      # data/video-ontology.db を再生成
bun ~/.skills/project-manager/ontology.ts queries    # 代表クエリ一覧
bun ~/.skills/project-manager/ontology.ts q missing  # 工程別の未達数
bun ~/.skills/project-manager/ontology.ts q "SELECT * FROM v_next LIMIT 5"
```

- 型付きテーブル: `stages` / `repos` / `types` / `cast_roles` / `type_cast` / `vocab` / `ledger_fields` / `videos`
- 汎用グラフ: `nodes`（134）/ `edges`（186）。rel は `uses` / `produces` / `stored_in` / `cast_as` / `runs_on` / `needs_key` / `has_status` / `of_type` / `in_series` / `reached`
- 状態: `stage_state`（毎回作り直す）+ ビュー `v_progress` / `v_missing` / `v_next`
- 判定アルゴリズムは `lib/stages.ts` の 1 箇所（`pm.ts` もここを使う）
- 代表クエリは `data/queries.sql`（スキーマは `data/video-ontology.sql`）

## crawl（巡回検査・cron）

台帳・成果物の有無だけでなく、**実体ファイル（MEGA）と整合**まで見る。cron から回す前提で exit 1 を返す。

```bash
pm crawl                  # 全本。問題があれば exit 1
pm crawl --json           # 機械可読
pm crawl --write --quiet  # state/crawl-latest.json + state/crawl.jsonl に記録（1 行サマリ）
```

見るもの:
- 台帳の `file` が MEGA に実在するか／命名が `<no>-<slug>__<status>__<YYYYMMDD>.<ext>` か
- `status` と `file` / `youtube_id` / `stats.fetched_at` の整合（例: uploaded なのに youtube_id 無し、stats が 7 日以上古い）
- 9 工程すべて到達なのに未公開、slug 重複、`no` の欠落
- gate（中身）の不合格数

cron（2026-09-29 追加、6 時間毎）:

```
17 */6 * * * cd /home/sexy/.skills/project-manager && /home/sexy/.bun/bin/bun pm.ts crawl --write --quiet >> /home/sexy/.skills/project-manager/state/crawl.log 2>&1
```

## gate（通過条件）の検査

「ファイルが在るか」ではなく**中身**を見る。定義は `wf.yaml` の `checks`（1 条件 = 1 行）。

```bash
pm gate                       # 全本 × 全 check の不合成約（どの gate が詰まっているか）
pm gate typesafe-jev          # 1 本の全 gate
pm gate typesafe-jev tts      # その工程の gate だけ
video-ontology q gate-fail     # オントロジ経由で集約
video-ontology q manual        # 自動判定しない条件（人手で確認）
```

- kind: `presence` / `count` / `words` / `chars` / `contains` / `duration` / `suffix` / `aspect` / `number` / `youtube` / `manual`
- `from_type: true` は期待値を `casting.yaml` の `types.<kind>`（`aspect` / `chars` / `seconds`）から取る
- 尺の期待値は台帳の `target_seconds` が優先（無ければ型の `seconds`、許容 ±35%）
- `manual` は「通った」扱いにしない（✅/✗/・ の 3 値。例: 画像に文字を焼いていない、RUBRIC 9 軸）

## 役割分担（人間は視聴とダメ出しだけ）

```
人間   view（videoman serve で見る） / review（ダメ出し → reviews.jsonl、必要なら issue）
agent  neta → script → tts → prompt → image → se → mux → deploy → metrics
```

`wf.yaml` の `who` は全工程 `agent`、`human:` セクションが人間の関所（視聴・ダメ出し）を型として持つ。
`casting.yaml` の `roles.human / roles.agent` も同じ分担。企画（neta）と投稿（deploy）も agent が回し、
人間は**事後に見てダメ出しする**（差し戻しは reviews.jsonl / issue）。

```bash
video-ontology q human           # 人間の関所と落とし先
video-ontology q human-vs-agent  # 工程の担当（現在は 9/9 が agent）
```

## 責務の境界

| やること | やらないこと（持ち主） |
|---|---|
| 9 要素の検査・次の一手、台帳と定義の保持 | 台帳の更新（videoman） |
| 役割分担の型（人間=視聴/ダメ出し、agent=企画〜投稿） | ダメ出しの受付（videoman reviewer） |
| 工程ボード（横断/縦断） | 成果物の生成（各 repo） |
| 抜け・GATE の指摘 | 投稿（yt-upload）/ 統計取得（yt-dlp） |

## ファイル

- `pm.ts` — 検査本体（bun）
- `lib/stages.ts` — 工程の状態判定（PM とオントロジで共有する唯一の実装）
- `lib/gates.ts` — gate（通過条件）の検査器。定義は `wf.yaml` の `checks`
- `ontology.ts` — 動画ドメインのオントロジを組み立てる（`data/video-ontology.db`）
- `data/video-ontology.sql` — そのスキーマ。`data/queries.sql` — 代表クエリ
- `diagram.ts` — `wf.yaml`/`casting.yaml` から `pipeline.html`（Mermaid の図）を生成
- `board.ts` — 台本部（script WF）を `script.html` にする（seed / PR / issue / 完成）
- `dash.ts` — 進捗ダッシュボード（`progress.html`）と束ねた `index.html` を生成
- `progress.html` / `pipeline.html` / `script.html` / `index.html` — 生成物（`pm dashboards` / `pm index` が作って開く）
- `pipeline.html` — パイプラインの図（工程・orchestration・キャスト・タイプ・WF↔repo）
- `kanban.html` — 台帳 status の列 × カード（サムネ + 9 要素の到達 + gate 不合 + 次の一手）
- `progress.html` — 本 × 9 工程のマトリクス・到達率・工程別の未達・キャスト表
- `wf.yaml` — 9 要素の定義・roots・成果物パターン・WF↔repo
- `data/videos.jsonl` — 台帳（canonical）。`data/SCHEMA.md` — そのスキーマ
- `state/` — 生成キャッシュ（nvidia-ok.json 等）
- `casting.yaml` — 誰に・どのモデルで・どの鍵で（動画タイプ別のキャスト表）

## キャスト表（誰に・どのモデルで・どの鍵で）

`casting.yaml` が正。動画タイプ（`types.<type>.use`）で使う工程を選び、`cast` で上書きする。

| 役割(WF) | agent | model | token(env) |
|---|---|---|---|
| PM / 進行 | `pm` | `opencode-go/kimi-k3` | OPENCODE_API_KEY |
| 台本 script | `lumiere` | `opencode-go/grok-4.5`（essay は deepseek） | OPENCODE_API_KEY |
| 読み上げ tts | `sakura-tts` | `sakura` | SAKURA_API_KEY |
| 画像 image | `image-gen` | `cf-flux` | （wrangler OAuth） |
| SE | `se-synth` | local | - |
| 結合 mux | `lumiere` | local | - |
| 統計 metrics | `metrics` | yt-dlp | - |
| 検証 qc | `qc` | `nvidia-nim` | NVIDIA_API_KEY |

- 鍵は env 名だけ書く（値は repo に置かない）。
- タイプ: `essay`（横 long）/ `short`（縦）/ `koma`（4 コマ）/ `explainer`（repo 解説）。
- 文字起こし（stt / deepgram）は**別プロジェクト `~/.skills/SHITAGAKI`（下書き）**で使う。ここでは tts（Sakura）を使う。

## WF ↔ repo

| 工程 | repo |
|---|---|
| neta | video-gen/themes, video-studio/projects |
| script | talkscripts/<series>, video-gen/data/programs, video-pipeline/content |
| tts | video-gen/data/audio, video-pipeline/tts, video-studio/out |
| prompt | video-gen/themes, video-studio/out |
| image | video-gen/data, video-studio/out |
| se | video-studio/out, 4koma-video |
| mux | video-gen/data/motion, video-pipeline/videos, video-studio/out, MEGA |
| deploy | YouTube, MEGA |
| metrics | YouTube, kanalvideo-analysis/data/db |

## 関連

- `videoman` — 台帳・MEGA 命名・投稿・統計
- `~/.skills/video-studio/contract/index.yaml` — 型と flow（正）
- `~/.skills/aw-workflow-skill` — GATE → AW → stages → artifacts
