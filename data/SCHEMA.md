# pipeline — 動画投稿管理の canonical

**ローカル動画と YouTube 投稿を 1 本の JSONL で管理する。** ここが唯一の正（canonical）。
SQLite / HTML / BigQuery はすべてこの JSONL から再生成される派生。

## 1 データ = 1 箇所

```
pipeline/videos.jsonl      canonical（git 管理、人間が編集可）
pipeline/pipeline.db       派生 SQLite（再生成可、gitignore）
report/pipeline.html       派生レポート（再生成可）
MEGA 上のメディア            動画・音声・サムネの実体（保管は MEGA に統一）
```

## ファイル名（履歴が分かる命名）

メディア実体の名前は、並べれば制作の履歴が読めるようにする。

```
<no>-<slug>__<status>__<YYYYMMDD>.<ext>
```

例:

| ファイル名 | 読めること |
|---|---|
| `01-entropy-shannon-llm-jev__uploaded__20260923.mp4` | #01 は 2026-09-23 に投稿済 |
| `02-borges-library-llm-reading__uploaded__20260923.mp4` | |
| `09-recap-journey__video__20260928.mp4` | #09 は 2026-09-28 に動画段階 |
| `10-typesafe-jev__video__20260927.mp4` | #10 は動画完成、未投稿 |

- `no` … 通し番号。作成順＝履歴の順序。
- `slug` … 内容の識別子。
- `status` … 現在の段階（下記）。
- `YYYYMMDD` … その段階に到達した日。**同じ slug が複数あれば版の履歴になる。**

`videoman plan --apply` がこの命名へ揃える（既定は `--dry-run`）。

## status（段階）

```
idea → script → audio → video → ready → uploaded
                                  ↘ held / dropped
```

| status | 意味 | メディア |
|---|---|---|
| `idea` | 作る候補。企画のみ | 無し（file 空） |
| `script` | 台本あり | 台本 md |
| `audio` | 音声あり | mp3/wav |
| `video` | 動画あり、未検査 | mp4 |
| `ready` | 検査済み、投稿可 | mp4 |
| `uploaded` | YouTube 公開済み | mp4（MEGA 保管） |
| `held` | 保留 | - |
| `dropped` | 中止 | - |

## レコード例

```json
{
  "no": "09",
  "slug": "recap-journey",
  "title": "Recap Journey",
  "series": "recap",
  "kind": "short",
  "status": "video",
  "stage_date": "2026-09-28",
  "target_seconds": 30,
  "file": "09-recap-journey__video__20260928.mp4",
  "assets": {"script": "recap-journey-01-script.txt", "audio": "recap-journey-02-narration.wav", "thumb": "recap-journey-03-visual.png"},
  "youtube_id": null,
  "url": null,
  "published_at": null,
  "planned_for": null,
  "channel": "kanalvideo",
  "history": [
    {"at": "2026-09-28", "status": "script"},
    {"at": "2026-09-28", "status": "audio"},
    {"at": "2026-09-28", "status": "video"}
  ],
  "stats": {"views": null, "likes": null, "comments": null, "fetched_at": null},
  "notes": ""
}
```

### 任意フィールド

| フィールド | 意味 |
|---|---|
| `kind` | 動画タイプ。**`short` は 90 秒以下のみ**（超えたら `long` 系）。型の定義は `casting.yaml` の `types` |
| `target_seconds` | 計画尺（秒）。gate の尺チェックの期待値。無ければ動画タイプ（`casting.yaml` の `types.<kind>.seconds`）を使う |

## 全動画リスト + これから作るリスト

同じ JSONL に混在させる。`status: idea` がこれから作るもの（`file` は空）。
`videoman plan` / `videoman ls` が両方を 1 画面に出す。
