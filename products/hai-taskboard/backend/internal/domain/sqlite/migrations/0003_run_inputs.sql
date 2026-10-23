-- Immutable dispatch-time inputs only. Legacy Runs deliberately remain without envelopes.
CREATE TABLE run_input_envelopes (
    project_id TEXT NOT NULL CHECK (length(project_id) > 0),
    run_id TEXT NOT NULL CHECK (length(run_id) > 0),
    work_item_id TEXT NOT NULL CHECK (length(work_item_id) > 0),
    codec_version INTEGER NOT NULL CHECK (codec_version = 1),
    input_digest TEXT NOT NULL CHECK (length(input_digest) = 64 AND input_digest NOT GLOB '*[^0-9a-f]*'),
    canonical_content BLOB NOT NULL CHECK (length(canonical_content) BETWEEN 1 AND 1048576),
    PRIMARY KEY (project_id, run_id),
    FOREIGN KEY (project_id, run_id) REFERENCES runs(project_id, run_id),
    FOREIGN KEY (project_id, work_item_id) REFERENCES work_items(project_id, work_item_id)
) STRICT;
CREATE TRIGGER run_input_envelopes_no_update BEFORE UPDATE ON run_input_envelopes BEGIN
    SELECT RAISE(ABORT, 'immutable run_input_envelopes');
END;
CREATE TRIGGER run_input_envelopes_no_delete BEFORE DELETE ON run_input_envelopes BEGIN
    SELECT RAISE(ABORT, 'immutable run_input_envelopes');
END;
CREATE TRIGGER run_input_envelopes_no_duplicate BEFORE INSERT ON run_input_envelopes
WHEN EXISTS (SELECT 1 FROM run_input_envelopes WHERE project_id = NEW.project_id AND run_id = NEW.run_id) BEGIN
    SELECT RAISE(ABORT, 'immutable run_input_envelopes');
END;
