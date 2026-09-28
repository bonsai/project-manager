#!/usr/bin/env bun
// dash.ts — PM の進捗ダッシュボード（progress.html）と、束ねた index.html を生成する。
//
//   bun dash.ts           progress.html + index.html
//   bun dash.ts progress  progress.html だけ
//
// 進捗の判定は lib/stages.ts（pm.ts と同じ実装）。値を持たず、毎回作り直す。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadWfDoc, stageState, type Video } from "./lib/stages";

const HERE = import.meta.dir;
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const doc = loadWfDoc(join(HERE, "wf.yaml"));
const cast = Bun.YAML.parse(readFileSync(join(HERE, "casting.yaml"), "utf8")) as {
  policy?: { prefer?: string[]; paid_last?: string[] };
  defaults?: Record<string, { agent?: string; model?: string; engine?: string; token?: string }>;
  types?: Record<string, { aspect?: string; use?: string[]; cast?: Record<string, { agent?: string; model?: string; why?: string }> }>;
};

const ledgerPath = process.env.VIDEOMAN_JSONL ?? join(HERE, "data/videos.jsonl");
const videos: Video[] = readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Video);
const rows = videos.map((v) => ({ v, st: stageState(v, doc), reached: 0 }));
for (const r of rows) r.reached = r.st.filter((x) => x.ok).length;

const total = doc.flow.length;
const cells = rows.length * total;
const okCells = rows.reduce((a, r) => a + r.reached, 0);
const nameOf = new Map(doc.wfs.map((w) => [w.id, w.name]));

function who(id: string): string {
  const w = doc.wfs.find((x) => x.id === id);
  if (!w) return "-";
  if (w.who === "human") return w.outside ? "human·出先" : "human";
  const c = cast.defaults?.[id] ?? {};
  const agent = w.agent ?? c.agent ?? "agent";
  return c.engine && c.engine !== "local" ? `${agent} · ${c.engine}` : agent;
}

const bar = (n: number, of: number, w = 12) => {
  const f = of ? Math.round((n / of) * w) : 0;
  return `<span class="bar">${"▰".repeat(f)}${"▱".repeat(w - f)}</span>`;
};

// ── マトリクス（本 × 工程）
const matrix = rows
  .map(({ v, st, reached }) => {
    const cellsHtml = st
      .map((s) => `<td class="c${s.ok ? " ok" : ""}" title="${esc(s.id)}: ${esc(s.ref || "未")}">${s.ok ? "✅" : "·"}</td>`)
      .join("");
    const next = st.find((s) => !s.ok);
    return `<tr><td>${esc(v.no)}</td><td><code>${esc(v.slug)}</code><br><small>${esc(v.title ?? "")}</small></td>${cellsHtml}` +
      `<td>${bar(reached, total)} <small>${reached}/${total}</small></td>` +
      `<td>${next ? `<small>${esc(next.id)}</small> ${esc(who(next.id))}` : "<small>完了</small>"}</td></tr>`;
  })
  .join("");

// ── 工程別の未達
const tally = new Map(doc.flow.map((id) => [id, 0]));
for (const { st } of rows) for (const s of st) if (!s.ok) tally.set(s.id, (tally.get(s.id) ?? 0) + 1);
const missing = doc.flow
  .map((id) => ({ id, n: tally.get(id) ?? 0 }))
  .sort((a, b) => b.n - a.n || doc.flow.indexOf(a.id) - doc.flow.indexOf(b.id))
  .map((r) => `<tr><td><code>${esc(r.id)}</code></td><td>${esc(nameOf.get(r.id) ?? "")}</td><td>${esc(who(r.id))}</td>` +
    `<td>${bar(r.n, rows.length)} <small>${r.n} 件</small></td></tr>`)
  .join("");

// ── タイプとキャスト
const typeRows = Object.entries(cast.types ?? {})
  .map(([t, v]) => `<tr><td><code>${esc(t)}</code></td><td>${esc(v.aspect ?? "-")}</td>` +
    `<td>${(v.use ?? []).map((x) => esc(nameOf.get(x) ?? x)).join(" → ")}</td>` +
    `<td><small>${(v.cast ? Object.entries(v.cast).map(([r, o]) => `${esc(r)}: ${esc(o.model ?? o.agent ?? "")}`) : []).join(", ") || "-"}</small></td></tr>`)
  .join("");

const castRows = Object.entries(cast.defaults ?? {})
  .map(([id, c]) => `<tr><td>${esc(nameOf.get(id) ?? id)} <small>(${esc(id)})</small></td><td>${esc(c.agent ?? "-")}</td>` +
    `<td><code>${esc(c.model ?? "-")}</code></td><td>${esc(c.engine ?? "-")}</td><td><code>${esc(c.token || "-")}</code></td></tr>`)
  .join("");

const head = doc.flow.map((id) => `<th title="${esc(nameOf.get(id) ?? id)}">${esc(id.slice(0, 3))}</th>`).join("");

const progress = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PM 進捗 — 9 要素</title><link rel="icon" href="data:,">
<style>
:root{--bg:#0d1117;--panel:#161b22;--fg:#e6edf3;--mut:#8b949e;--bd:#30363d;--acc:#58a6ff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}
.wrap{max-width:1100px;margin:0 auto;padding:24px 16px 80px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:28px 0 10px;border-top:1px solid var(--bd);padding-top:16px}
.sub{color:var(--mut);font-size:12px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;margin:6px 0}
td,th{padding:6px 8px;border-bottom:1px solid var(--bd);text-align:left;font-size:12px;vertical-align:top}
th{color:var(--mut);font-weight:400;font-size:11px}
code{background:#21262d;border-radius:4px;padding:0 4px}small{color:var(--mut)}
.c{text-align:center;width:34px}.c.ok{background:#0f2c17}.bar{color:var(--acc);letter-spacing:-1px}
.kpi{display:flex;gap:16px;flex-wrap:wrap;margin:12px 0 0}
.kpi div{background:var(--panel);border:1px solid var(--bd);border-radius:10px;padding:10px 14px;min-width:130px}
.kpi b{font-size:20px;display:block}
</style></head><body><div class="wrap">
<h1>PM 進捗 — 9 要素</h1>
<div class="sub">台帳 ${esc(ledgerPath.replace(process.env.HOME ?? "", "~"))} / 生成 ${new Date().toISOString().slice(0, 16)}</div>
<div class="kpi">
  <div><small>本</small><b>${rows.length}</b></div>
  <div><small>到達セル</small><b>${okCells}/${cells}</b></div>
  <div><small>達成率</small><b>${((okCells / cells) * 100).toFixed(1)}%</b></div>
  <div><small>9/9 の本</small><b>${rows.filter((r) => r.reached === total).length}</b></div>
</div>
<h2>本 × 工程</h2>
<table><tr><th>no</th><th>slug</th>${head}<th>到達</th><th>次の一手</th></tr>${matrix}</table>
<h2>工程別の未達（次に片付ける順）</h2>
<table><tr><th>工程</th><th>名前</th><th>担当</th><th>未達</th></tr>${missing}</table>
<h2>タイプ別</h2>
<table><tr><th>type</th><th>aspect</th><th>使う工程</th><th>上書き</th></tr>${typeRows}</table>
<h2>キャスト（誰に・どのモデルで・どの鍵で）</h2>
<table><tr><th>工程</th><th>agent</th><th>model</th><th>engine</th><th>token(env)</th></tr>${castRows}</table>
</div></body></html>`;

const tabs: Array<[string, string]> = [
  ["進捗", "progress.html"],
  ["工程図", "pipeline.html"],
  ["台本部", "script.html"],
];
const btns = tabs
  .map(([n, src], i) => `<button data-src="${src}"${i === 0 ? " class='on'" : ""}>${n}</button>`)
  .join("");
const available = tabs.filter(([, src]) => existsSync(join(HERE, src)));
const first = available[0]?.[1] ?? "progress.html";
const index = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>PM dashboards</title>
<style>:root{--bg:#0d1117;--panel:#161b22;--fg:#e6edf3;--mut:#8b949e;--bd:#30363d;--acc:#58a6ff}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.5 ui-monospace,Menlo,monospace;display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--bd);background:var(--panel);flex-wrap:wrap}
header .t{color:var(--mut);font-size:11px;margin-right:8px}
button{background:#21262d;color:var(--fg);border:1px solid var(--bd);border-radius:7px;padding:5px 12px;font:inherit;cursor:pointer}
button.on{background:#1f6feb;border-color:#1f6feb}.sp{flex:1}
a{color:var(--acc);text-decoration:none;font-size:11px}
main{flex:1;min-height:0}iframe{width:100%;height:100%;border:0;background:var(--bg)}</style></head><body>
<header><span class='t'>PM dashboards</span>${btns}<span class='sp'></span><a id='open' href='${first}' target='_blank'>別タブで開く</a></header>
<main><iframe id='f' src='${first}'></iframe></main>
<script>const f=document.getElementById('f'),op=document.getElementById('open');
document.querySelectorAll('button[data-src]').forEach(b=>b.addEventListener('click',()=>{
document.querySelectorAll('button[data-src]').forEach(x=>x.classList.remove('on'));
b.classList.add('on');f.src=b.dataset.src;op.href=b.dataset.src;}));</script>
<!-- 生成 ${new Date().toISOString()} --></body></html>`;

const what = process.argv[2] ?? "all";
if (what === "all" || what === "progress") {
  writeFileSync(join(HERE, "progress.html"), progress);
  console.log(`wrote ${join(HERE, "progress.html")}`);
}
if (what === "all" || what === "index") {
  writeFileSync(join(HERE, "index.html"), index);
  console.log(`wrote ${join(HERE, "index.html")}（${tabs.map(([n]) => n).join(" / ")}）`);
}
