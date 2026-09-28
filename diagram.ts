#!/usr/bin/env bun
// diagram.ts — wf.yaml / casting.yaml から pipeline.html（Mermaid）を生成する。
// 定義が変わったら回すだけ。図と定義がずれない。
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dir;
const wf = Bun.YAML.parse(readFileSync(join(HERE, "wf.yaml"), "utf8")) as {
  flow: string[];
  wfs: Array<{ id: string; name: string; who?: string; agent?: string; outside?: boolean; produces?: string }>;
  repos?: Record<string, string[]>;
};
const cast = Bun.YAML.parse(readFileSync(join(HERE, "casting.yaml"), "utf8")) as {
  policy?: { prefer?: string[]; paid_last?: string[] };
  defaults?: Record<string, { agent?: string; model?: string; engine?: string; token?: string }>;
  types?: Record<string, { aspect?: string; use?: string[] }>;
};

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const wfOf = (id: string) => wf.wfs.find((w) => w.id === id);
const d = (id: string) => cast.defaults?.[id] ?? {};

function who(id: string): string {
  const w = wfOf(id);
  const c = d(id);
  if (w?.who === "human") return w.outside ? "human·出先" : "human";
  const agent = w?.agent ?? c.agent ?? "agent";
  return c.engine && c.engine !== "local" ? `${agent} · ${c.engine}` : agent;
}

// 線形フロー
const nodes = wf.flow.map((id) => `  ${id}["${esc(wfOf(id)?.name ?? id)}<br/><small>${esc(who(id))}</small>"]`).join("\n");
const edges = wf.flow.slice(1).map((id, i) => `  ${wf.flow[i]} --> ${id}`).join("\n");
// 台本と同時にサムネプロンプト（点線で image へ）
const extra = `  script -. サムネプロンプト同時 .-> image`;

const nodeClass = wf.flow
  .map((id) => {
    const w = wfOf(id);
    return `  class ${id} ${w?.who === "human" ? "human" : "agent"}`;
  })
  .join("\n");

const castRows = Object.entries(cast.defaults ?? {})
  .map(([id, c]) => `<tr><td>${esc(wfOf(id)?.name ?? id)} <small>(${esc(id)})</small></td><td>${esc(c.agent)}</td><td><code>${esc(c.model)}</code></td><td>${esc(c.engine ?? "-")}</td><td><code>${esc(c.token || "-")}</code></td></tr>`)
  .join("");

const typeRows = Object.entries(cast.types ?? {})
  .map(([t, v]) => `<tr><td><code>${esc(t)}</code></td><td>${esc(v.aspect ?? "-")}</td><td>${(v.use ?? []).map((x) => esc(wfOf(x)?.name ?? x)).join(" → ")}</td></tr>`)
  .join("");

const repoRows = Object.entries(wf.repos ?? {})
  .map(([id, list]) => `<tr><td>${esc(wfOf(id)?.name ?? id)} <small>(${esc(id)})</small></td><td>${(list ?? []).map((r) => `<code>${esc(r)}</code>`).join(" ")}</td></tr>`)
  .join("");

const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>pipeline workflow — videoman</title>
<link rel="icon" href="data:,">
<style>
:root{--bg:#0d1117;--panel:#161b22;--fg:#e6edf3;--mut:#8b949e;--bd:#30363d;--acc:#58a6ff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}
.wrap{max-width:1100px;margin:0 auto;padding:24px 16px 80px}
h1{font-size:20px;margin:0 0 4px}
h2{font-size:14px;margin:28px 0 10px;border-top:1px solid var(--bd);padding-top:16px}
.sub{color:var(--mut);font-size:12px;margin-bottom:16px}
.mermaid{background:var(--panel);border:1px solid var(--bd);border-radius:10px;padding:16px;overflow:auto}
table{width:100%;border-collapse:collapse;margin:6px 0}
td,th{padding:6px 8px;border-bottom:1px solid var(--bd);text-align:left;font-size:12px;vertical-align:top}
th{color:var(--mut);font-weight:400;font-size:11px}
code{background:#21262d;border-radius:4px;padding:0 4px}
small{color:var(--mut)}
.badge{display:inline-block;background:#21262d;border-radius:9px;padding:1px 8px;color:var(--mut);font-size:11px;margin-right:6px}
</style>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
</head><body><div class="wrap">
<h1>pipeline workflow</h1>
<div class="sub">正: <code>wf.yaml</code> / <code>casting.yaml</code>（生成: diagram.ts）· 方針: ${(cast.policy?.prefer ?? []).join(" / ")} 優先、${(cast.policy?.paid_last ?? []).join("/")} は最後の要</div>

<h2>1. 工程（WF）の流れ</h2>
<pre class="mermaid">
flowchart LR
${nodes}
${edges}
${extra}
${nodeClass}
  classDef human fill:#1f6feb,stroke:#1f6feb,color:#fff;
  classDef agent fill:#21262d,stroke:#30363d,color:#e6edf3;
</pre>

<h2>2. 誰が振るか（orchestration）</h2>
<pre class="mermaid">
flowchart TB
  canonical[("videoman canonical")] --> pm["PM<br/><small>9要素を検査</small>"]
  files[("各 repo の成果物")] --> pm
  pm -- "pm plan json" --> orch["orchestrator<br/><small>issue 化・割当</small>"]
  orch --> human["人間<br/><small>出先・スマホ</small>"]
  orch --> workers["worker agents<br/><small>script/tts/image/se/mux/metrics</small>"]
  human --> issue[("GitHub Issue<br/>wf:* who:*")]
  workers --> issue
</pre>

<h2>3. キャスト（誰に・どのモデルで・どの鍵で）</h2>
<table><tr><th>役割</th><th>agent</th><th>model</th><th>engine</th><th>token(env)</th></tr>${castRows}</table>

<h2>4. 動画タイプ（使う工程 / aspect）</h2>
<table><tr><th>type</th><th>aspect</th><th>工程順</th></tr>${typeRows}</table>

<h2>5. 工程 ↔ repo</h2>
<table><tr><th>工程</th><th>repo</th></tr>${repoRows}</table>
</div>
<script>mermaid.initialize({startOnLoad:true,theme:"dark",flowchart:{curve:"basis"}});</script>
</body></html>`;

writeFileSync(join(HERE, "pipeline.html"), html);
console.log(`wrote ${join(HERE, "pipeline.html")}`);
