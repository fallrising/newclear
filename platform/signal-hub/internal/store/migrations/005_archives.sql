-- Identity survives removal of the hot payload and is part of every snapshot.
CREATE TABLE event_identities (
    seq INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    id TEXT NOT NULL,
    time TEXT NOT NULL,
    received_at TEXT NOT NULL,
    content_hash BLOB NOT NULL CHECK(length(content_hash)=32),
    clock_skew INTEGER NOT NULL CHECK(clock_skew IN (0,1)),
    UNIQUE(source,id)
);
INSERT INTO event_identities SELECT seq,source,id,time,received_at,content_hash,clock_skew FROM events;
CREATE INDEX event_identities_time ON event_identities(time);
ALTER TABLE events ADD COLUMN restored INTEGER NOT NULL DEFAULT 0 CHECK(restored IN (0,1));
ALTER TABLE events ADD COLUMN restore_until TEXT;
ALTER TABLE sources_state ADD COLUMN retention_days INTEGER CHECK(retention_days > 0);
-- Pre-M5 hashes do not reveal accepted retention. Defer these scopes until
-- their next atomic accepted configuration reconciliation.
ALTER TABLE sources_state ADD COLUMN retention_policy_known INTEGER NOT NULL DEFAULT 0 CHECK(retention_policy_known IN (0,1));
CREATE TABLE archive_state (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    restore_generation INTEGER NOT NULL CHECK(restore_generation >= 0)
);
INSERT INTO archive_state VALUES(1,0);
CREATE TABLE archives (
    day TEXT NOT NULL,
    part INTEGER NOT NULL CHECK(part > 0),
    path TEXT NOT NULL UNIQUE,
    event_count INTEGER NOT NULL CHECK(event_count > 0 AND event_count <= 1000),
    sha256 TEXT NOT NULL CHECK(length(sha256)=64),
    first_seq INTEGER NOT NULL,
    last_seq INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    verified_at TEXT NOT NULL,
    purged_at TEXT NOT NULL,
    PRIMARY KEY(day,part)
);
CREATE TABLE archive_members (
    day TEXT NOT NULL,
    part INTEGER NOT NULL,
    ordinal INTEGER NOT NULL CHECK(ordinal > 0 AND ordinal <= 1000),
    event_seq INTEGER NOT NULL,
    PRIMARY KEY(day,part,ordinal),
    UNIQUE(day,part,event_seq),
    FOREIGN KEY(day,part) REFERENCES archives(day,part),
    FOREIGN KEY(event_seq) REFERENCES event_identities(seq)
);
CREATE INDEX archive_members_event ON archive_members(event_seq);

-- All insertion paths, including explicit original seq on import, must agree
-- with permanent identity; ordinary ingest checks conflicts before this guard.
CREATE TRIGGER events_identity_insert AFTER INSERT ON events BEGIN
    SELECT RAISE(ABORT,'event identity mismatch') WHERE EXISTS (
        SELECT 1 FROM event_identities WHERE (seq=NEW.seq OR (source=NEW.source AND id=NEW.id))
        AND (seq<>NEW.seq OR source<>NEW.source OR id<>NEW.id OR content_hash<>NEW.content_hash
             OR time<>NEW.time OR received_at<>NEW.received_at OR clock_skew<>NEW.clock_skew)
    );
    INSERT OR IGNORE INTO event_identities(seq,source,id,time,received_at,content_hash,clock_skew)
        VALUES(NEW.seq,NEW.source,NEW.id,NEW.time,NEW.received_at,NEW.content_hash,NEW.clock_skew);
END;
