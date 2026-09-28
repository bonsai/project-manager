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
- 台帳は videoman の canonical（`~/.skills/kanalvideo-analysis/pipeline/videos.jsonl`。`VIDEOMAN_JSONL` で差し替え）。
- 成果物は `wf.yaml` の `roots` × `artifacts` を glob して見る（ファイルの有無が状態）。

## 使い方

```bash
bun ~/.skills/project-manager/pm.ts            # 全プロジェクトのマトリクス（9 要素）
bun ~/.skills/project-manager/pm.ts <slug>     # 1 本の詳細 + 次の一手
bun ~/.skills/project-manager/pm.ts wf script  # 台本部ボード（seed / review / done）
bun ~/.skills/project-manager/pm.ts wf         # WF 一覧
```

## 責務の境界

| やること | やらないこと（持ち主） |
|---|---|
| 9 要素の検査・次の一手 | 台帳の更新（videoman） |
| 工程ボード（横断/縦断） | 成果物の生成（各 repo） |
| 抜け・GATE の指摘 | 投稿（yt-upload）/ 統計取得（yt-dlp） |

## ファイル

- `pm.ts` — 検査本体（bun）
- `wf.yaml` — 9 要素の定義・roots・成果物パターン・WF↔repo
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
| 文字起こし stt | `stt` | `deepgram` | DEEPGRAM_API_KEY |
| 検証 qc | `qc` | `nvidia-nim` | NVIDIA_API_KEY |

- 鍵は env 名だけ書く（値は repo に置かない）。
- タイプ: `essay`（横 long）/ `short`（縦）/ `koma`（4 コマ）/ `explainer`（repo 解説）。

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
