-- video-ontology.sql — 動画ドメインのオントロジ（スキーマ）
--
-- 生成: `bun ~/.skills/project-manager/ontology.ts build`
--   wf.yaml（9 工程・roots・成果物・repo）+ casting.yaml（キャスト表）
--   + data/videos.jsonl（台帳のインスタンス）+ lib/stages.ts（工程の状態判定）
-- から data/video-ontology.db を作る。**この DB は派生**で、正は上の 3 ファイル。
--
-- 型付きテーブル（domain）: stages / repos / types / cast_roles / type_cast / vocab / ledger_fields / videos
-- 汎用グラフ: nodes / edges（型をまたいだ関係を 1 本で辿る）
-- 状態（毎回変わる）: stage_state + ビュー 3 つ

DROP VIEW IF EXISTS v_gate_fail;
DROP VIEW IF EXISTS v_progress;
DROP VIEW IF EXISTS v_missing;
DROP VIEW IF EXISTS v_next;
DROP TABLE IF EXISTS stage_check;
DROP TABLE IF EXISTS gate_checks;
DROP TABLE IF EXISTS stage_state;
DROP TABLE IF EXISTS edges;
DROP TABLE IF EXISTS nodes;
DROP TABLE IF EXISTS videos;
DROP TABLE IF EXISTS ledger_fields;
DROP TABLE IF EXISTS vocab;
DROP TABLE IF EXISTS type_cast;
DROP TABLE IF EXISTS cast_roles;
DROP TABLE IF EXISTS types;
DROP TABLE IF EXISTS repos;
DROP TABLE IF EXISTS stages;

-- 工程（9 要素）。wf.yaml の flow / wfs が正。
CREATE TABLE stages (
    id        TEXT PRIMARY KEY,      -- neta | script | tts | prompt | image | se | mux | deploy | metrics
    no        INTEGER NOT NULL,      -- flow の順
    label     TEXT NOT NULL,         -- ネタワード
    produces  TEXT,                  -- 成果物の説明
    gate      TEXT,                  -- 通過条件
    who       TEXT,                  -- human | agent
    agent     TEXT,                  -- 担当エージェント（who=agent のとき）
    outside   INTEGER DEFAULT 0,     -- 出先（スマホ）でできるか
    library   TEXT                   -- 供給元（talkscripts 等）
);

-- 工程 ↔ repo / サービス。wf.yaml の repos が正。
CREATE TABLE repos (
    id       TEXT NOT NULL,          -- video-gen/data/audio, YouTube, MEGA …
    kind     TEXT NOT NULL,          -- repo | service | store
    stage_id TEXT NOT NULL REFERENCES stages(id),
    role     TEXT,                   -- artifact（成果物が在る）| ledger | external
    PRIMARY KEY (id, stage_id)       -- 同じ repo が複数工程を serving する
);

-- 動画タイプ。casting.yaml の types が正。
CREATE TABLE types (
    id      TEXT PRIMARY KEY,        -- essay | short | koma | explainer
    aspect  TEXT,                    -- 16:9 | 9:16 | 1:1
    stages  TEXT NOT NULL            -- 使う工程（csv、flow 順）
);

-- キャスト（誰に・どのモデルで・どの鍵で）。casting.yaml の defaults が正。
CREATE TABLE cast_roles (
    role      TEXT PRIMARY KEY,      -- pm | script | tts | image | se | mux | metrics | qc
    stage_id  TEXT REFERENCES stages(id),
    agent     TEXT,
    model     TEXT,
    engine    TEXT,
    token_env TEXT                   -- env 名だけ（値は持たない）
);

-- タイプ別のキャスト上書き。casting.yaml の types.<t>.cast が正。
CREATE TABLE type_cast (
    type_id   TEXT NOT NULL REFERENCES types(id),
    role      TEXT NOT NULL REFERENCES cast_roles(role),
    agent     TEXT,
    model     TEXT,
    engine    TEXT,
    token_env TEXT,
    why       TEXT,                  -- 有料を使う理由など
    PRIMARY KEY (type_id, role)
);

-- 語彙（status / kind / aspect など）。data/SCHEMA.md の語彙を写す。
CREATE TABLE vocab (
    kind    TEXT NOT NULL,           -- status | kind | aspect | channel
    value   TEXT NOT NULL,
    meaning TEXT,
    ord     INTEGER,
    PRIMARY KEY (kind, value)
);

-- 台帳のフィールド定義。data/SCHEMA.md のレコード例が正。
CREATE TABLE ledger_fields (
    name     TEXT PRIMARY KEY,
    type     TEXT,
    required INTEGER DEFAULT 0,
    note     TEXT
);

-- 台帳のインスタンス。data/videos.jsonl が正（1 行 = 1 本）。
CREATE TABLE videos (
    slug         TEXT PRIMARY KEY,
    no           TEXT,
    title        TEXT,
    series       TEXT,
    kind         TEXT REFERENCES types(id),
    status       TEXT REFERENCES vocab(value),
    stage_date   TEXT,
    file         TEXT,
    youtube_id   TEXT,
    url          TEXT,
    published_at TEXT,
    planned_for  TEXT,
    channel      TEXT,
    views        INTEGER,
    likes        INTEGER,
    notes        TEXT,
    is_uploaded  INTEGER GENERATED ALWAYS AS (youtube_id IS NOT NULL) VIRTUAL
);

-- 工程の状態（毎回の生成で作り直す）。判定は lib/stages.ts が唯一の実装。
CREATE TABLE stage_state (
    slug     TEXT NOT NULL REFERENCES videos(slug),
    stage_id TEXT NOT NULL REFERENCES stages(id),
    ok       INTEGER NOT NULL,       -- 1 = 到達済み
    ref      TEXT,                   -- 成果物パス / youtube_id / "47 views"
    PRIMARY KEY (slug, stage_id)
);

-- gate（通過条件）。wf.yaml の checks が正。
CREATE TABLE gate_checks (
    id       TEXT PRIMARY KEY,       -- neta-body, script-chars, mux-final, deploy-id …
    stage_id TEXT REFERENCES stages(id),
    kind     TEXT NOT NULL,          -- presence | count | words | chars | contains | duration | suffix | aspect | number | youtube | manual
    match    TEXT,                   -- 対象ファイルの絞り込み（基底名の glob）
    min      REAL,
    max_      REAL,
    pattern  TEXT,
    from_type INTEGER DEFAULT 0,     -- 期待値を types（aspect / chars / seconds）から取る
    manual   INTEGER DEFAULT 0,      -- 人手で確認（自動判定しない）
    note     TEXT
);

-- gate の状態（毎回の生成で作り直す）。検査は lib/gates.ts が唯一の実装。
CREATE TABLE stage_check (
    slug     TEXT NOT NULL REFERENCES videos(slug),
    check_id TEXT NOT NULL REFERENCES gate_checks(id),
    ok       INTEGER NOT NULL,
    manual   INTEGER NOT NULL DEFAULT 0,
    detail   TEXT,
    PRIMARY KEY (slug, check_id)
);

-- 汎用グラフ: 型付きテーブルをまたいだ関係を 1 本で辿る。
CREATE TABLE nodes (
    id    TEXT PRIMARY KEY,          -- 'stage:tts', 'repo:video-gen/data/audio', 'video:typesafe-jev' …
    kind  TEXT NOT NULL,             -- stage | repo | type | role | video | vocab | field
    label TEXT,
    extra TEXT
);

CREATE TABLE edges (
    src  TEXT NOT NULL REFERENCES nodes(id),
    rel  TEXT NOT NULL,              -- produces | stored_in | uses | cast_as | runs_on | needs_key | has_status | of_type | in_series | gate | next
    dst  TEXT NOT NULL REFERENCES nodes(id),
    note TEXT,
    PRIMARY KEY (src, rel, dst)
);

CREATE INDEX idx_edges_src ON edges(src, rel);
CREATE INDEX idx_edges_dst ON edges(dst, rel);
CREATE INDEX idx_state_ok ON stage_state(stage_id, ok);

-- 本ごとの到達度（9 要素のうち何個 ✅ か）と次の一手
CREATE VIEW v_progress AS
SELECT v.no, v.slug, v.kind, v.status,
       SUM(s.ok)                                   AS reached,
       (SELECT COUNT(*) FROM stages)               AS total,
       (SELECT st.id FROM stage_state x JOIN stages st ON st.id = x.stage_id
         WHERE x.slug = v.slug AND x.ok = 0
         ORDER BY st.no LIMIT 1)                   AS next_stage
FROM videos v JOIN stage_state s ON s.slug = v.slug
GROUP BY v.slug;

-- 工程別の未達数（次に何を片付けるか）
CREATE VIEW v_missing AS
SELECT st.no, st.id, st.label, st.who, st.agent,
       SUM(CASE WHEN s.ok = 0 THEN 1 ELSE 0 END) AS missing
FROM stages st JOIN stage_state s ON s.stage_id = st.id
GROUP BY st.id ORDER BY missing DESC, st.no;

-- gate の不合格（自動判定のみ。manual は別）
CREATE VIEW v_gate_fail AS
SELECT c.id AS check_id, c.stage_id, c.note, s.slug, s.detail
FROM stage_check s JOIN gate_checks c ON c.id = s.check_id
WHERE s.ok = 0 AND s.manual = 0
ORDER BY c.stage_id, c.id;

-- 次の一手（工程 → 担当 → 対象）
CREATE VIEW v_next AS
SELECT p.slug, st.id AS stage_id, st.label, st.who, st.agent
FROM v_progress p
JOIN stages st ON st.id = p.next_stage
ORDER BY p.no;
