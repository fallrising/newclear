CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    handle TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (length(handle) BETWEEN 3 AND 15),
    CHECK (handle NOT GLOB '*[^a-z0-9_]*'),
    CHECK (length(display_name) BETWEEN 1 AND 50),
    CHECK (length(bio) <= 160),
    CHECK (length(password_hash) > 0)
);

ALTER TABLE posts
    ADD COLUMN author_account_id INTEGER
    REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE replies
    ADD COLUMN author_account_id INTEGER
    REFERENCES accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_posts_author_timeline
    ON posts(author_account_id, created_at DESC, id DESC);

CREATE INDEX idx_replies_author
    ON replies(author_account_id);
