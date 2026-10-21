-- Phase 0 design draft, NOT an automatically applied D1 migration.
-- Apply only to a disposable SQLite fixture for review. Promotion into migrations/
-- requires phase-1 local D1 validation and a separately reviewed numbered file.
-- Single operator; auth, CSRF, timestamp/ID syntax and request bounds are API duties.

CREATE TABLE captures (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) > 0),
  body TEXT NOT NULL CHECK (length(CAST(body AS BLOB)) BETWEEN 1 AND 16384),
  source TEXT NOT NULL DEFAULT 'web' CHECK (source = 'web'),
  client_key TEXT NOT NULL UNIQUE CHECK (length(client_key) > 0),
  created_at TEXT NOT NULL CHECK (length(created_at) > 0),
  exported_commit TEXT
);

CREATE INDEX captures_pending_export ON captures(created_at, id)
  WHERE exported_commit IS NULL;

CREATE TABLE notes (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) > 0),
  article_id TEXT NOT NULL UNIQUE CHECK (length(article_id) > 0),
  body TEXT NOT NULL CHECK (length(CAST(body AS BLOB)) BETWEEN 1 AND 16384),
  updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
  revision INTEGER NOT NULL DEFAULT 1
    CHECK (typeof(revision) = 'integer' AND revision BETWEEN 1 AND 9007199254740991),
  exported_commit TEXT
);

CREATE INDEX notes_pending_export ON notes(updated_at, id)
  WHERE exported_commit IS NULL;
