CREATE TABLE rule_definitions (
    rule_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK(version > 0),
    content_hash TEXT NOT NULL,
    definition BLOB NOT NULL,
    PRIMARY KEY(rule_id, version)
);
CREATE TABLE rules_state (
    rule_id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    active INTEGER NOT NULL CHECK(active IN (0,1)),
    needs_backfill INTEGER NOT NULL CHECK(needs_backfill IN (0,1)),
    failures INTEGER NOT NULL DEFAULT 0,
    failure_episode INTEGER NOT NULL DEFAULT 0,
    failure_emitted INTEGER NOT NULL DEFAULT 0,
    last_computed_at TEXT
);
CREATE TABLE rollups (
    rule_id TEXT NOT NULL,
    rule_version INTEGER NOT NULL,
    bucket_start TEXT NOT NULL,
    bucket_key TEXT NOT NULL,
    group_key TEXT NOT NULL,
    value REAL,
    sample_count INTEGER NOT NULL CHECK(sample_count >= 0),
    partial INTEGER NOT NULL CHECK(partial IN (0,1)),
    computed_at TEXT NOT NULL,
    PRIMARY KEY(rule_id,rule_version,bucket_key,group_key)
);
CREATE INDEX rollups_query ON rollups(rule_id,bucket_key,rule_version,group_key);
CREATE TABLE threshold_state (
    rule_id TEXT NOT NULL,
    rule_version INTEGER NOT NULL,
    group_key TEXT NOT NULL,
    last_bucket TEXT NOT NULL,
    crossed INTEGER NOT NULL CHECK(crossed IN (0,1)),
    streak INTEGER NOT NULL,
    PRIMARY KEY(rule_id,rule_version,group_key)
);
CREATE TABLE config_audit (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK(outcome IN ('reloaded','rejected'))
);
