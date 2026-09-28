# nvidia (build.nvidia.com) — 使えるモデル（実測）

endpoint: `https://integrate.api.nvidia.com/v1`（OpenAI 互換）
key: `NVIDIA_API_KEY`（WSL env にあり。repo に置かない）
account: `mNTmcCAC3UzON9i6lxCta9ZwLncPcaCgEdUFxSoRtSg`

計測 2026-09-29。`/v1/models` は**鍵なしで 200**（公開カタログ）なので、鍵の検証にはならない。
推論で確かめること。404 は「カタログにはあるが、このアカウントには提供なし」。

## OK（このアカウントで動く）

| model | 用途 |
|---|---|
| `meta/llama-3.2-11b-vision-instruct` | vision（速い。QC の既定） |
| `meta/muse-glimmer-30b` | 汎用 |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | reasoning |
| `nvidia/nemotron-3-ultra-550b-a55b` | 大型 |
| `openai/gpt-oss-20b` | 汎用 |
| `z-ai/glm-5.3-flash` | 速い |
| `deepseek-ai/deepseek-v4.1-flash` | **deepseek が nvidia 経由で無料**（有料回避に使える） |

## 不安定 / 遅い（今は避ける）

- 503（混雑）: `nvidia/nemotron-3-super-120b-a12b`, `poolside/laguna-xs-2.1`
- 000（応答なし）: `meta/llama-3.2-90b-vision-instruct`, `moonshotai/kimi-k3`, `nvidia/nemotron-3.5-lightning-30b-a3b`, `z-ai/glm-5.3`

## 404（このアカウントには提供なし。カタログにあるだけ）

`google/gemma-3-12b-it` `google/gemma-3-4b-it` `mistralai/mistral-7b-instruct-v0.3`
`moonshotai/kimi-k2.6` `nvidia/cosmos-reason2-8b` `nvidia/llama-3.1-nemotron-70b-instruct`
`nvidia/llama-3.1-nemotron-ultra-253b-v1`

## 画像（flux）について

`https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell` は別ホストで
この鍵では 401（build.nvidia.com の鍵は integrate 用）。画像は今のところ
`pollinations` / `cf-flux` のまま。サイズは 768〜1344 の 64 刻み（1080x1920 は不可）。
