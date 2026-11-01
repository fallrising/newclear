CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY,
    definition BLOB NOT NULL,
    definition_hash TEXT NOT NULL,
    active INTEGER NOT NULL CHECK(active IN (0,1)),
    activation_seq INTEGER NOT NULL CHECK(activation_seq >= 0),
    scan_seq INTEGER NOT NULL CHECK(scan_seq >= 0),
    digest_start INTEGER
);
CREATE TABLE deliveries (
    ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
    delivery_id TEXT NOT NULL UNIQUE,
    subscription_id TEXT NOT NULL,
    event_seq INTEGER,
    window_start TEXT,
    body BLOB NOT NULL,
    content_type TEXT NOT NULL,
    headers BLOB NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('pending','inflight','succeeded','dlq')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
    cycle_attempts INTEGER NOT NULL DEFAULT 0 CHECK(cycle_attempts BETWEEN 0 AND 12),
    dlq_episode INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    next_attempt_key TEXT,
    lease_token TEXT,
    lease_until TEXT,
    CHECK((event_seq IS NOT NULL AND window_start IS NULL) OR (event_seq IS NULL AND window_start IS NOT NULL))
);
CREATE INDEX deliveries_due ON deliveries(state,next_attempt_key,ordinal);
CREATE INDEX deliveries_subscription ON deliveries(subscription_id,ordinal);
CREATE TABLE delivery_attempts (
    delivery_id TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    at TEXT NOT NULL,
    http_status INTEGER,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    PRIMARY KEY(delivery_id,attempt)
);
CREATE TABLE audit_log (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    reason TEXT NOT NULL
);
