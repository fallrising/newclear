-- External-content FTS5 index over posts.content. Original post content only; replies stay
-- in the replies table and are NOT indexed. External content keeps posts as source of truth;
-- the FTS table stores only the index and a rowid that mirrors posts.id.
CREATE VIRTUAL TABLE search_posts USING fts5(
    content,
    content='posts',
    content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
);

-- Migration-time rebuild: indexes every existing posts row so all current posts are
-- searchable immediately after V8. This is explicit backfill (unlike SDD-008 no-backfill).
INSERT INTO search_posts(search_posts) VALUES('rebuild');

-- Keep the FTS index synchronized for all future writes. Each trigger runs in the same
-- transaction as the posts mutation: any trigger failure rolls back the post write
-- (fail-closed, mirroring SDD-008 notification emission).
CREATE TRIGGER posts_search_ai AFTER INSERT ON posts BEGIN
    INSERT INTO search_posts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER posts_search_ad AFTER DELETE ON posts BEGIN
    INSERT INTO search_posts(search_posts, rowid, content)
    VALUES ('delete', old.id, old.content);
END;

CREATE TRIGGER posts_search_au AFTER UPDATE OF content ON posts BEGIN
    INSERT INTO search_posts(search_posts, rowid, content)
    VALUES ('delete', old.id, old.content);
    INSERT INTO search_posts(rowid, content) VALUES (new.id, new.content);
END;
