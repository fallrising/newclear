CREATE TABLE events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    id TEXT NOT NULL,
    type TEXT NOT NULL,
    subject TEXT NOT NULL,
    time TEXT NOT NULL,
    received_at TEXT NOT NULL,
    severity TEXT NOT NULL,
    severity_rank INTEGER NOT NULL CHECK (severity_rank BETWEEN 0 AND 5),
    summary TEXT NOT NULL,
    originurl TEXT NOT NULL,
    correlationid TEXT NOT NULL,
    causationid TEXT NOT NULL,
    content_hash BLOB NOT NULL CHECK (length(content_hash) = 32),
    raw_json BLOB NOT NULL,
    clock_skew INTEGER NOT NULL CHECK (clock_skew IN (0, 1)),
    UNIQUE (source, id)
);
CREATE INDEX events_time ON events(time DESC, seq DESC);
CREATE INDEX events_source_time ON events(source, time DESC, seq DESC);
CREATE INDEX events_type_time ON events(type, time DESC, seq DESC);
CREATE INDEX events_correlation ON events(correlationid, time, seq);
CREATE TABLE ingest_conflicts (
    source TEXT NOT NULL,
    id TEXT NOT NULL,
    received_at TEXT NOT NULL,
    content_hash BLOB NOT NULL CHECK (length(content_hash) = 32),
    raw_json BLOB NOT NULL
);
