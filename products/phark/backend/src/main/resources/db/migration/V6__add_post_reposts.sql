CREATE TABLE post_reposts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (post_id, account_id)
);

CREATE INDEX idx_post_reposts_timeline
    ON post_reposts(created_at DESC, id DESC);

CREATE INDEX idx_post_reposts_account_timeline
    ON post_reposts(account_id, created_at DESC, id DESC);
