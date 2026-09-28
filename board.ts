#!/usr/bin/env bun
// board.ts — 台本部（script WF）を HTML にする。定義は wf.yaml の library.script を参照（直書きしない）。
//   bun board.ts            → script.html を生成
//   bun board.ts --open     → 生成してブラウザで開く
//
// 出すもの: seed（査読前）/ PR（査読中）/ 完成（系列 #NN）/ issue（wf:script, API）
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HERE = import.meta.dir;
const HOME = homedir();
const expand = (p: string) => (p.startsWith("~") ? join(HOME, p.slice(1)) : p);
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const wf = Bun.YAML.parse(readFileSync(join(HERE, "wf.yaml"), "utf8")) as {
  library: Record<string, { path: string; repo: string; ledger?: string; seed?: string; done?: string }>;
};
const lib = wf.library.script!;
const root = expand(lib.path);

const gh = (args: string[]): unknown[] => {
  const r = Bun.spawnSync(["gh", ...args]);
  try { return JSON.parse(new TextDecoder().decode(r.stdout)) as unknown[]; } catch { return []; }
};

// seed（査読前）
const seedDir = join(root, lib.seed ?? "seed");
const seed = existsSync(seedDir) ? readdirSync(seedDir).filter((f) => f.endsWith(".md") && f !== "INDEX.md") : [];

// 系列（台帳 SERIES.md が正）
const ledger = join(root, lib.ledger ?? "SERIES.md");
let series: string[] = existsSync(ledger) ? [...readFileSync(ledger, "utf8").matchAll(/^\|[^|]*\|\s*`([^`]+)\//gm)].map((m) => m[1]!) : [];
if (series.length === 0) series = readdirSync(root).filter((x) => { try { return statSync(join(root, x)).isDirectory() && !["seed", ".github", ".git", "scripts"].includes(x); } catch { return false; } });
const done = series.map((s) => ({ s, files: existsSync(join(root, s)) ? readdirSync(join(root, s)).filter((f) => /^#\d+.*\.md$/.test(f)).sort() : [] }));

// PR（査読中）/ issue（wf:script, API）
const prs = gh(["pr", "list", "-R", lib.repo, "--state", "open", "--json", "number,title,url", "--limit", "50"]) as Array<{ number: number; title: string; url: string }>;
const issues = gh(["issue", "list", "-R", lib.repo, "--state", "open", "--label", "wf:script", "--json", "number,title,url", "--limit", "50"]) as Array<{ number: number; title: string; url: string }>;

const li = (items: string[]) => items.map((x) => `<li>${x}</li>`).join("") || `<li class="mut">（なし）</li>`;
const repoUrl = `https://github.com/${lib.repo}`;

const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>台本部 — script WF</title>
<link rel="icon" href="data:,">
<style>
:root{--bg:#0d1117;--panel:#161b22;--fg:#e6edf3;--mut:#8b949e;--bd:#30363d;--acc:#58a6ff;--gd:#3fb950;--wn:#d29922}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.6 ui-monospace,Menlo,monospace}
.wrap{max-width:1000px;margin:0 auto;padding:24px 16px 80px}
h1{font-size:20px;margin:0 0 4px}.sub{color:var(--mut);font-size:12px;margin-bottom:18px}
.cols{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.col{background:var(--panel);border:1px solid var(--bd);border-radius:10px;padding:12px}
.col h2{font-size:12px;margin:0 0 8px;color:var(--mut);font-weight:400}
ul{list-style:none;padding:0;margin:0}li{padding:4px 0;border-bottom:1px solid #21262d;font-size:12px;word-break:break-all}
li.mut{color:var(--mut)}a{color:var(--acc);text-decoration:none}
.count{float:right;color:var(--fg)}
table{width:100%;border-collapse:collapse;margin-top:16px}td,th{padding:6px 8px;border-bottom:1px solid var(--bd);text-align:left;font-size:12px}
th{color:var(--mut);font-weight:400}code{background:#21262d;border-radius:4px;padding:0 4px}
.badge{display:inline-block;background:#21262d;border-radius:9px;padding:1px 8px;color:var(--mut);font-size:11px;margin-right:6px}
@media(max-width:720px){.cols{grid-template-columns:1fr}}
</style></head><body><div class="wrap">
<h1>台本部 — script WF</h1>
<div class="sub">
  <span class="badge">store</span><code>${esc(root)}</code>
  <span class="badge">repo</span><a href="${repoUrl}">${esc(lib.repo)}</a>
  <span class="badge">正</span>wf.yaml の library.script（疎結合）
</div>
<div class="cols">
  <div class="col"><h2>seed 査読前 <span class="count">${seed.length}</span></h2><ul>${li(seed.slice(0, 40).map((f) => `<a>${esc(f)}</a>`))}</ul></div>
  <div class="col"><h2>review 査読中（open PR） <span class="count">${prs.length}</span></h2><ul>${li(prs.map((p) => `<a href="${esc(p.url)}">#${p.number} ${esc(p.title)}</a>`))}</ul></div>
  <div class="col"><h2>issue（API, wf:script） <span class="count">${issues.length}</span></h2><ul>${li(issues.map((i) => `<a href="${esc(i.url)}">#${i.number} ${esc(i.title)}</a>`))}</ul></div>
</div>
<h2 style="font-size:13px;margin:24px 0 4px">done 完成（系列 #NN）</h2>
<table><tr><th>series</th><th>#</th><th>files</th></tr>
${done.map((d) => `<tr><td>${esc(d.s)}</td><td>${d.files.length}</td><td>${d.files.map((f) => esc(f)).join(", ") || "<span class='mut'>（なし）</span>"}</td></tr>`).join("")}
</table>
<div class="sub" style="margin-top:14px">生成: board.ts · seed=${seed.length} / PR=${prs.length} / issue=${issues.length}</div>
</div></body></html>`;

writeFileSync(join(HERE, "script.html"), html);
console.log(`wrote ${join(HERE, "script.html")}  seed=${seed.length} pr=${prs.length} issue=${issues.length}`);

if (process.argv.includes("--open") && Bun.which("powershell.exe")) {
  const win = "\\\\wsl.localhost\\Ubuntu-24.04\\home\\sexy\\.skills\\project-manager\\script.html";
  Bun.spawnSync(["powershell.exe", "-NoProfile", "-Command", `Start-Process '${win}'`]);
  console.log("opened");
}
