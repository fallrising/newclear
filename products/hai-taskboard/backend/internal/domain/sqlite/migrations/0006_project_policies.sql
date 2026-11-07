CREATE TABLE project_completion_policies (
    project_id TEXT NOT NULL PRIMARY KEY CHECK (length(project_id) > 0),
    codec_version INTEGER NOT NULL CHECK (codec_version = 1),
    revision_digest TEXT NOT NULL CHECK (length(revision_digest) = 64 AND revision_digest NOT GLOB '*[^0-9a-f]*'),
    canonical_content BLOB NOT NULL CHECK (length(canonical_content) BETWEEN 1 AND 262144),
    registered_at_ns INTEGER NOT NULL CHECK (registered_at_ns > 0),
    FOREIGN KEY (project_id) REFERENCES projects(project_id)
) STRICT;
CREATE TRIGGER project_completion_policies_no_update BEFORE UPDATE ON project_completion_policies BEGIN
    SELECT RAISE(ABORT, 'immutable project completion policy');
END;
CREATE TRIGGER project_completion_policies_no_delete BEFORE DELETE ON project_completion_policies BEGIN
    SELECT RAISE(ABORT, 'immutable project completion policy');
END;
CREATE TRIGGER project_completion_policies_no_duplicate BEFORE INSERT ON project_completion_policies
WHEN EXISTS (SELECT 1 FROM project_completion_policies WHERE project_id = NEW.project_id) BEGIN
    SELECT RAISE(ABORT, 'immutable project completion policy');
END;
