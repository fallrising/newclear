-- One-to-one post image metadata. SQLite stores metadata only, never image bytes.
-- The FK cascade removes only the metadata row when a post is deleted; it never
-- deletes filesystem bytes (unreferenced files are handled by stopped-app
-- reconciliation). No backfill: existing V1-V8 posts project image = null.
CREATE TABLE post_images (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id      INTEGER NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
    storage_key  TEXT    NOT NULL UNIQUE,
    content_type TEXT    NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
    byte_size    INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
    width        INTEGER NOT NULL CHECK (width >= 1 AND width <= 4096),
    height       INTEGER NOT NULL CHECK (height >= 1 AND height <= 4096),
    sha256       TEXT    NOT NULL
                CHECK (length(sha256) = 64
                       AND sha256 = lower(sha256)
                       AND sha256 NOT GLOB '*[^0-9a-f]*'),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (width * height <= 12000000)
);