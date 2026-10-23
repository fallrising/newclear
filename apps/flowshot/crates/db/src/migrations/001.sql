CREATE TABLE workspaces (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL CHECK (length(trim(name)) > 0),
    archived_at   INTEGER,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);

CREATE TABLE workspace_roots (
    id                TEXT PRIMARY KEY,
    workspace_id      TEXT NOT NULL REFERENCES workspaces(id),
    abs_path          TEXT NOT NULL,
    canonical_path    TEXT NOT NULL,
    status            TEXT NOT NULL CHECK (status IN ('active','detached')),
    ext_filter_json   TEXT NOT NULL CHECK (json_valid(ext_filter_json)),
    ignore_rules_json TEXT NOT NULL CHECK (json_valid(ignore_rules_json)),
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    UNIQUE (workspace_id, canonical_path)
);

CREATE TABLE documents (
    id                  TEXT PRIMARY KEY,
    root_id             TEXT NOT NULL REFERENCES workspace_roots(id),
    rel_path            TEXT NOT NULL,
    status              TEXT NOT NULL CHECK (status IN ('present','missing')),
    source_hash         TEXT,
    canonical_text_hash TEXT,
    model_version       INTEGER,
    size_bytes          INTEGER,
    mtime_ms            INTEGER,
    revision            INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    last_seen_at        INTEGER,
    last_opened_at      INTEGER,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL,
    UNIQUE (root_id, rel_path)
);

CREATE INDEX idx_documents_root_status
    ON documents(root_id, status);
CREATE INDEX idx_documents_last_opened
    ON documents(last_opened_at DESC);

CREATE TABLE annotations (
    id                       TEXT PRIMARY KEY,
    document_id              TEXT NOT NULL REFERENCES documents(id),
    kind                     TEXT NOT NULL CHECK (kind IN ('range','document')),
    body                     TEXT NOT NULL DEFAULT '',
    color                    TEXT NOT NULL DEFAULT 'yellow'
                             CHECK (color IN ('yellow','green','blue','pink','purple')),
    anchor_status            TEXT NOT NULL
                             CHECK (anchor_status IN ('attached','orphaned','document')),
    anchor_json              TEXT CHECK (anchor_json IS NULL OR json_valid(anchor_json)),
    last_resolution          TEXT NOT NULL DEFAULT 'none'
                             CHECK (last_resolution IN
                               ('none','unchanged','exact','context','fuzzy','manual')),
    last_reanchored_revision INTEGER,
    row_version              INTEGER NOT NULL DEFAULT 0,
    deleted_at               INTEGER,
    created_at               INTEGER NOT NULL,
    updated_at               INTEGER NOT NULL,
    CHECK (
      (kind = 'document' AND anchor_status = 'document' AND anchor_json IS NULL)
      OR
      (kind = 'range' AND anchor_status IN ('attached','orphaned') AND anchor_json IS NOT NULL)
    ),
    CHECK (kind = 'range' OR length(trim(body)) > 0)
);

CREATE INDEX idx_annotations_document_active
    ON annotations(document_id, deleted_at, anchor_status);

CREATE TABLE annotation_anchor_events (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    annotation_id     TEXT NOT NULL REFERENCES annotations(id),
    document_revision INTEGER NOT NULL,
    trigger_source    TEXT NOT NULL
                      CHECK (trigger_source IN ('open','watcher','manual','replay')),
    outcome           TEXT NOT NULL
                      CHECK (outcome IN ('unchanged','shifted','orphaned','recovered')),
    method            TEXT NOT NULL
                      CHECK (method IN ('none','exact','context','fuzzy','manual')),
    score             REAL,
    old_anchor_json   TEXT CHECK (old_anchor_json IS NULL OR json_valid(old_anchor_json)),
    new_anchor_json   TEXT CHECK (new_anchor_json IS NULL OR json_valid(new_anchor_json)),
    reason_code       TEXT,
    created_at        INTEGER NOT NULL
);

CREATE INDEX idx_anchor_events_annotation
    ON annotation_anchor_events(annotation_id, id DESC);

CREATE TABLE comments (
    id            TEXT PRIMARY KEY,
    annotation_id TEXT NOT NULL REFERENCES annotations(id),
    parent_id     TEXT REFERENCES comments(id),
    body          TEXT NOT NULL CHECK (length(trim(body)) > 0),
    row_version   INTEGER NOT NULL DEFAULT 0,
    deleted_at    INTEGER,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);

CREATE INDEX idx_comments_annotation
    ON comments(annotation_id, created_at);

CREATE TABLE tags (
    id              TEXT PRIMARY KEY,
    display_name    TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    kind            TEXT NOT NULL DEFAULT 'user'
                    CHECK (kind IN ('user','system')),
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    CHECK (length(trim(display_name)) BETWEEN 1 AND 64)
);

CREATE TABLE document_tags (
    document_id TEXT NOT NULL REFERENCES documents(id),
    tag_id      TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (document_id, tag_id)
);

CREATE TABLE annotation_tags (
    annotation_id TEXT NOT NULL REFERENCES annotations(id),
    tag_id        TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at    INTEGER NOT NULL,
    PRIMARY KEY (annotation_id, tag_id)
);

CREATE INDEX idx_document_tags_tag ON document_tags(tag_id, document_id);
CREATE INDEX idx_annotation_tags_tag ON annotation_tags(tag_id, annotation_id);

CREATE TABLE app_state (
    scope       TEXT NOT NULL,
    key         TEXT NOT NULL,
    value_json  TEXT NOT NULL CHECK (json_valid(value_json)),
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (scope, key)
);


CREATE TRIGGER no_delete_documents BEFORE DELETE ON documents BEGIN SELECT RAISE(ABORT,'hard_delete'); END;
CREATE TRIGGER no_delete_annotations BEFORE DELETE ON annotations BEGIN SELECT RAISE(ABORT,'hard_delete'); END;
CREATE TRIGGER no_delete_comments BEFORE DELETE ON comments BEGIN SELECT RAISE(ABORT,'hard_delete'); END;
CREATE TRIGGER comment_parent_insert BEFORE INSERT ON comments WHEN NEW.parent_id IS NOT NULL BEGIN
 SELECT CASE WHEN NEW.parent_id = NEW.id OR NOT EXISTS(SELECT 1 FROM comments p WHERE p.id=NEW.parent_id AND p.annotation_id=NEW.annotation_id AND p.parent_id IS NULL) THEN RAISE(ABORT,'comment_parent') END;
END;
CREATE TRIGGER comment_parent_update BEFORE UPDATE OF id,parent_id,annotation_id ON comments BEGIN
 SELECT CASE WHEN NEW.parent_id IS NOT NULL AND (NEW.parent_id=NEW.id OR NOT EXISTS(SELECT 1 FROM comments p WHERE p.id=NEW.parent_id AND p.annotation_id=NEW.annotation_id AND p.parent_id IS NULL)) THEN RAISE(ABORT,'comment_parent') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM comments c WHERE c.parent_id=OLD.id AND (NEW.parent_id IS NOT NULL OR c.annotation_id<>NEW.annotation_id OR NEW.id IS NOT OLD.id)) THEN RAISE(ABORT,'comment_children') END;
END;
CREATE TRIGGER system_tag_update BEFORE UPDATE ON tags WHEN OLD.kind='system' AND (NEW.id IS NOT OLD.id OR NEW.display_name<>OLD.display_name OR NEW.normalized_name<>OLD.normalized_name OR NEW.kind<>OLD.kind) BEGIN SELECT RAISE(ABORT,'system_tag'); END;
CREATE TRIGGER system_tag_delete BEFORE DELETE ON tags WHEN OLD.kind='system' BEGIN SELECT RAISE(ABORT,'system_tag'); END;
CREATE TRIGGER pin_annotation_insert BEFORE INSERT ON annotation_tags WHEN EXISTS(SELECT 1 FROM tags WHERE id=NEW.tag_id AND kind='system' AND normalized_name='pin') BEGIN SELECT RAISE(ABORT,'pin_document_only'); END;
CREATE TRIGGER pin_annotation_update BEFORE UPDATE ON annotation_tags WHEN EXISTS(SELECT 1 FROM tags WHERE id=NEW.tag_id AND kind='system' AND normalized_name='pin') BEGIN SELECT RAISE(ABORT,'pin_document_only'); END;
INSERT INTO tags(id,display_name,normalized_name,kind,created_at,updated_at) VALUES('00000000-0000-7000-8000-000000000001','pin','pin','system',0,0);
