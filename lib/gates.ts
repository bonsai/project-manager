// gates.ts — 工程の gate（通過条件）を実際に検査する。
//
// presence（在るか）だけでなく、内容も見る: 語数・字数・枚数・尺・aspect・命名・数値。
// 自動で判定できない条件（例: 画像に文字を焼いていない）は manual として明示する
// （「通った」ことにはしない）。
//
// 検査項目の定義は wf.yaml の `checks`。ここはその実行器。
import { readFileSync } from "node:fs";
import { artifactsFor, expandHome, type Video, type WfCheck, type WfDoc } from "./stages";

export type Check = WfCheck;

/** タイプ別の期待値（casting.yaml の types） */
export interface TypeSpec {
  aspect?: string;
  chars?: [number, number];
  seconds?: number;
}

export interface CheckResult {
  id: string;
  stage: string;
  ok: boolean;
  manual: boolean;
  detail: string;
}

function sh(cmd: string[]): string {
  const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "ignore" });
  return new TextDecoder().decode(r.stdout).trim();
}

function probeDuration(file: string): number | null {
  const out = sh(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  const v = Number.parseFloat(out);
  return Number.isFinite(v) ? v : null;
}

function probeSize(file: string): { w: number; h: number } | null {
  const out = sh(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]);
  const [w, h] = out.split(",").map((x) => Number.parseInt(x, 10));
  return Number.isFinite(w) && Number.isFinite(h) ? { w: w!, h: h! } : null;
}

function readText(file: string): string {
  try {
    return readFileSync(expandHome(file), "utf8");
  } catch {
    return "";
  }
}

function humanAspect(w: number, h: number): string {
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const d = g(w, h);
  return `${w / d}:${h / d}`;
}

export function runChecks(
  v: Video,
  doc: WfDoc,
  checks: Check[],
  types: Record<string, TypeSpec>,
): CheckResult[] {
  const typeSpec: TypeSpec = types[String(v.kind ?? "")] ?? {};
  const files = artifactsFor(v.slug, doc);
  const home = expandHome("~");
  const out: CheckResult[] = [];

  for (const c of checks) {
    const all = (files[c.stage] ?? []).map((f) => f.replace(home, "~"));
    // match はファイル名に対して当てる（成果物のパスは絶対なので、基底名で判定）
    const base = (f: string) => f.split("/").pop() ?? f;
    const matched = c.match ? all.filter((f) => new Bun.Glob(c.match!).match(base(f))) : all;
    const seen = (arr: string[]) => arr.slice(0, 2).map((f) => f.replace("~", home));
    const fail = (detail: string) => out.push({ id: c.id, stage: c.stage, ok: false, manual: false, detail });
    const pass = (detail: string) => out.push({ id: c.id, stage: c.stage, ok: true, manual: false, detail });

    if (c.kind === "manual") {
      out.push({ id: c.id, stage: c.stage, ok: false, manual: true, detail: c.note ?? "人手で確認" });
      continue;
    }
    if (c.kind === "youtube") {
      if (v.youtube_id) pass(v.youtube_id);
      else fail("youtube_id が無い（未公開）");
      continue;
    }
    if (c.kind === "number") {
      const n = v.stats?.views;
      if (typeof n === "number") pass(`${n} views`);
      else fail("stats.views が無い（未取得）");
      continue;
    }
    if (matched.length === 0) {
      fail(c.match ? `${c.stage} に ${c.match} が無い` : `${c.stage} の成果物が無い`);
      continue;
    }

    switch (c.kind) {
      case "presence":
        pass(shortest(matched));
        break;
      case "count":
        if (matched.length >= (c.min ?? 1)) pass(`${matched.length} 件`);
        else fail(`${matched.length} 件（${c.min} 件以上が必要）`);
        break;
      case "words": {
        const body = readText(expandHome(matched[0]!));
        const words = body.split(/[\s、,。．・\n\r]+/).filter((w) => w.length > 0);
        if (words.length >= (c.min ?? 1)) pass(`${words.length} 語`);
        else fail(`${words.length} 語（${c.min} 語以上が必要）`);
        break;
      }
      case "chars": {
        const body = readText(matched[0]!).replace(/\s+/g, "");
        const n = body.length;
        const lo = (c.from_type ? typeSpec.chars?.[0] : undefined) ?? c.min ?? 0;
        const hi = (c.from_type ? typeSpec.chars?.[1] : undefined) ?? c.max ?? Number.MAX_SAFE_INTEGER;
        if (n >= lo && n <= hi) pass(`${n} 字`);
        else fail(`${n} 字（期待 ${lo}-${hi === Number.MAX_SAFE_INTEGER ? "∞" : hi} 字）`);
        break;
      }
      case "contains": {
        const body = readText(expandHome(matched[0]!));
        if (c.pattern && new RegExp(c.pattern, "m").test(body)) pass(`${c.pattern} あり`);
        else fail(`${matched[0]} に ${c.pattern ?? "?"} が無い`);
        break;
      }
      case "suffix":
        if (matched.some((f) => f.endsWith(c.pattern ?? ""))) pass(shortest(matched.filter((f) => f.endsWith(c.pattern ?? ""))));
        else fail(`${c.pattern} で終わるファイルが無い`);
        break;
      case "duration": {
        const tol = c.tolerance ?? 0.35;
        // 尺の期待値: 台帳の target_seconds（本ごとの計画）→ 型の seconds の順
        const want = c.from_type ? v.target_seconds ?? typeSpec.seconds : undefined;
        const lo = want ? want * (1 - tol) : c.min ?? 0;
        const hi = want ? want * (1 + tol) : c.max ?? Number.MAX_SAFE_INTEGER;
        const bad: string[] = [];
        const ok: string[] = [];
        for (const f of seen(matched)) {
          const d = probeDuration(f);
          if (d == null) bad.push(`${f}: 尺が読めない`);
          else if (d < lo || d > hi) bad.push(`${f}: ${d.toFixed(1)}s（期待 ${Math.round(lo)}-${Math.round(hi)}s）`);
          else ok.push(`${d.toFixed(1)}s`);
        }
        if (bad.length === 0) pass(ok[0] ?? "尺 OK");
        else fail(bad.join(" / "));
        break;
      }
      case "kind_duration": {
        const d = probeDuration(seen(matched)[0]!);
        const max = c.max_short_seconds ?? 90;
        const isShort = String(v.kind ?? "") === "short";
        if (d == null) fail("尺が読めない");
        else if (isShort && d > max) fail(`${d.toFixed(1)}s は ${max}s 超 → short 不可（長尺の kind へ）`);
        else if (!isShort && d <= max) fail(`${d.toFixed(1)}s は ${max}s 以下 → short にすべき`);
        else pass(`${d.toFixed(1)}s / kind ${v.kind}`);
        break;
      }
      case "aspect": {
        const want = c.from_type ? typeSpec.aspect : undefined;
        const got: string[] = [];
        for (const f of seen(matched)) {
          const s = probeSize(f);
          if (!s) { got.push(`${f}: 画像サイズ不明`); continue; }
          const a = humanAspect(s.w, s.h);
          if (want && a !== want) got.push(`${f}: ${a}（タイプは ${want}）`);
        }
        if (got.length === 0) pass(want ? `${want} 一致` : "aspect 取得");
        else fail(got.join(" / "));
        break;
      }
    }
  }
  return out;
}

const shortest = (arr: string[]) => arr.reduce((a, b) => (a.length <= b.length ? a : b));
