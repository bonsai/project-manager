// stages.ts — 工程の状態判定（PM とオントロジで共有する唯一の実装）
//
// 定義（wf.yaml の flow / roots / artifacts）と台帳の 1 レコードから
// 「どの工程まで来ているか」を返す。判定規則はここ 1 箇所。
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const HOME = homedir();
export const expandHome = (p: string) => (p.startsWith("~") ? join(HOME, p.slice(1)) : p);

export interface Video {
  no: string;
  slug: string;
  title?: string;
  series?: string;
  kind?: string;
  status?: string;
  stage_date?: string;
  file?: string;
  youtube_id?: string | null;
  url?: string | null;
  stats?: { views?: number | null; likes?: number | null } | null;
  [k: string]: unknown;
}

export interface Wf {
  id: string;
  name: string;
  who?: "human" | "agent";
  agent?: string;
  outside?: boolean;
  produces?: string;
  gate?: string;
  labels?: string[];
  states?: string[];
  library?: string;
  note?: string;
}

export interface WfDoc {
  flow: string[];
  wfs: Wf[];
  roots?: Record<string, string>;
  artifacts?: Record<string, string[]>;
  repos?: Record<string, string[]>;
  tracker?: string;
  library?: Record<string, { path: string; repo: string; seed?: string; done?: string; ledger?: string }>;
}

export interface StageRow {
  id: string;
  ok: boolean;
  ref: string;
}

export function stageState(v: Video, doc: WfDoc): StageRow[] {
  const files = artifactsFor(v.slug, doc);
  return doc.flow.map((id) => {
    if (id === "deploy") return { id, ok: Boolean(v.youtube_id), ref: v.youtube_id ?? "" };
    if (id === "metrics") {
      const views = v.stats?.views;
      return { id, ok: typeof views === "number", ref: views != null ? `${views} views` : "" };
    }
    const f = files[id]?.[0];
    return { id, ok: Boolean(f), ref: f ? short(f) : "" };
  });
}

/** roots × artifacts を {slug} 展開して glob し、工程ごとの成果物を集める */
export function artifactsFor(slug: string, doc: WfDoc): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const id of doc.flow) out[id] = [];
  for (const rel of Object.values(doc.roots ?? {})) {
    const base = expandHome(rel);
    if (!existsSync(base)) continue;
    for (const [id, patterns] of Object.entries(doc.artifacts ?? {})) {
      for (const pat of patterns ?? []) {
        try {
          for (const f of new Bun.Glob(pat.replace(/\{slug\}/g, slug)).scanSync({ cwd: base, onlyFiles: true })) {
            (out[id] ??= []).push(join(base, f));
          }
        } catch {
          /* 不正な glob は無視 */
        }
      }
    }
  }
  return out;
}

export const short = (p: string) => p.replace(HOME, "~");

export function loadWfDoc(path: string): WfDoc {
  return Bun.YAML.parse(readFileSync(path, "utf8")) as WfDoc;
}
