#!/usr/bin/env bun
// dash.ts — PM の進捗ダッシュボード（progress.html）と、束ねた index.html を生成する。
//
//   bun dash.ts           progress.html + index.html
//   bun dash.ts progress  progress.html だけ
//
// 進捗の判定は lib/stages.ts（工程の有無）と lib/gates.ts（中身）。値を持たず、毎回作り直す。
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactsFor, loadWfDoc, short, stageState, type Video } from "./lib/stages";
import { runChecks, type TypeSpec } from "./lib/gates";

const HERE = import.meta.dir;
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const doc = loadWfDoc(join(HERE, "wf.yaml"));
const human = (doc as { human?: { view?: string; review?: string; sinks?: string[]; outside?: boolean } }).human ?? {};
const cast = Bun.YAML.parse(readFileSync(join(HERE, "casting.yaml"), "utf8")) as {
  policy?: { prefer?: string[]; paid_last?: string[] };
  defaults?: Record<string, { agent?: string; model?: string; engine?: string; token?: string }>;
  types?: Record<
    string,
    { aspect?: string; seconds?: number; chars?: [number, number]; use?: string[]; cast?: Record<string, { agent?: string; model?: string; why?: string }> }
  >;
};
type TypeSpec2 = TypeSpec & { use?: string[] };
const types = (cast.types ?? {}) as Record<string, TypeSpec2>;

const ledgerPath = process.env.VIDEOMAN_JSONL ?? join(HERE, "data/videos.jsonl");
const videos: Video[] = readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Video);
const rows = videos.map((v) => ({ v, st: stageState(v, doc), checks: runChecks(v, doc, doc.checks ?? [], types), reached: 0 }));
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

// ── サムネを dash-thumbs/ へ集める（file:// でも確実に出るように相対配置）
const THUMBS = join(HERE, "dash-thumbs");
rmSync(THUMBS, { recursive: true, force: true });
mkdirSync(THUMBS, { recursive: true });
const thumbOf = new Map<string, string>();

function localThumb(v: Video): string | null {
  const files = artifactsFor(v.slug, doc);
  const cands = [
    ...(files.image ?? []).filter((f) => /\.(png|jpe?g)$/i.test(f)),
    join(process.env.HOME ?? "", `.skills/video-gen/data/${v.slug}/thumbnail.png`),
    join(process.env.HOME ?? "", `.skills/video-studio/out/${v.slug}/thumbnail.png`),
  ];
  for (const f of cands) if (f && existsSync(f)) return f;
  const dir = join(process.env.HOME ?? "", ".skills/video-studio/out");
  for (const [tid, r] of rows.map((r) => [r.v.slug, r] as const)) void [tid, r];
  for (const base of [join(process.env.HOME ?? "", `.skills/video-gen/data/${v.slug}`), join(dir, v.slug)]) {
    if (!existsSync(base)) continue;
    const hit = new Bun.Glob("*.{png,jpg,jpeg}").scanSync({ cwd: base, onlyFiles: true });
    for (const f of hit) if (/thumb|image|cover/i.test(f)) return join(base, f);
  }
  return null;
}

for (const { v } of rows) {
  const src = localThumb(v);
  if (!src) continue;
  const ext = (src.split(".").pop() ?? "png").toLowerCase().replace("jpeg", "jpg");
  const dst = join(THUMBS, `${v.slug}.${ext}`);
  try {
    copyFileSync(src, dst);
    thumbOf.set(v.slug, `dash-thumbs/${v.slug}.${ext}`);
  } catch {
    /* 画像が無ければ placeholder */
  }
}

// ── 本ごとのカード
const cards = rows
  .map(({ v, st, checks, reached }) => {
    const t = types[String(v.kind ?? "")] ?? {};
    const steps = st
      .map((s) => `<span class="step${s.ok ? " ok" : ""}" title="${esc(s.id)}: ${esc(s.ref || "未")}">${esc(s.id.slice(0, 3))}</span>`)
      .join("");
    const bad = checks.filter((c) => !c.ok && !c.manual);
    const man = checks.filter((c) => c.manual);
    const next = st.find((s) => !s.ok);
    const yt = v.youtube_id
      ? `<a href="https://youtu.be/${esc(v.youtube_id)}" target="_blank">https://youtu.be/${esc(v.youtube_id)}</a>${v.stats?.views != null ? ` <small>${v.stats.views} views</small>` : ""}`
      : "<small>未公開</small>";
    const thumb = thumbOf.get(v.slug);
    return `<article class="card">
  <div class="thumb">${thumb ? `<img src="${esc(thumb)}" alt="${esc(v.slug)}">` : `<div class="ph">no image</div>`}</div>
  <div class="body">
    <h3><span class="no">#${esc(v.no)}</span> ${esc(v.slug)} <small>${esc(v.kind ?? "?")} · ${esc(t.aspect ?? "-")} · ${esc(v.status ?? "?")}${v.target_seconds ? ` · ${esc(v.target_seconds)}s 目標` : ""}</small></h3>
    <p class="title">${esc(v.title ?? "")}</p>
    <div class="steps">${steps}<span class="cnt">${reached}/${total}</span></div>
    ${bad.length ? `<ul class="gates">${bad.slice(0, 4).map((b) => `<li>✗ <code>${esc(b.id)}</code> ${esc(b.detail)}</li>`).join("")}${bad.length > 4 ? `<li><small>… 他 ${bad.length - 4} 件</small></li>` : ""}</ul>` : `<p class="allok">gate ✅（auto ${checks.filter((c) => !c.manual).length}/${checks.filter((c) => !c.manual).length}）</p>`}
    ${man.length ? `<p class="manual">人手: ${man.map((m) => esc(m.id)).join(", ")}</p>` : ""}
    <p class="next">次: <b>${next ? esc(next.id) : "完了"}</b>${next ? ` <small>${esc(who(next.id))}</small>` : ""}</p>
    <p class="links">${yt}${v.file ? ` <small>${esc(v.file)}</small>` : ""}</p>
  </div>
</article>`;
  })
  .join("");

// ── 工程別の未達
const tally = new Map(doc.flow.map((id) => [id, 0]));
for (const { st } of rows) for (const s of st) if (!s.ok) tally.set(s.id, (tally.get(s.id) ?? 0) + 1);
const missing = [...tally.entries()]
  .sort((a, b) => b[1] - a[1] || doc.flow.indexOf(a[0]) - doc.flow.indexOf(b[0]))
  .map(([id, n]) => `<tr><td><code>${esc(id)}</code></td><td>${esc(nameOf.get(id) ?? "")}</td><td>${esc(who(id))}</td><td>${bar(n, rows.length)} <small>${n} 件</small></td></tr>`)
  .join("");

// ── gate の集約
const gateTally = new Map<string, { stage: string; fail: number; pass: number; manual: number; note: string }>();
for (const { checks } of rows) {
  for (const c of checks) {
    const t = gateTally.get(c.id) ?? { stage: c.stage, fail: 0, pass: 0, manual: 0, note: (doc.checks ?? []).find((x) => x.id === c.id)?.note ?? "" };
    if (c.manual) t.manual++;
    else if (c.ok) t.pass++;
    else t.fail++;
    gateTally.set(c.id, t);
  }
}
const gateRows = [...gateTally.entries()]
  .sort((a, b) => b[1].fail - a[1].fail || a[0].localeCompare(b[0]))
  .map(([id, t]) => `<tr><td>${t.fail > 0 ? "✗" : t.manual > 0 ? "・" : "✅"}</td><td><code>${esc(id)}</code></td><td>${esc(t.stage)}</td><td>${bar(t.pass, t.pass + t.fail)} <small>合格 ${t.pass} / 不合 ${t.fail}${t.manual ? ` / 人手 ${t.manual}` : ""}</small></td><td><small>${esc(t.note)}</small></td></tr>`)
  .join("");

// ── ある工程の詰まり（gate 不合格の実例）
const examples = rows
  .flatMap(({ v, checks }) => checks.filter((c) => !c.ok && !c.manual).map((c) => ({ slug: v.slug, no: v.no, ...c })))
  .slice(0, 24)
  .map((c) => `<tr><td>${esc(c.no)}</td><td><code>${esc(c.slug)}</code></td><td>${esc(c.stage)}</td><td><code>${esc(c.id)}</code></td><td><small>${esc(c.detail)}</small></td></tr>`)
  .join("");

const typeRows = Object.entries(types)
  .map(([t, v]) => `<tr><td><code>${esc(t)}</code></td><td>${esc(v.aspect ?? "-")}</td><td>${v.seconds ? `${esc(v.seconds)}s` : "-"}</td><td>${(v.use ?? []).map((x) => esc(x.slice(0, 3))).join(" → ")}</td><td><small>${v.cast ? Object.entries(v.cast).map(([r, o]) => `${esc(r)}: ${esc(o.model ?? o.agent ?? "")}`).join(", ") : "-"}</small></td></tr>`)
  .join("");
const castRows = Object.entries(cast.defaults ?? {})
  .map(([id, c]) => `<tr><td>${esc(nameOf.get(id) ?? id)} <small>(${esc(id)})</small></td><td>${esc(c.agent ?? "-")}</td><td><code>${esc(c.model ?? "-")}</code></td><td>${esc(c.engine ?? "-")}</td><td><code>${esc(c.token || "-")}</code></td></tr>`)
  .join("");

// ── かんばん（台帳 status の列 × カード）
const KANBAN_COLS: Array<[string, string]> = [
  ["idea", "idea（候補）"], ["script", "script（台本）"], ["audio", "audio（音声）"],
  ["video", "video（動画）"], ["ready", "ready（投稿可）"], ["uploaded", "uploaded（公開）"],
  ["held", "held（保留）"], ["dropped", "dropped（中止）"],
];
const colOf = (v: Video) => String(v.status ?? "idea");
const kanban = KANBAN_COLS.map(([st, label]) => {
  const list = rows.filter((r) => colOf(r.v) === st);
  const items = list.map(({ v, st: stages, checks, reached }) => {
    const bad = checks.filter((c) => !c.ok && !c.manual).length;
    const next = stages.find((x) => !x.ok);
    const thumb = thumbOf.get(v.slug);
    return `<div class="kcard">
  ${thumb ? `<img src="${esc(thumb)}" alt="">` : `<div class="kph">no image</div>`}
  <div class="kbody">
    <b>#${esc(v.no)}</b> <code>${esc(v.slug)}</code>
    <div class="ktitle">${esc(v.title ?? "")}</div>
    <div class="kmeta">${esc(v.kind ?? "?")} · ${reached}/9 · gate 不合 ${bad}${v.youtube_id ? " · YT" : ""}</div>
    <div class="knext">${next ? `次: ${esc(next.id)}` : "全工程 ✅"}</div>
  </div>
</div>`;
  }).join("");
  return `<div class="kcol"><h3>${esc(label)} <small>${list.length}</small></h3>${items || `<div class=empty>-</div>`}</div>`;
}).join("");

const KANBAN_CSS = `
.kanban{display:grid;grid-template-columns:repeat(4,minmax(220px,1fr));gap:12px;align-items:start}
@media(max-width:1100px){.kanban{grid-template-columns:repeat(2,minmax(200px,1fr))}}
.kcol{background:var(--panel);border:1px solid var(--bd);border-radius:12px;padding:8px;min-height:80px}
.kcol h3{font-size:12px;margin:2px 0 8px;color:var(--fg)}
.kcol h3 small{color:var(--mut)}
.kcard{border:1px solid var(--bd);border-radius:9px;overflow:hidden;margin-bottom:8px;background:#0d1117;display:flex;gap:8px}
.kcard img{width:64px;height:64px;object-fit:cover;flex:0 0 64px}
.kph{width:64px;height:64px;flex:0 0 64px;display:flex;align-items:center;justify-content:center;color:var(--mut);font-size:10px;background:#161b22}
.kbody{padding:6px 8px 6px 0;min-width:0}
.ktitle{color:var(--mut);font-size:11px;margin:2px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kmeta{color:var(--mut);font-size:10px}
.knext{font-size:11px;color:var(--acc)}
.empty{color:var(--mut);font-size:11px;padding:4px}
`;

const kanbanHtml = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PM かんばん — 台帳の段階</title><link rel="icon" href="data:,">
<style>
:root{--bg:#0d1117;--panel:#161b22;--fg:#e6edf3;--mut:#8b949e;--bd:#30363d;--acc:#58a6ff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}
.wrap{max-width:1400px;margin:0 auto;padding:20px 14px 60px}
h1{font-size:18px;margin:0 0 4px}h2{font-size:13px;margin:20px 0 8px;border-top:1px solid var(--bd);padding-top:12px}
.sub{color:var(--mut);font-size:12px;margin-bottom:12px}
code{background:#21262d;border-radius:4px;padding:0 4px}small{color:var(--mut)}
table{width:100%;border-collapse:collapse;margin:6px 0}
td,th{padding:6px 8px;border-bottom:1px solid var(--bd);text-align:left;font-size:12px}
th{color:var(--mut);font-weight:400;font-size:11px}
a{color:var(--acc)}
${KANBAN_CSS}
</style></head><body><div class="wrap">
<h1>PM かんばん — 台帳の段階</h1>
<div class="sub">台帳 ${esc(ledgerPath.replace(process.env.HOME ?? "", "~"))} / 生成 ${new Date().toISOString().slice(0, 16).replace("T", " ")} / 本 ${rows.length}</div>
<div class="kanban">${kanban}</div>
<h2>一覧（表）</h2>
<table><tr><th>no</th><th>slug</th><th>title</th><th>kind</th><th>status</th><th>9 要素</th><th>gate 不合</th><th>次の一手</th><th>file</th></tr>
${rows.map(({ v, st, checks, reached }) => {
  const bad = checks.filter((c) => !c.ok && !c.manual).length;
  const next = st.find((x) => !x.ok);
  return `<tr><td>${esc(v.no)}</td><td><code>${esc(v.slug)}</code></td><td>${esc(v.title ?? "")}</td><td>${esc(v.kind ?? "")}</td><td><b>${esc(v.status ?? "")}</b></td><td>${reached}/9</td><td>${bad}</td><td>${next ? esc(next.id) : "-"}</td><td><small>${esc(v.file ?? "")}</small></td></tr>`;
}).join("")}
</table>
</div></body></html>`;

const progress = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PM 進捗 — 9 要素</title><link rel="icon" href="data:,">
<style>
:root{--bg:#0d1117;--panel:#161b22;--fg:#e6edf3;--mut:#8b949e;--bd:#30363d;--acc:#58a6ff;--ok:#3fb950;--bad:#f85149;--man:#d29922}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}
.wrap{max-width:1180px;margin:0 auto;padding:24px 16px 80px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:30px 0 10px;border-top:1px solid var(--bd);padding-top:16px}
.sub{color:var(--mut);font-size:12px;margin-bottom:16px}
a{color:var(--acc)}code{background:#21262d;border-radius:4px;padding:0 4px}small{color:var(--mut)}
table{width:100%;border-collapse:collapse;margin:6px 0}
td,th{padding:6px 8px;border-bottom:1px solid var(--bd);text-align:left;font-size:12px;vertical-align:top}
th{color:var(--mut);font-weight:400;font-size:11px}
.bar{color:var(--acc);letter-spacing:-1px}
.kpi{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0 0}
.kpi div{background:var(--panel);border:1px solid var(--bd);border-radius:10px;padding:10px 14px;min-width:120px}
.kpi b{font-size:20px;display:block}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px;margin-top:8px}
.card{background:var(--panel);border:1px solid var(--bd);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
.card .thumb{background:#0b0f14;aspect-ratio:16/10;display:flex;align-items:center;justify-content:center;overflow:hidden}
.card .thumb img{width:100%;height:100%;object-fit:cover;object-position:center top}
.card .ph{color:var(--mut);font-size:11px}
.card .body{padding:10px 12px 12px}
.card h3{font-size:13px;margin:0 0 2px}
.card h3 .no{color:var(--mut)}
.card .title{margin:0 0 8px;color:var(--mut);font-size:12px}
.steps{display:flex;gap:3px;flex-wrap:wrap;margin:4px 0 8px;align-items:center}
.step{background:#21262d;color:var(--mut);border-radius:5px;padding:1px 5px;font-size:10px;border:1px solid transparent}
.step.ok{background:#0f2c17;color:var(--ok);border-color:#1f6f3d}
.cnt{color:var(--mut);font-size:11px;margin-left:4px}
ul.gates{list-style:none;margin:0 0 8px;padding:0}
ul.gates li{color:var(--bad);font-size:11px;line-height:1.5}
.allok{color:var(--ok);font-size:11px;margin:0 0 8px}
.manual{color:var(--man);font-size:11px;margin:0 0 8px}
.next{margin:0 0 6px}
.links{margin:0;color:var(--mut);font-size:11px;word-break:break-all}
</style></head><body><div class="wrap">
<h1>PM 進捗 — 9 要素</h1>
<div class="sub">台帳 ${esc(ledgerPath.replace(process.env.HOME ?? "", "~"))} / 生成 ${new Date().toISOString().slice(0, 16).replace("T", " ")}</div>
<div class="kpi">
  <div><small>本</small><b>${rows.length}</b></div>
  <div><small>到達セル</small><b>${okCells}/${cells}</b></div>
  <div><small>達成率</small><b>${((okCells / cells) * 100).toFixed(1)}%</b></div>
  <div><small>9/9</small><b>${rows.filter((r) => r.reached === total).length}</b></div>
  <div><small>gate 不合（auto）</small><b>${rows.reduce((a, r) => a + r.checks.filter((c) => !c.ok && !c.manual).length, 0)}</b></div>
  <div><small>人手で確認</small><b>${rows.reduce((a, r) => a + r.checks.filter((c) => c.manual).length, 0)}</b></div>
</div>
<h2>本ごと（サムネ + 9 工程 + gate + 次の一手）</h2>
<div class="cards">${cards}</div>
<h2>工程別の未達（次に片付ける順）</h2>
<table><tr><th>工程</th><th>名前</th><th>担当</th><th>未達</th></tr>${missing}</table>
<h2>gate（通過条件）— presence ではなく中身を見る</h2>
<table><tr><th></th><th>check</th><th>工程</th><th>合格</th><th>定義</th></tr>${gateRows}</table>
<h2>詰まっている実例（gate 不合格）</h2>
<table><tr><th>no</th><th>slug</th><th>工程</th><th>check</th><th>中身</th></tr>${examples}</table>
<h2>人間が触るところ（視聴とダメ出しだけ・企画〜投稿は agent）</h2>
<table><tr><th>関所</th><th>やり方</th><th>落とし先</th></tr>
<tr><td>視聴</td><td>${esc(human.view ?? "-")}</td><td>-</td></tr>
<tr><td>ダメ出し</td><td>${esc(human.review ?? "-")}</td><td><small>${esc((human.sinks ?? []).join(", ") || "-")}</small></td></tr>
</table>
<h2>タイプ別</h2>
<table><tr><th>type</th><th>aspect</th><th>尺</th><th>使う工程</th><th>上書き</th></tr>${typeRows}</table>
<h2>キャスト（誰に・どのモデルで・どの鍵で）</h2>
<table><tr><th>工程</th><th>agent</th><th>model</th><th>engine</th><th>token(env)</th></tr>${castRows}</table>
</div></body></html>`;

const tabs: Array<[string, string]> = [
  ["かんばん", "kanban.html"],
  ["進捗", "progress.html"],
  ["工程図", "pipeline.html"],
  ["台本部", "script.html"],
];
const btns = tabs
  .map(([n, src], i) => `<button data-src="${src}"${i === 0 ? " class='on'" : ""}>${n}</button>`)
  .join("");
const first = tabs.find(([, src]) => existsSync(join(HERE, src)))?.[1] ?? "progress.html";
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
  console.log(`wrote ${join(HERE, "progress.html")}（サムネ ${thumbOf.size} / 本 ${rows.length}）`);
}
if (what === "all" || what === "kanban") {
  writeFileSync(join(HERE, "kanban.html"), kanbanHtml);
  console.log(`wrote ${join(HERE, "kanban.html")}（列 ${KANBAN_COLS.length}）`);
}
if (what === "all" || what === "index") {
  writeFileSync(join(HERE, "index.html"), index);
  console.log(`wrote ${join(HERE, "index.html")}（${tabs.map(([n]) => n).join(" / ")}）`);
}
