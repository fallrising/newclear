-- spring-pool D1 schema v1 (SDD section 4). Forward-only.

CREATE TABLE scripts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  current_revision INTEGER NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL,
  archived_at      TEXT,
  archived_by      TEXT,
  CHECK ((archived_at IS NULL) = (archived_by IS NULL))
);

CREATE TABLE script_revisions (
  script_id   INTEGER NOT NULL REFERENCES scripts(id),
  revision    INTEGER NOT NULL CHECK (revision >= 1),
  title       TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description TEXT    NOT NULL CHECK (length(description) <= 2000),
  tags_json   TEXT    NOT NULL,              -- JSON array, e.g. ["ops","db"]
  tag_index   TEXT    NOT NULL,              -- ",ops,db," (or "," when no tags) for exact-tag LIKE
  language    TEXT    NOT NULL CHECK (language IN ('bash','python','powershell')),
  body        TEXT    NOT NULL CHECK (length(CAST(body AS BLOB)) BETWEEN 1 AND 65536),
  created_at  TEXT    NOT NULL,
  created_by  TEXT    NOT NULL,
  PRIMARY KEY (script_id, revision)
);

CREATE TABLE runbooks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  current_revision INTEGER NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL,
  archived_at      TEXT,
  archived_by      TEXT,
  CHECK ((archived_at IS NULL) = (archived_by IS NULL))
);

CREATE TABLE runbook_revisions (
  runbook_id  INTEGER NOT NULL REFERENCES runbooks(id),
  revision    INTEGER NOT NULL CHECK (revision >= 1),
  title       TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description TEXT    NOT NULL CHECK (length(description) <= 2000),
  step_count  INTEGER NOT NULL CHECK (step_count BETWEEN 1 AND 30),
  created_at  TEXT    NOT NULL,
  created_by  TEXT    NOT NULL,
  PRIMARY KEY (runbook_id, revision)
);

CREATE TABLE runbook_steps (
  runbook_id      INTEGER NOT NULL,
  revision        INTEGER NOT NULL,
  position        INTEGER NOT NULL CHECK (position BETWEEN 1 AND 30),
  script_id       INTEGER NOT NULL,
  script_revision INTEGER NOT NULL,
  instruction     TEXT    NOT NULL CHECK (length(instruction) BETWEEN 1 AND 2000),
  PRIMARY KEY (runbook_id, revision, position),
  FOREIGN KEY (runbook_id, revision) REFERENCES runbook_revisions(runbook_id, revision),
  FOREIGN KEY (script_id, script_revision) REFERENCES script_revisions(script_id, revision)
);
CREATE INDEX runbook_steps_pin ON runbook_steps(script_id, script_revision);

CREATE TABLE audit_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT    NOT NULL,
  actor       TEXT    NOT NULL,
  action      TEXT    NOT NULL CHECK (action IN (
                'script.create','script.update','script.archive',
                'runbook.create','runbook.update','runbook.archive')),
  entity_type TEXT    NOT NULL CHECK (entity_type IN ('script','runbook')),
  entity_id   INTEGER NOT NULL,
  revision    INTEGER NOT NULL
);

-- Scripts: no hard delete, no unarchive, revision never decreases.
CREATE TRIGGER scripts_no_delete BEFORE DELETE ON scripts
BEGIN SELECT RAISE(ABORT, 'sp:no_hard_delete'); END;
CREATE TRIGGER scripts_guard_update BEFORE UPDATE ON scripts
BEGIN
  SELECT RAISE(ABORT, 'sp:no_unarchive') WHERE OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL;
  SELECT RAISE(ABORT, 'sp:revision_regress') WHERE NEW.current_revision < OLD.current_revision;
END;
CREATE TRIGGER scripts_audit_archive AFTER UPDATE OF archived_at ON scripts
WHEN OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL
BEGIN
  INSERT INTO audit_events (occurred_at, actor, action, entity_type, entity_id, revision)
  VALUES (NEW.archived_at, NEW.archived_by, 'script.archive', 'script', NEW.id, NEW.current_revision);
END;

-- Script revisions: append-only, head must advance by exactly 1, audit is automatic.
CREATE TRIGGER script_revisions_guard_insert BEFORE INSERT ON script_revisions
BEGIN
  SELECT RAISE(ABORT, 'sp:not_found')         WHERE NOT EXISTS (SELECT 1 FROM scripts WHERE id = NEW.script_id);
  SELECT RAISE(ABORT, 'sp:archived')          WHERE EXISTS (SELECT 1 FROM scripts WHERE id = NEW.script_id AND archived_at IS NOT NULL);
  SELECT RAISE(ABORT, 'sp:revision_conflict') WHERE NEW.revision <> (SELECT current_revision + 1 FROM scripts WHERE id = NEW.script_id);
END;
CREATE TRIGGER script_revisions_advance AFTER INSERT ON script_revisions
BEGIN
  UPDATE scripts SET current_revision = NEW.revision, updated_at = NEW.created_at WHERE id = NEW.script_id;
  INSERT INTO audit_events (occurred_at, actor, action, entity_type, entity_id, revision)
  VALUES (NEW.created_at, NEW.created_by,
          CASE WHEN NEW.revision = 1 THEN 'script.create' ELSE 'script.update' END,
          'script', NEW.script_id, NEW.revision);
END;
CREATE TRIGGER script_revisions_immutable BEFORE UPDATE ON script_revisions
BEGIN SELECT RAISE(ABORT, 'sp:immutable_revision'); END;
CREATE TRIGGER script_revisions_no_delete BEFORE DELETE ON script_revisions
BEGIN SELECT RAISE(ABORT, 'sp:immutable_revision'); END;

-- Runbooks: identical pattern.
CREATE TRIGGER runbooks_no_delete BEFORE DELETE ON runbooks
BEGIN SELECT RAISE(ABORT, 'sp:no_hard_delete'); END;
CREATE TRIGGER runbooks_guard_update BEFORE UPDATE ON runbooks
BEGIN
  SELECT RAISE(ABORT, 'sp:no_unarchive') WHERE OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL;
  SELECT RAISE(ABORT, 'sp:revision_regress') WHERE NEW.current_revision < OLD.current_revision;
END;
CREATE TRIGGER runbooks_audit_archive AFTER UPDATE OF archived_at ON runbooks
WHEN OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL
BEGIN
  INSERT INTO audit_events (occurred_at, actor, action, entity_type, entity_id, revision)
  VALUES (NEW.archived_at, NEW.archived_by, 'runbook.archive', 'runbook', NEW.id, NEW.current_revision);
END;
CREATE TRIGGER runbook_revisions_guard_insert BEFORE INSERT ON runbook_revisions
BEGIN
  SELECT RAISE(ABORT, 'sp:not_found')         WHERE NOT EXISTS (SELECT 1 FROM runbooks WHERE id = NEW.runbook_id);
  SELECT RAISE(ABORT, 'sp:archived')          WHERE EXISTS (SELECT 1 FROM runbooks WHERE id = NEW.runbook_id AND archived_at IS NOT NULL);
  SELECT RAISE(ABORT, 'sp:revision_conflict') WHERE NEW.revision <> (SELECT current_revision + 1 FROM runbooks WHERE id = NEW.runbook_id);
END;
CREATE TRIGGER runbook_revisions_advance AFTER INSERT ON runbook_revisions
BEGIN
  UPDATE runbooks SET current_revision = NEW.revision, updated_at = NEW.created_at WHERE id = NEW.runbook_id;
  INSERT INTO audit_events (occurred_at, actor, action, entity_type, entity_id, revision)
  VALUES (NEW.created_at, NEW.created_by,
          CASE WHEN NEW.revision = 1 THEN 'runbook.create' ELSE 'runbook.update' END,
          'runbook', NEW.runbook_id, NEW.revision);
END;
CREATE TRIGGER runbook_revisions_immutable BEFORE UPDATE ON runbook_revisions
BEGIN SELECT RAISE(ABORT, 'sp:immutable_revision'); END;
CREATE TRIGGER runbook_revisions_no_delete BEFORE DELETE ON runbook_revisions
BEGIN SELECT RAISE(ABORT, 'sp:immutable_revision'); END;

-- Steps: only for the head revision, never beyond step_count, never updated.
CREATE TRIGGER runbook_steps_guard_insert BEFORE INSERT ON runbook_steps
BEGIN
  SELECT RAISE(ABORT, 'sp:immutable_revision')
    WHERE NEW.revision <> (SELECT current_revision FROM runbooks WHERE id = NEW.runbook_id);
  SELECT RAISE(ABORT, 'sp:step_out_of_range')
    WHERE NEW.position > (SELECT step_count FROM runbook_revisions WHERE runbook_id = NEW.runbook_id AND revision = NEW.revision);
END;
CREATE TRIGGER runbook_steps_immutable BEFORE UPDATE ON runbook_steps
BEGIN SELECT RAISE(ABORT, 'sp:immutable_revision'); END;

CREATE TRIGGER runbook_steps_no_delete BEFORE DELETE ON runbook_steps
BEGIN SELECT RAISE(ABORT, 'sp:immutable_revision'); END;

-- Audit: append-only in v1 (no cleanup endpoint).
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'sp:audit_immutable'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'sp:audit_immutable'); END;
