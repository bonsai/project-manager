-- queries.sql — 動画オントロジの代表クエリ
--
-- 実行: `bun ~/.skills/project-manager/ontology.ts q <name>`（同じ内容がビルトイン）
--       任意 SQL は `bun ontology.ts q "SELECT ..."`、sqlite3 でも可
--
-- 型付きテーブル（stages / repos / types / cast_roles / type_cast / vocab / ledger_fields / videos）
-- と汎用グラフ（nodes / edges）、状態（stage_state + ビュー 3 つ）を引く。

-- ── 進捗（本ごとの到達度と次の一手） ─────────────────────
-- name: progress
SELECT slug, kind, status, reached || '/' || total AS reached, next_stage
FROM v_progress ORDER BY no;

-- ── 工程別の未達数（次に何を片付けるか） ─────────────────
-- name: missing
SELECT id, label, who, agent, missing FROM v_missing WHERE missing > 0;

-- ── 次の一手（対象 → 工程 → 担当） ───────────────────────
-- name: next
SELECT slug, stage_id, label, who, agent FROM v_next LIMIT 20;

-- ── 工程の全体像（成果物パターンと保管先つき） ───────────
-- name: stage-detail
SELECT s.no, s.id, s.label, s.who, s.agent, s.outside, s.gate,
       (SELECT GROUP_CONCAT(dst, ' ') FROM edges WHERE src = 'stage:' || s.id AND rel = 'produces') AS artifacts,
       (SELECT GROUP_CONCAT(dst, ' ') FROM edges WHERE src = 'stage:' || s.id AND rel = 'stored_in') AS where_
FROM stages s ORDER BY s.no;

-- ── どの repo がどの工程を serving するか ────────────────
-- name: servers
SELECT id, kind, role, stage_id FROM repos ORDER BY stage_id, id;

-- ── キャスト（誰に・どのモデルで・どの鍵で） ─────────────
-- name: cast
SELECT role, agent, model, engine, token_env FROM cast_roles ORDER BY role;

-- name: cast-overrides
SELECT type_id, role, model, why FROM type_cast WHERE model IS NOT NULL ORDER BY type_id, role;

-- ── 使う鍵（値は持たない。env 名だけ） ───────────────────
-- name: keys
SELECT DISTINCT dst AS key FROM edges WHERE rel = 'needs_key' ORDER BY key;

-- ── タイプ別に使う工程数（aspect つき） ──────────────────
-- name: type-stages
SELECT t.id, t.aspect, COUNT(e.dst) AS stages
FROM types t LEFT JOIN edges e ON e.src = 'type:' || t.id AND e.rel = 'uses'
GROUP BY t.id;

-- ── 1 本の動画をノード/エッジで辿る ──────────────────────
-- name: video-graph
SELECT src, rel, dst FROM edges WHERE src LIKE 'video:%' ORDER BY src, rel;

-- ── 台帳の語彙（status の段階） ──────────────────────────
-- name: status-vocab
SELECT value, meaning FROM vocab WHERE kind = 'status' ORDER BY ord;

-- ── 任意: グラフを逆に辿る（この工程は誰の成果物か） ─────
-- SELECT src, rel FROM edges WHERE dst = 'stage:tts';
--
-- ── 任意: 到達済みの参照（パス / youtube_id / views） ────
-- SELECT v.slug, s.stage_id, s.ref FROM stage_state s JOIN videos v ON v.slug = s.slug
-- WHERE s.ok = 1 ORDER BY v.no, s.stage_id;
