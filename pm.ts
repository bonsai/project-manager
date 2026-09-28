#!/usr/bin/env bun
// project-manager (pm) — 9 要素（工程）を各プロジェクトで検査する。
//
// これは PM であって、実処理はしない。videoman の台帳（canonical）と、各 repo の
// 成果物ファイルを読んで「どこまで来ているか・次は何か」を出すだけ。疎結合。
//
//   pm              全プロジェクトのマトリクス（9 要素）
//   pm <slug>       1 本の詳細 + 次の一手
//   pm wf [id]      工程ボード（script = 台本部: seed/review/done）
//
// 定義は同じディレクトリの wf.yaml、台帳は data/videos.jsonl（env VIDEOMAN_JSONL で差し替え）。
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HERE = import.meta.dir;
const HOME = homedir();
const canonical = process.env.VIDEOMAN_JSONL ?? join(HERE, "data/videos.jsonl");

const expandHome = (p: string) => (p.startsWith("~") ? join(HOME, p.slice(1)) : p);
const short = (p: string) => p.replace(HOME, "~");

interface Video {
  no: string;
  slug: string;
  title?: string;
  youtube_id?: string | null;
  stats?: { views?: number | null };
}
interface WfDoc {
  flow: string[];
  wfs: Array<{ id: string; name: string; who?: "human" | "agent"; agent?: string; outside?: boolean }>;
  roots?: Record<string, string>;
  artifacts?: Record<string, string[]>;
  tracker?: string;
  library?: Record<string, { path: string; repo: string; seed?: string; done?: string; ledger?: string }>;
}

const doc = Bun.YAML.parse(readFileSync(join(HERE, "wf.yaml"), "utf8")) as WfDoc;
const nameOf = new Map(doc.wfs.map((w) => [w.id, w.name]));
const wfOf = new Map(doc.wfs.map((w) => [w.id, w]));
const roots = doc.roots ?? {};
const arts = doc.artifacts ?? {};

// 担当の表示（human / agent名 / 出先）
function who(id: string): string {
  const w = wfOf.get(id);
  if (!w) return "-";
  if (w.who === "human") return w.outside ? "人間（出先・スマホ）" : "人間";
  return `agent: ${w.agent ?? "?"}`;
}

function loadVideos(): Video[] {
  if (!existsSync(canonical)) return [];
  return readFileSync(canonical, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Video);
}

// roots × artifacts を {slug} 展開して glob する
function resolveArtifact(slug: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const id of doc.flow) out[id] = [];
  for (const rel of Object.values(roots)) {
    const base = expandHome(rel);
    if (!existsSync(base)) continue;
    for (const [id, patterns] of Object.entries(arts)) {
      for (const pat of patterns ?? []) {
        try {
          for (const f of new Bun.Glob(pat.replace(/\{slug\}/g, slug)).scanSync({ cwd: base, onlyFiles: true })) {
            (out[id] ??= []).push(join(base, f));
          }
        } catch { /* 不正な glob は無視 */ }
      }
    }
  }
  return out;
}

function check(v: Video): Array<{ id: string; ok: boolean; ref: string }> {
  const files = resolveArtifact(v.slug);
  return doc.flow.map((id) => {
    if (id === "deploy") return { id, ok: Boolean(v.youtube_id), ref: v.youtube_id ?? "" };
    if (id === "metrics") return { id, ok: typeof v.stats?.views === "number", ref: v.stats?.views != null ? `${v.stats.views} views` : "" };
    const f = files[id]?.[0];
    return { id, ok: Boolean(f), ref: f ? short(f) : "" };
  });
}

function boardScript(lib: { path: string; repo: string; seed?: string; done?: string; ledger?: string }): void {
  const root = expandHome(lib.path);
  if (!existsSync(root)) { console.log(`台本部が無い: ${root}`); return; }
  const seedDir = join(root, lib.seed ?? "seed");
  const seed = existsSync(seedDir) ? readdirSync(seedDir).filter((f) => f.endsWith(".md") && f !== "INDEX.md") : [];
  const ledger = join(root, lib.ledger ?? "SERIES.md");
  let series: string[] = [];
  if (existsSync(ledger)) series = [...readFileSync(ledger, "utf8").matchAll(/^\|[^|]*\|\s*`([^`]+)\//gm)].map((m) => m[1]!);
  if (series.length === 0) {
    series = readdirSync(root).filter((d) => {
      try { return statSync(join(root, d)).isDirectory() && !["seed", ".github", ".git", "scripts"].includes(d); } catch { return false; }
    });
  }
  let prs: Array<{ number: number; title: string }> = [];
  if (Bun.which("gh")) {
    const r = Bun.spawnSync(["gh", "pr", "list", "-R", lib.repo, "--state", "open", "--json", "number,title", "--limit", "50"]);
    try { prs = JSON.parse(new TextDecoder().decode(r.stdout)) as Array<{ number: number; title: string }>; } catch { /* ignore */ }
  }
  console.log(`WF script（台本）\n  store: ${root}\n  repo:  ${lib.repo}`);
  console.log(`\n[seed 査読前] ${seed.length} 件`);
  for (const f of seed.slice(0, 8)) console.log(`  - ${f}`);
  if (seed.length > 8) console.log(`  … +${seed.length - 8}`);
  console.log(`\n[review 査読中] ${prs.length} 件（open PR）`);
  for (const p of prs) console.log(`  - #${p.number} ${p.title}`);
  console.log(`\n[done 完成]`);
  for (const s of series) {
    const list = existsSync(join(root, s)) ? readdirSync(join(root, s)).filter((f) => /^#\d+.*\.md$/.test(f)) : [];
    console.log(`  ${s}: ${list.length} 件${list.length ? "  " + list.join(", ") : ""}`);
  }
}

const [sub, arg] = process.argv.slice(2);

if (sub === "plan") {
  const videos = loadVideos();
  const projects = videos.map((v) => {
    const rows = check(v);
    return { no: v.no, slug: v.slug, title: v.title ?? "", ok: rows.filter((r) => r.ok).length, cells: rows.length, rows };
  });

  // 機械可読（orchestrator が読む）。pm plan json / --json
  if (arg === "json" || process.argv.includes("--json")) {
    const remaining: Record<string, number> = {};
    for (const id of doc.flow) remaining[id] = 0;
    for (const p of projects) for (const r of p.rows) if (!r.ok) remaining[r.id] = (remaining[r.id] ?? 0) + 1;
    console.log(JSON.stringify({ tracker: doc.tracker ?? "", flow: doc.flow, who: Object.fromEntries(doc.flow.map((id) => [id, who(id)])), remaining, projects }, null, 2));
    process.exit(0);
  }

  const tally = new Map<string, number>();
  let okAll = 0;
  let cellsAll = 0;
  console.log("PM plan — 進捗と残タスク\n");
  for (const v of videos) {
    const rows = check(v);
    const ok = rows.filter((r) => r.ok).length;
    okAll += ok;
    cellsAll += rows.length;
    for (const r of rows) if (!r.ok) tally.set(r.id, (tally.get(r.id) ?? 0) + 1);
    const next = rows.find((r) => !r.ok);
    const pct = ((ok / rows.length) * 100).toFixed(0).padStart(3);
    console.log(`  ${pct}%  ${v.no.padStart(3)} ${v.slug.padEnd(30)} ${next ? `次: ${next.id}（${who(next.id)}）` : "完了"}`);
  }
  console.log(`\n全体: ${((okAll / cellsAll) * 100).toFixed(1)}%（${okAll}/${cellsAll}）`);
  console.log("\n残タスク（工程別 → 担当）:");
  for (const id of doc.flow) {
    const n = tally.get(id) ?? 0;
    if (n) console.log(`  ${id.padEnd(8)} ${(nameOf.get(id) ?? "").padEnd(6)} ${String(n).padStart(2)} 件   ${who(id)}`);
  }
  console.log(`\ntracker: ${doc.tracker ?? "（未設定）"}  → 起票は orchestrator`);
} else if (sub === "wf") {
  if (!arg) {
    console.log("WF 一覧:");
    for (const w of doc.wfs) console.log(`  ${w.id.padEnd(8)} ${w.name}`);
  } else if (arg === "script") {
    boardScript(doc.library!.script!);
  } else {
    console.log(`WF ${arg}（${nameOf.get(arg) ?? "?"}）: ボードは未実装`);
  }
} else if (sub) {
  const v = loadVideos().find((x) => x.slug === sub || x.no === sub);
  if (!v) { console.error(`見つからない: ${sub}`); process.exit(1); }
  const rows = check(v);
  console.log(`PM: #${v.no} ${v.slug}  ${v.title ?? ""}`);
  for (const r of rows) console.log(`  ${r.ok ? "✅" : "・"} ${r.id.padEnd(8)} ${(nameOf.get(r.id) ?? "").padEnd(6)} ${r.ref}`);
  const next = rows.find((r) => !r.ok);
  console.log(`\n次の一手: ${next ? `${next.id}（${nameOf.get(next.id)}）` : "全工程 完了"}`);
} else {
  const videos = loadVideos();
  console.log(`PM（9 要素）: ${videos.length} 本\n`);
  console.log(`      ${doc.flow.map((id) => id.slice(0, 3).padStart(3)).join(" ")}`);
  const tally = new Map<string, number>();
  for (const v of videos) {
    const rows = check(v);
    for (const r of rows) if (!r.ok) tally.set(r.id, (tally.get(r.id) ?? 0) + 1);
    console.log(`  ${v.no.padStart(3)} ${rows.map((r) => (r.ok ? "  ✅" : "   ·")).join("")}  ${v.slug}`);
  }
  console.log("\n未完（工程別）:");
  for (const id of doc.flow) console.log(`  ${id.padEnd(8)} ${(nameOf.get(id) ?? "").padEnd(6)} ${tally.get(id) ?? 0}`);
}
