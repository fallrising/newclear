CREATE TABLE github_exports (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES runs(id),
    artifact_id uuid NOT NULL REFERENCES result_archives(id),
    artifact_sha256 text NOT NULL CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
    target_repo text NOT NULL,
    base_branch text NOT NULL,
    base_sha text NOT NULL CHECK (base_sha ~ '^[0-9a-f]{40}$'),
    branch text NOT NULL CHECK (branch ~ '^agent-platform/export-[0-9a-f]{64}$'),
    approval_digest text NOT NULL UNIQUE CHECK (approval_digest ~ '^[0-9a-f]{64}$'),
    created_by uuid NOT NULL REFERENCES operators(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    state text NOT NULL DEFAULT 'queued'
        CHECK (state IN ('queued','exporting','succeeded','failed','uncertain')),
    stage text NOT NULL DEFAULT 'approved' CHECK (stage IN (
        'approved','reading','tree_intent','tree_ready','commit_intent','commit_ready',
        'branch_intent','branch_ready','pr_intent','complete')),
    reason text CHECK (reason ~ '^[a-z][a-z0-9_]{0,79}$'),
    tree_sha text CHECK (tree_sha ~ '^[0-9a-f]{40}$'),
    commit_sha text CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
    pr_number bigint CHECK (pr_number > 0),
    pr_url text,
    reconcile_requested boolean NOT NULL DEFAULT false,
    UNIQUE (run_id,artifact_id,artifact_sha256,target_repo,base_branch,base_sha),
    CHECK (state != 'queued' OR stage = 'approved'),
    CHECK (commit_sha IS NULL OR tree_sha IS NOT NULL),
    CHECK ((pr_number IS NULL) = (pr_url IS NULL)),
    CHECK (state != 'succeeded' OR (stage = 'complete' AND pr_number IS NOT NULL
           AND commit_sha IS NOT NULL AND reason IS NULL))
);
CREATE INDEX github_exports_pending ON github_exports(created_at,id)
    WHERE state IN ('queued','exporting') OR reconcile_requested;
CREATE FUNCTION immutable_export_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF ROW(NEW.id,NEW.run_id,NEW.artifact_id,NEW.artifact_sha256,NEW.target_repo,
           NEW.base_branch,NEW.base_sha,NEW.branch,NEW.approval_digest,NEW.created_by,NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.id,OLD.run_id,OLD.artifact_id,OLD.artifact_sha256,OLD.target_repo,
           OLD.base_branch,OLD.base_sha,OLD.branch,OLD.approval_digest,OLD.created_by,OLD.created_at)
    THEN RAISE EXCEPTION 'Export approvals are immutable'; END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER github_export_approval_immutable BEFORE UPDATE ON github_exports
    FOR EACH ROW EXECUTE FUNCTION immutable_export_approval();
