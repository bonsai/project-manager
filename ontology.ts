#!/usr/bin/env bun
// ontology.ts — 動画ドメインのオントロジを組み立てる（派生 DB）
//
//   bun ontology.ts build          data/video-ontology.db を作り直す
//   bun ontology.ts queries        代表クエリの一覧
//   bun ontology.ts q "<SQL>"      任意の SQL（読み取り）
//   bun ontology.ts q <name>       代表クエリを名前で実行
//
// 正は wf.yaml / casting.yaml / data/videos.jsonl / data/SCHEMA.md。
// DB はいつでも作り直せる派生（data/video-ontology.db は gitignore）。
import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWfDoc, short, stageState, type Video } from "./lib/stages";
import { runChecks, type TypeSpec } from "./lib/gates";

const HERE = import.meta.dir;
const DB_PATH = join(HERE, "data/video-ontology.db");
const SQL_PATH = join(HERE, "data/video-ontology.sql");

// ── data/SCHEMA.md から写した語彙（台帳の語彙。正は SCHEMA.md）
const STATUS: Array<[string, string]> = [
  ["idea", "作る候補。企画のみ（file 空）"],
  ["script", "台本あり"],
  ["audio", "音声あり"],
  ["video", "動画あり・未検査"],
  ["ready", "検査済み・投稿可"],
  ["uploaded", "YouTube 公開済み"],
  ["held", "保留"],
  ["dropped", "中止"],
];
const KINDS: Array<[string, string]> = [
  ["long", "横長（エッセイ朗読など）"],
  ["short", "縦 Short"],
  ["koma", "四コマ（スクエア）"],
  ["explainer", "repo 解説"],
];
const FIELDS: Array<[string, string, number, string]> = [
  ["no", "string", 1, "通し番号。作成順＝履歴の順"],
  ["slug", "string", 1, "内容の識別子（主キー）"],
  ["title", "string", 0, "表示名"],
  ["series", "string", 0, "系列（talkscripts の系列名など）"],
  ["kind", "string", 1, "動画タイプ（types を参照）"],
  ["status", "string", 1, "段階（vocab.kind=status）"],
  ["stage_date", "string", 0, "現段階に到達した日"],
  ["target_seconds", "number", 0, "計画尺（秒）。gate の尺チェックの期待値（型より優先）"],
  ["file", "string", 0, "現段階のメディア実体（idea は空）"],
  ["assets", "object", 0, "script / audio / thumb など"],
  ["youtube_id", "string", 0, "公開済みなら動画 ID（deploy の判定）"],
  ["url", "string", 0, "公開 URL"],
  ["published_at", "string", 0, "公開日"],
  ["planned_for", "string", 0, "公開予定日"],
  ["channel", "string", 0, "チャンネル"],
  ["history", "array", 0, "status の遷移履歴"],
  ["stats", "object", 0, "views / likes / comments（metrics の判定）"],
  ["notes", "string", 0, "メモ"],
];

function loadVideos(): Video[] {
  const p = process.env.VIDEOMAN_JSONL ?? join(HERE, "data/videos.jsonl");
  if (!existsSync(p)) throw new Error(`台帳が無い: ${p}`);
  return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Video);
}

function build(): void {
  const doc = loadWfDoc(join(HERE, "wf.yaml"));
  const cast = Bun.YAML.parse(readFileSync(join(HERE, "casting.yaml"), "utf8")) as {
    defaults?: Record<string, Record<string, string>>;
    types?: Record<string, { aspect?: string; use?: string[]; cast?: Record<string, Record<string, string>> }>;
  };
  const videos = loadVideos();

  const db = new Database(DB_PATH, { create: true });
  db.exec(readFileSync(SQL_PATH, "utf8"));

  const KINDS_OF: Record<string, string> = {
    stage: "stage", repo: "repo", service: "service", store: "store", type: "type", role: "role",
    video: "video", vocab: "vocab", field: "field", artifact: "artifact", library: "library",
    engine: "engine", key: "key", series: "series", status: "status", gate: "gate", human: "human",
    sink: "sink", issue: "issue", check: "check",
  };
  // nodes への登録は必ずこれを通す（同じノードを複数工程から参照しても 1 行）
  const n = (id: string, kind: string, label: string, extra = "") =>
    db.run("INSERT OR IGNORE INTO nodes(id,kind,label,extra) VALUES(?,?,?,?)", [`${kind}:${id}`, kind, label, extra]);
  const ensure = (nodeId: string, label = "") => {
    const [head, ...rest] = nodeId.split(":");
    db.run("INSERT OR IGNORE INTO nodes(id,kind,label,extra) VALUES(?,?,?,?)",
      [nodeId, KINDS_OF[head] ?? head, label || rest.join(":"), ""]);
  };
  const e = (src: string, rel: string, dst: string, note = "") => {
    ensure(src);
    ensure(dst);
    db.run("INSERT OR IGNORE INTO edges(src,rel,dst,note) VALUES(?,?,?,?)", [src, rel, dst, note]);
  };

  // 工程
  doc.flow.forEach((id, i) => {
    const w = doc.wfs.find((x) => x.id === id);
    if (!w) return;
    db.run(
      "INSERT INTO stages(id,no,label,produces,gate,who,agent,outside,library) VALUES(?,?,?,?,?,?,?,?,?)",
      [id, i + 1, w.name, w.produces ?? null, w.gate ?? null, w.who ?? null, w.agent ?? null, w.outside ? 1 : 0, w.library ?? null],
    );
    n(id, "stage", w.name, `#${i + 1}`);
    if (w.gate) e(`stage:${id}`, "gate", `vocab:gate/${id}`, w.gate);
    if (w.agent) e(`stage:${id}`, "cast_as", `role:${id}`);
    if (w.library) e(`stage:${id}`, "supplied_by", `library:${w.library}`);
  });

  // 人間の関所（視聴 / ダメ出し）。工程ではなく、agent の出力に人間が触る点。
  const human = doc.human ?? {};
  for (const [gate, how] of [["view", human.view], ["review", human.review]] as const) {
    if (!how) continue;
    n(gate, "gate", gate === "view" ? "視聴（人間）" : "ダメ出し（人間）", how);
    e(`gate:${gate}`, "owned_by", "human:reviewer", how);
    for (const sink of human.sinks ?? []) e(`gate:${gate}`, "sinks_to", sink.includes(":") ? sink : `sink:${sink}`);
  }
  if (human.sinks?.length) n("reviewer", "human", "人間（視聴・ダメ出し）", human.sinks.join(", "));

  // 成果物（glob）と repo
  for (const [stage, patterns] of Object.entries(doc.artifacts ?? {})) {
    for (const pat of patterns ?? []) e(`stage:${stage}`, "produces", `artifact:${pat}`);
  }
  for (const [stage, list] of Object.entries(doc.repos ?? {})) {
    for (const r of list ?? []) {
      const kind = ["YouTube", "MEGA"].includes(r) ? "service" : "repo";
      db.run("INSERT OR REPLACE INTO repos(id,kind,stage_id,role) VALUES(?,?,?,?)", [r, kind, stage, "artifact"]);
      n(r, kind, r, r);
      e(`stage:${stage}`, "stored_in", `${kind}:${r}`);
    }
  }
  // 台帳の保管先
  for (const [what, path] of [["videos.jsonl", "data/videos.jsonl"], ["SCHEMA.md", "data/SCHEMA.md"]] as const) {
    db.run("INSERT OR REPLACE INTO repos(id,kind,stage_id,role) VALUES(?,?,?,?)", [path, "store", "neta", "ledger"]);
    n(path, "store", path, what);
  }

  // タイプ（動画タイプ）とキャスト
  for (const [t, spec] of Object.entries(cast.types ?? {})) {
    const use = (spec.use ?? []).join(",");
    db.run("INSERT INTO types(id,aspect,stages) VALUES(?,?,?)", [t, spec.aspect ?? null, use]);
    n(t, "type", t, spec.aspect ?? "");
    for (const s of spec.use ?? []) e(`type:${t}`, "uses", `stage:${s}`);
  }
  for (const [role, spec] of Object.entries(cast.defaults ?? {})) {
    db.run("INSERT INTO cast_roles(role,stage_id,agent,model,engine,token_env) VALUES(?,?,?,?,?,?)", [
      role,
      doc.flow.includes(role) ? role : null,
      spec.agent ?? null,
      spec.model ?? null,
      spec.engine ?? null,
      spec.token || null,
    ]);
    n(role, "role", role, spec.agent ?? "");
    if (spec.engine) e(`role:${role}`, "runs_on", `engine:${spec.engine}`);
    if (spec.token) e(`role:${role}`, "needs_key", `key:${spec.token}`);
  }
  for (const [t, spec] of Object.entries(cast.types ?? {})) {
    for (const [role, over] of Object.entries(spec.cast ?? {})) {
      const base = cast.defaults?.[role] ?? {};
      db.run("INSERT OR REPLACE INTO type_cast(type_id,role,agent,model,engine,token_env,why) VALUES(?,?,?,?,?,?,?)", [
        t, role,
        over.agent ?? base.agent ?? null,
        over.model ?? base.model ?? null,
        over.engine ?? base.engine ?? null,
        over.token || base.token || null,
        over.why ?? null,
      ]);
      e(`type:${t}`, "cast_as", `role:${role}`, over.why ?? "");
    }
  }

  // gate（通過条件）の定義と状態。検査は lib/gates.ts が唯一の実装。
  for (const c of doc.checks ?? []) {
    db.run(
      "INSERT INTO gate_checks(id,stage_id,kind,match,min,max_,pattern,from_type,manual,note) VALUES(?,?,?,?,?,?,?,?,?,?)",
      [c.id, c.stage, c.kind, c.match ?? null, c.min ?? null, c.max ?? null, c.pattern ?? null,
       c.from_type ? 1 : 0, c.kind === "manual" ? 1 : 0, c.note ?? null],
    );
    n(c.id, "check", c.id, c.kind);
    e(`stage:${c.stage}`, "gated_by", `check:${c.id}`, c.note ?? "");
    if (c.kind === "manual") e(`check:${c.id}`, "needs_human", "human:reviewer");
  }

  // 語彙とフィールド
  STATUS.forEach(([v, m], i) => db.run("INSERT INTO vocab(kind,value,meaning,ord) VALUES('status',?,?,?)", [v, m, i]));
  KINDS.forEach(([v, m], i) => db.run("INSERT INTO vocab(kind,value,meaning,ord) VALUES('kind',?,?,?)", [v, m, i]));
  for (const [v, m] of Object.entries(cast.types ?? {})) db.run("INSERT OR REPLACE INTO vocab(kind,value,meaning) VALUES('aspect',?,?)", [v, m.aspect ?? ""]);
  for (const [v, m] of STATUS) e(`vocab:status/${v}`, "meaning", `status:${v}`, m);
  for (const [name, type, req, note] of FIELDS) {
    db.run("INSERT INTO ledger_fields(name,type,required,note) VALUES(?,?,?,?)", [name, type, req, note]);
    n(name, "field", name, type);
    e("video:*", "has_field", `field:${name}`, req ? "必須" : "");
  }

  // 台帳のインスタンス + 工程の状態
  for (const v of videos) {
    db.run(
      `INSERT INTO videos(slug,no,title,series,kind,status,stage_date,file,youtube_id,url,published_at,planned_for,channel,views,likes,notes)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        v.slug, v.no ?? null, v.title ?? null, v.series ?? null, v.kind ?? null, v.status ?? null,
        v.stage_date ?? null, v.file ?? null, v.youtube_id ?? null, v.url ?? null, v.published_at ?? null,
        (v.planned_for as string) ?? null, (v.channel as string) ?? null,
        (v.stats?.views as number) ?? null, (v.stats?.likes as number) ?? null, (v.notes as string) ?? null,
      ],
    );
    n(v.slug, "video", v.title ?? v.slug, `#${v.no} ${v.status ?? ""}`);
    if (v.kind) e(`video:${v.slug}`, "of_type", `type:${v.kind}`);
    if (v.status) e(`video:${v.slug}`, "has_status", `vocab:status/${v.status}`);
    if (v.series) e(`video:${v.slug}`, "in_series", `series:${v.series}`);
    for (const j of runChecks(v, doc, doc.checks ?? [], (cast.types ?? {}) as Record<string, TypeSpec>)) {
      db.run("INSERT INTO stage_check(slug,check_id,ok,manual,detail) VALUES(?,?,?,?,?)", [v.slug, j.id, j.ok ? 1 : 0, j.manual ? 1 : 0, j.detail]);
      if (!j.ok && !j.manual) e(`video:${v.slug}`, "fails", `check:${j.id}`, j.detail);
    }
    for (const row of stageState(v, doc)) {
      db.run("INSERT INTO stage_state(slug,stage_id,ok,ref) VALUES(?,?,?,?)", [v.slug, row.id, row.ok ? 1 : 0, row.ref]);
      if (row.ok) e(`video:${v.slug}`, "reached", `stage:${row.id}`, short(row.ref));
    }
  }

  const one = <T>(sql: string) => db.query(sql).get() as T;
  const c = one<{ n: number }>("SELECT COUNT(*) n FROM nodes").n;
  const ce = one<{ n: number }>("SELECT COUNT(*) n FROM edges").n;
  const cs = one<{ n: number }>("SELECT COUNT(*) n FROM stage_state WHERE ok=1").n;
  const cg = one<{ n: number }>("SELECT COUNT(*) n FROM stage_check WHERE ok=0 AND manual=0").n;
  console.log(`video-ontology: ${DB_PATH}`);
  console.log(`  nodes ${c} / edges ${ce} / 到達セル ${cs}/${videos.length * doc.flow.length} / 本 ${videos.length}`);
  console.log(`  gate 不合格 ${cg}（manual は別）`);
  console.log(`  内訳: ${db.query("SELECT kind, COUNT(*) n FROM nodes GROUP BY kind ORDER BY n DESC").all().map((r: any) => `${r.kind} ${r.n}`).join(" / ")}`);
  db.close();
}

// 代表クエリ（data/queries.sql と同じ内容。名前で引ける）
const QUERIES: Record<string, string> = {
  progress: "SELECT slug, kind, status, reached || '/' || total AS reached, next_stage FROM v_progress ORDER BY no",
  missing: "SELECT id, label, who, agent, missing FROM v_missing WHERE missing > 0",
  next: "SELECT slug, stage_id, label, who, agent FROM v_next LIMIT 20",
  "type-stages": "SELECT t.id, t.aspect, COUNT(e.dst) AS stages FROM types t LEFT JOIN edges e ON e.src='type:'||t.id AND e.rel='uses' GROUP BY t.id",
  servers: "SELECT id, kind, role, stage_id FROM repos ORDER BY stage_id, id",
  cast: "SELECT role, agent, model, engine, token_env FROM cast_roles ORDER BY role",
  "cast-overrides": "SELECT type_id, role, model, why FROM type_cast WHERE model IS NOT NULL ORDER BY type_id, role",
  keys: "SELECT DISTINCT dst AS key FROM edges WHERE rel='needs_key' ORDER BY key",
  "stage-detail": `SELECT s.no, s.id, s.label, s.who, s.agent, s.outside, s.gate,
       (SELECT GROUP_CONCAT(dst, ' ') FROM edges WHERE src='stage:'||s.id AND rel='produces') AS artifacts,
       (SELECT GROUP_CONCAT(dst, ' ') FROM edges WHERE src='stage:'||s.id AND rel='stored_in') AS where_
     FROM stages s ORDER BY s.no`,
  "video-graph": "SELECT src, rel, dst FROM edges WHERE src LIKE 'video:%' ORDER BY src, rel",
  "artifacts-by-stage": "SELECT src AS stage, COUNT(*) n FROM edges WHERE rel='produces' GROUP BY src ORDER BY stage",
  "status-vocab": "SELECT value, meaning FROM vocab WHERE kind='status' ORDER BY ord",
  "gate-fail": "SELECT check_id, stage_id, COUNT(*) AS failing, (SELECT note FROM gate_checks g WHERE g.id = f.check_id) AS note FROM v_gate_fail f GROUP BY check_id ORDER BY failing DESC",
  "gate-by-stage": "SELECT stage_id, check_id, COUNT(*) failing FROM v_gate_fail GROUP BY check_id ORDER BY stage_id",
  manual: "SELECT id, stage_id, note FROM gate_checks WHERE manual = 1 ORDER BY stage_id",
  human: "SELECT n.id AS gate, n.extra AS how, (SELECT GROUP_CONCAT(dst, ' ') FROM edges WHERE src=n.id AND rel='sinks_to') AS sinks FROM nodes n WHERE n.kind='gate' ORDER BY n.id",
  "human-vs-agent": "SELECT who, COUNT(*) n, GROUP_CONCAT(id, ' ') stages FROM stages GROUP BY who",
};

function runQuery(nameOrSql: string): void {
  const sql = QUERIES[nameOrSql] ?? nameOrSql;
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db.query(sql).all();
  if (rows.length === 0) {
    console.log("(0 件)");
  } else {
    console.log(Object.keys(rows[0] as object).join("\t"));
    for (const r of rows) console.log(Object.values(r as object).map((v) => (v === null ? "" : String(v))).join("\t"));
  }
  db.close();
}

const [sub, ...rest] = process.argv.slice(2);
if (sub === "build" || !sub) build();
else if (sub === "queries") {
  for (const [k, v] of Object.entries(QUERIES)) console.log(`${k}\n  ${v.replace(/\s+/g, " ").slice(0, 160)}`);
} else if (sub === "q") {
  if (!rest.length) {
    console.error("q <name|SQL>");
    process.exit(1);
  }
  runQuery(rest.join(" "));
} else {
  console.error("使い方: ontology.ts [build|queries|q <name|SQL>]");
  process.exit(1);
}
