CREATE TABLE IF NOT EXISTS ai24_briefing_settings (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai24_briefings (id TEXT PRIMARY KEY, day TEXT NOT NULL, version INTEGER NOT NULL, scope TEXT NOT NULL, state TEXT NOT NULL, mode TEXT NOT NULL, fingerprint TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, published_at TEXT, UNIQUE(day,scope,version));
CREATE INDEX IF NOT EXISTS ai24_briefing_public_idx ON ai24_briefings(scope,day,state,version);
CREATE TABLE IF NOT EXISTS ai24_briefing_items (briefing_id TEXT NOT NULL, article_id TEXT NOT NULL, source_version TEXT NOT NULL, position INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(briefing_id,article_id));
CREATE INDEX IF NOT EXISTS ai24_briefing_article_idx ON ai24_briefing_items(article_id,briefing_id);
CREATE TABLE IF NOT EXISTS ai24_briefing_runs (id TEXT PRIMARY KEY, job_key TEXT NOT NULL UNIQUE, day TEXT NOT NULL, state TEXT NOT NULL, briefing_id TEXT, reason TEXT NOT NULL, error TEXT, estimated_cost_usd REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai24_briefing_audio (briefing_id TEXT PRIMARY KEY, state TEXT NOT NULL, storage_key TEXT, content_hash TEXT NOT NULL, voice TEXT, estimated_cost_usd REAL NOT NULL DEFAULT 0, generated_at TEXT, error TEXT);
