CREATE TABLE sources_state (
    name TEXT PRIMARY KEY,
    scope_hash TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    source_prefix TEXT NOT NULL,
    expected_interval TEXT NOT NULL,
    active INTEGER NOT NULL CHECK (active IN (0,1)),
    generation INTEGER NOT NULL CHECK (generation > 0),
    transition INTEGER NOT NULL DEFAULT 0 CHECK (transition >= 0),
    last_received_at TEXT,
    last_event_time TEXT,
    status TEXT NOT NULL CHECK (status IN ('never','fresh','late','silent'))
);
