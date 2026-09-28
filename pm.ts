#!/usr/bin/env bun
// project-manager (pm) — 9 要素（工程）を各プロジェクトで検査する。
//
// これは PM であって、実処理はしない。videoman の台帳（canonical）と、各 repo の
// 成果物ファイルを読んで「どこまで来ているか・次は何か」を出すだけ。疎結合。
//
//   pm              全プロジェクトのマトリクス（9 要素）
//   pm <slug>       1 本の詳細 + 次の一手
//   pm wf [id]      工程ボード（script = 台本部: seed/review/done）
//   pm dashboards   進捗 / 工程図 / 台本部 の HTML を作って開く（--no-open で生成だけ）
//   pm index        3 枚を束ねた index.html を作って開く
//
// 定義は同じディレクトリの wf.yaml、台帳は data/videos.jsonl（env VIDEOMAN_JSONL で差し替え）。
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HOME, expandHome, loadWfDoc, short, stageState, type StageRow, type Video, type WfDoc } from "./lib/stages";
import { runChecks, type CheckResult } from "./lib/gates";

const HERE = import.meta.dir;
const canonical = process.env.VIDEOMAN_JSONL ?? join(HERE, "data/videos.jsonl");

const doc = loadWfDoc(join(HERE, "wf.yaml"));
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

const check = (v: Video): StageRow[] => stageState(v, doc);

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

// ── crawl: 台帳 + 成果物 + 実体ファイルを巡回検査する（cron 用）
const MEGA = process.env.KANAL_MEGA ?? "/mnt/c/Users/dance/Documents/MEGA";
const STATUSES = ["idea", "script", "audio", "video", "ready", "uploaded", "held", "dropped"];

function expectedName(v: Video): string | null {
  if (!v.file) return null;
  const ext = String(v.file).split(".").pop() ?? "";
  return `${v.no}-${v.slug}__${v.status}__${String(v.stage_date ?? "").replace(/-/g, "")}.${ext}`;
}

function crawlVideo(v: Video) {
  const issues: string[] = [];
  const st = stageState(v, doc);
  const reached = st.filter((r) => r.ok).length;

  // 1) 台帳の file の実体（MEGA）
  if (v.file) {
    const path = join(MEGA, String(v.file));
    if (!existsSync(path)) issues.push(`file の実体が MEGA に無い: ${v.file}`);
    const want = expectedName(v)!;
    if (v.file !== want) issues.push(`命名が規約と違う: ${v.file} → ${want}`);
  } else if (v.status && !["idea", "held", "dropped"].includes(String(v.status))) {
    issues.push(`status=${v.status} なのに file が空`);
  }

  // 2) deploy / metrics の整合
  if (v.status === "uploaded" && !v.youtube_id) issues.push("uploaded だが youtube_id が無い");
  if (v.status === "ready" && v.youtube_id) issues.push("ready だが youtube_id がある（status が遅れている）");
  const fetched = (v.stats as { fetched_at?: string } | null)?.fetched_at;
  if (v.youtube_id && !fetched) issues.push("公開済みだが stats.fetched_at が無い（metrics 未取得）");
  if (v.youtube_id && fetched) {
    const days = (Date.now() - Date.parse(fetched)) / 86400000;
    if (days > 7) issues.push(`stats が古い: ${fetched}（${Math.floor(days)} 日前）`);
  }
  if (v.status && !STATUSES.includes(String(v.status))) issues.push(`未知の status: ${v.status}`);

  // 3) 到達済みなのに次の工程が無い（成果物の抜け）
  const next = st.find((r) => !r.ok);
  if (!next && !v.youtube_id) issues.push("9 工程すべて到達だが未公開（deploy の記録漏れ？）");

  // 4) gate（中身）
  const gateBad = runChecks(v, doc, doc.checks ?? [], types).filter((c) => !c.ok && !c.manual);

  return { slug: v.slug, no: v.no, status: v.status, reached, total: doc.flow.length, issues, gateFail: gateBad.map((g) => `${g.id}: ${g.detail}`) };
}

function cmdCrawl(argv: string[]): void {
  const asJson = argv.includes("--json");
  const write = argv.includes("--write");
  const quiet = argv.includes("--quiet");
  const videos = loadVideos();
  const seen = new Set<string>();
  const results = videos.map((v) => {
    const r = crawlVideo(v);
    if (seen.has(v.slug)) r.issues.push("slug が重複");
    seen.add(v.slug);
    if (!v.no) r.issues.push("no が空");
    return r;
  });
  const okCount = results.filter((r) => r.issues.length === 0).length;
  const issueCount = results.reduce((a, r) => a + r.issues.length, 0);
  const gateCount = results.reduce((a, r) => a + r.gateFail.length, 0);
  const snapshot = {
    generated_at: new Date().toISOString(),
    ledger: canonical.replace(HOME, "~"),
    mega: MEGA,
    summary: { videos: videos.length, clean: okCount, issues: issueCount, gate_fail: gateCount },
    videos: results,
  };

  if (write) {
    const dir = join(HERE, "state");
    // state はディレクトリなので mkdir が要る（無ければ作る）
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "crawl-latest.json"), JSON.stringify(snapshot, null, 2));
    appendFileSync(join(dir, "crawl.jsonl"), JSON.stringify({ ts: snapshot.generated_at, ...snapshot.summary }) + "\n");
  }

  if (asJson) {
    console.log(JSON.stringify(snapshot, null, 2));
    process.exit(issueCount > 0 ? 1 : 0);
  }
  if (quiet) {
    console.log(`${snapshot.generated_at.slice(0, 16)} crawl: 本 ${videos.length} / 問題 ${issueCount} 件（${results.length - okCount} 本）/ gate 不合 ${gateCount}`);
    process.exit(issueCount > 0 ? 1 : 0);
  }
  console.log(`PM crawl — 台帳 ${snapshot.ledger} / MEGA ${MEGA}\n`);
  for (const r of results) {
    const mark = r.issues.length === 0 ? "✅" : "✗";
    console.log(`${mark} ${String(r.no).padStart(3)} ${String(r.slug).padEnd(32)} ${r.reached}/${r.total}  ${r.issues.length ? `問題 ${r.issues.length} / gate 不合 ${r.gateFail.length}` : "問題なし"}`);
    for (const i of r.issues) console.log(`     ! ${i}`);
  }
  console.log(`\n合計: 本 ${videos.length} / 問題なし ${okCount} 本 / 問題 ${issueCount} 件 / gate 不合 ${gateCount} 件`);
  if (write) console.log(`記録: state/crawl-latest.json, state/crawl.jsonl`);
  process.exit(issueCount > 0 ? 1 : 0);
}

// ── ダッシュボード（progress / pipeline / script）を生成してブラウザで開く
const DASH_PAGES: Array<[string, string]> = [
  ["progress", "progress.html"],
  ["pipeline", "pipeline.html"],
  ["script", "script.html"],
];

function winPath(p: string): string {
  const r = Bun.spawnSync(["wslpath", "-w", p], { stdout: "pipe", stderr: "ignore" });
  const out = new TextDecoder().decode(r.stdout).trim();
  return out || p;
}

function openInBrowser(p: string): boolean {
  const win = winPath(p);
  const candidates: string[][] = [["wslview", p], ["explorer.exe", win], ["cmd.exe", "/c", "start", "", win], ["xdg-open", p]];
  for (const cmd of candidates) {
    if (!Bun.which(cmd[0]!)) continue;
    try { Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }); return true; } catch { /* 次の候補 */ }
  }
  return false;
}

function buildDashboards(): void {
  for (const gen of ["diagram.ts", "board.ts", "dash.ts"]) {
    const r = Bun.spawnSync([process.execPath, join(HERE, gen)], { stdout: "ignore", stderr: "pipe" });
    if (r.exitCode !== 0) {
      console.error(`生成失敗: ${gen}\n${new TextDecoder().decode(r.stderr)}`);
      process.exit(1);
    }
  }
}

// ── gate（通過条件）の検査。定義は wf.yaml の checks
const types = castTypes();
function castTypes(): Record<string, { aspect?: string; chars?: [number, number]; seconds?: number }> {
  try {
    const c = Bun.YAML.parse(readFileSync(join(HERE, "casting.yaml"), "utf8")) as {
      types?: Record<string, { aspect?: string; chars?: [number, number]; seconds?: number }>;
    };
    return c.types ?? {};
  } catch {
    return {};
  }
}
const checksOf = () => doc.checks ?? [];
const checkVideo = (v: Video) => runChecks(v, doc, checksOf(), types);

function cmdGate(argv: string[]): void {
  const [slugArg, stageArg] = argv.filter((a) => !a.startsWith("-"));
  const videos = loadVideos();
  const targets = slugArg ? videos.filter((v) => v.slug === slugArg || v.no === slugArg) : videos;
  if (slugArg && targets.length === 0) { console.error(`見つからない: ${slugArg}`); process.exit(1); }
  const picked = stageArg ? checksOf().filter((c) => c.stage === stageArg) : checksOf();
  if (picked.length === 0) { console.error(`check が無い: ${stageArg ?? "(wf.yaml の checks)"}`); process.exit(1); }

  const tally = new Map<string, { fail: number; manual: number; pass: number }>();
  for (const v of targets) {
    const rows = runChecks(v, doc, picked, types);
    if (slugArg) {
      console.log(`PM gate: #${v.no} ${v.slug}（${v.kind ?? "?"}）`);
      for (const r of rows) {
        const mark = r.ok ? "✅" : r.manual ? "・" : "✗";
        console.log(`  ${mark} ${r.stage.padEnd(8)} ${r.id.padEnd(20)} ${r.detail}`);
      }
    }
    for (const r of rows) {
      const t = tally.get(r.id) ?? { fail: 0, manual: 0, pass: 0 };
      if (r.manual) t.manual++;
      else if (r.ok) t.pass++;
      else t.fail++;
      tally.set(r.id, t);
    }
  }
  if (!slugArg) {
    console.log(`PM gate（${targets.length} 本 / check ${picked.length} 種）\n`);
    console.log(`  ${"check".padEnd(20)} ${"工程".padEnd(8)} 不合成約 合格 manual  定義`);
    for (const c of picked) {
      const t = tally.get(c.id) ?? { fail: 0, manual: 0, pass: 0 };
      const mark = t.fail > 0 ? "✗" : t.manual > 0 ? "・" : "✅";
      console.log(`  ${mark} ${c.id.padEnd(18)} ${c.stage.padEnd(8)} ${String(t.fail).padStart(3)}      ${String(t.pass).padStart(3)}   ${String(t.manual).padStart(3)}  ${c.note ?? ""}`);
    }
    const manual = picked.filter((c) => c.kind === "manual");
    if (manual.length) console.log(`\n・ = 人手で確認（自動判定しない）: ${manual.map((c) => c.id).join(", ")}`);
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
  console.log(`人間の関所: 視聴 / ダメ出し（${(doc.human?.sinks ?? ["reviews.jsonl"]).join(", ")}）。企画・制作・投稿は agent`);
} else if (sub === "crawl") {
  cmdCrawl(process.argv.slice(3));
} else if (sub === "gate") {
  cmdGate(process.argv.slice(3));
} else if (sub === "dashboards") {
  buildDashboards();
  const noOpen = process.argv.includes("--no-open");
  for (const [name, file] of DASH_PAGES) {
    const p = join(HERE, file);
    if (!existsSync(p)) { console.log(`なし  ${name}: ${p}`); continue; }
    console.log(`o ${name}: ${p}`);
    if (!noOpen) openInBrowser(p);
  }
} else if (sub === "index") {
  buildDashboards();
  const p = join(HERE, "index.html");
  if (process.argv.includes("--no-open")) console.log(`wrote ${p}`);
  else console.log(openInBrowser(p) ? `opened ${p}` : `open できず。file: ${p}`);
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
  const gate = checkVideo(v).filter((r) => v.youtube_id || true);
  const bad = gate.filter((r) => !r.ok && !r.manual);
  const man = gate.filter((r) => r.manual);
  if (bad.length) {
    console.log(`\ngate 不合格（${bad.length}）:`);
    for (const r of bad) console.log(`  ✗ ${r.stage.padEnd(8)} ${r.id.padEnd(20)} ${r.detail}`);
  }
  if (man.length) {
    console.log(`\ngate 人手で確認（${man.length}）:`);
    for (const r of man) console.log(`  ・ ${r.stage.padEnd(8)} ${r.id.padEnd(20)} ${r.detail}`);
  }
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
  console.log(`\n人間は見てダメ出しするだけ（企画・制作・投稿は agent）。ダメ出し先: ${(doc.human?.sinks ?? ["reviews.jsonl"]).join(", ")}`);
}
