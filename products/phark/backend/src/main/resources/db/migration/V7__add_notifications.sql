CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_account_id INTEGER NOT NULL
        REFERENCES accounts(id) ON DELETE CASCADE,
    actor_account_id INTEGER NOT NULL
        REFERENCES accounts(id) ON DELETE CASCADE,
    post_id INTEGER NOT NULL
        REFERENCES posts(id) ON DELETE CASCADE,
    reply_id INTEGER
        REFERENCES replies(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('REPLY', 'LIKE', 'REPOST')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK ((type = 'REPLY' AND reply_id IS NOT NULL)
        OR (type IN ('LIKE', 'REPOST') AND reply_id IS NULL)),
    UNIQUE (reply_id)
);


CREATE INDEX idx_notifications_recipient_page
    ON notifications(recipient_account_id, id DESC);

CREATE TABLE notification_read_state (
    account_id INTEGER PRIMARY KEY
        REFERENCES accounts(id) ON DELETE CASCADE,
    read_through_id INTEGER NOT NULL DEFAULT 0 CHECK (read_through_id >= 0),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
