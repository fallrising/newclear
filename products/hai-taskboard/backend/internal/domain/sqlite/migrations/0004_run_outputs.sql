-- Explicit producer associations only; legacy history is never inferred or backfilled.
CREATE TABLE run_output_artifacts (
    project_id TEXT NOT NULL CHECK (length(CAST(project_id AS BLOB)) > 0),
    run_id TEXT NOT NULL CHECK (length(CAST(run_id AS BLOB)) > 0),
    artifact_digest TEXT NOT NULL CHECK (length(CAST(artifact_digest AS BLOB)) = 64 AND artifact_digest NOT GLOB '*[^0-9a-f]*' AND instr(artifact_digest, char(0)) = 0),
    input_digest TEXT NOT NULL CHECK (length(CAST(input_digest AS BLOB)) = 64 AND input_digest NOT GLOB '*[^0-9a-f]*' AND instr(input_digest, char(0)) = 0),
    lease_epoch INTEGER NOT NULL CHECK (lease_epoch > 0),
    restore_generation INTEGER NOT NULL CHECK (restore_generation > 0),
    PRIMARY KEY (project_id, run_id, artifact_digest),
    FOREIGN KEY (project_id, run_id) REFERENCES runs(project_id, run_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
    FOREIGN KEY (artifact_digest) REFERENCES artifacts(digest) ON UPDATE NO ACTION ON DELETE NO ACTION
) STRICT;
CREATE TRIGGER run_output_artifacts_no_update BEFORE UPDATE ON run_output_artifacts BEGIN
    SELECT RAISE(ABORT, 'immutable run_output_artifacts');
END;
CREATE TRIGGER run_output_artifacts_no_delete BEFORE DELETE ON run_output_artifacts BEGIN
    SELECT RAISE(ABORT, 'immutable run_output_artifacts');
END;
CREATE TRIGGER run_output_artifacts_no_duplicate BEFORE INSERT ON run_output_artifacts
WHEN EXISTS (SELECT 1 FROM run_output_artifacts WHERE project_id = NEW.project_id AND run_id = NEW.run_id AND artifact_digest = NEW.artifact_digest) BEGIN
    SELECT RAISE(ABORT, 'immutable run_output_artifacts');
END;
