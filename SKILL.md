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

## 使い方

```bash
bun ~/.skills/project-manager/pm.ts            # 全プロジェクトのマトリクス（9 要素）
bun ~/.skills/project-manager/pm.ts <slug>     # 1 本の詳細 + 次の一手
bun ~/.skills/project-manager/pm.ts wf script  # 台本部ボード（seed / review / done）
bun ~/.skills/project-manager/pm.ts wf         # WF 一覧
bun ~/.skills/project-manager/pm.ts dashboards  # 進捗/工程図/台本部 の HTML を作って開く（--no-open で生成のみ）
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

## 責務の境界

| やること | やらないこと（持ち主） |
|---|---|
| 9 要素の検査・次の一手、台帳と定義の保持 | 台帳の更新（videoman） |
| 工程ボード（横断/縦断） | 成果物の生成（各 repo） |
| 抜け・GATE の指摘 | 投稿（yt-upload）/ 統計取得（yt-dlp） |

## ファイル

- `pm.ts` — 検査本体（bun）
- `lib/stages.ts` — 工程の状態判定（PM とオントロジで共有する唯一の実装）
- `ontology.ts` — 動画ドメインのオントロジを組み立てる（`data/video-ontology.db`）
- `data/video-ontology.sql` — そのスキーマ。`data/queries.sql` — 代表クエリ
- `diagram.ts` — `wf.yaml`/`casting.yaml` から `pipeline.html`（Mermaid の図）を生成
- `board.ts` — 台本部（script WF）を `script.html` にする（seed / PR / issue / 完成）
- `dash.ts` — 進捗ダッシュボード（`progress.html`）と束ねた `index.html` を生成
- `progress.html` / `pipeline.html` / `script.html` / `index.html` — 生成物（`pm dashboards` / `pm index` が作って開く）
- `pipeline.html` — パイプラインの図（工程・orchestration・キャスト・タイプ・WF↔repo）
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
