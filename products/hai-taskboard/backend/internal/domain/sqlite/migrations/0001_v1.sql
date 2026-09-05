CREATE TABLE instance_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    restore_generation INTEGER NOT NULL CHECK (restore_generation >= 1),
    stream_epoch INTEGER NOT NULL CHECK (stream_epoch >= 1),
    next_event_sequence INTEGER NOT NULL CHECK (next_event_sequence >= 0),
    schema_version INTEGER NOT NULL CHECK (schema_version >= 1)
);
INSERT INTO instance_state (id, restore_generation, stream_epoch, next_event_sequence, schema_version)
VALUES (1, 1, 1, 0, 1);

CREATE TABLE projects (
    project_id TEXT PRIMARY KEY NOT NULL,
    canonical_name TEXT NOT NULL UNIQUE CHECK (length(canonical_name) > 0),
    repository TEXT NOT NULL CHECK (length(repository) > 0),
    repository_ref TEXT NOT NULL CHECK (length(repository_ref) > 0),
    version INTEGER NOT NULL CHECK (version > 0)
);
CREATE TABLE work_items (
    project_id TEXT NOT NULL,
    work_item_id TEXT NOT NULL,
    title TEXT NOT NULL CHECK (length(title) > 0),
    goal TEXT NOT NULL CHECK (length(goal) > 0),
    owner_id TEXT NOT NULL CHECK (length(owner_id) > 0),
    phase TEXT NOT NULL CHECK (phase IN ('Draft','Ready','Developing','Review','QA','Done','Canceled')),
    version INTEGER NOT NULL CHECK (version > 0),
    PRIMARY KEY (project_id, work_item_id),
    FOREIGN KEY (project_id) REFERENCES projects(project_id)
);
CREATE TABLE work_item_blockers (
    project_id TEXT NOT NULL,
    work_item_id TEXT NOT NULL,
    blocker_id TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (length(reason) > 0),
    resolved_at_ns INTEGER,
    PRIMARY KEY (project_id, work_item_id, blocker_id),
    FOREIGN KEY (project_id, work_item_id) REFERENCES work_items(project_id, work_item_id)
);

CREATE TABLE ac_revisions (
    project_id TEXT NOT NULL,
    ac_revision_id TEXT NOT NULL,
    ac_id TEXT NOT NULL,
    revision_digest TEXT NOT NULL CHECK (length(revision_digest) = 64 AND revision_digest NOT GLOB '*[^0-9a-f]*'),
    content BLOB NOT NULL,
    created_at_ns INTEGER NOT NULL,
    PRIMARY KEY (project_id, ac_revision_id),
    UNIQUE (project_id, ac_id, revision_digest),
    FOREIGN KEY (project_id) REFERENCES projects(project_id)
);
CREATE TABLE work_item_ac_requirements (
    project_id TEXT NOT NULL,
    work_item_id TEXT NOT NULL,
    ac_id TEXT NOT NULL,
    revision_digest TEXT NOT NULL CHECK (length(revision_digest) = 64 AND revision_digest NOT GLOB '*[^0-9a-f]*'),
    PRIMARY KEY (project_id, work_item_id, ac_id, revision_digest),
    FOREIGN KEY (project_id, work_item_id) REFERENCES work_items(project_id, work_item_id),
    FOREIGN KEY (project_id, ac_id, revision_digest) REFERENCES ac_revisions(project_id, ac_id, revision_digest)
);
CREATE TABLE dependency_revisions (
    project_id TEXT NOT NULL,
    graph_revision_digest TEXT NOT NULL CHECK (length(graph_revision_digest) = 64 AND graph_revision_digest NOT GLOB '*[^0-9a-f]*'),
    content BLOB NOT NULL,
    created_at_ns INTEGER NOT NULL,
    PRIMARY KEY (project_id, graph_revision_digest),
    FOREIGN KEY (project_id) REFERENCES projects(project_id)
);
CREATE TABLE dependency_edges (
    project_id TEXT NOT NULL,
    graph_revision_digest TEXT NOT NULL CHECK (length(graph_revision_digest) = 64 AND graph_revision_digest NOT GLOB '*[^0-9a-f]*'),
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('specifies','depends_on','verifies','produces')),
    PRIMARY KEY (project_id, graph_revision_digest, from_id, to_id, kind),
    FOREIGN KEY (project_id, graph_revision_digest) REFERENCES dependency_revisions(project_id, graph_revision_digest)
);

CREATE TABLE runs (
    project_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    work_item_id TEXT NOT NULL,
    input_digest TEXT NOT NULL CHECK (length(input_digest) = 64 AND input_digest NOT GLOB '*[^0-9a-f]*'),
    adapter_id TEXT NOT NULL CHECK (length(adapter_id) > 0),
    adapter_version TEXT NOT NULL CHECK (length(adapter_version) > 0),
    scenario_id TEXT NOT NULL CHECK (length(scenario_id) > 0),
    attempt INTEGER NOT NULL CHECK (attempt > 0),
    desired_action TEXT NOT NULL CHECK (desired_action IN ('None','Dispatch','CancelRequested')),
    dispatch_state TEXT NOT NULL CHECK (dispatch_state IN ('Pending','Claimed','Sent','Acknowledged','FailedToDispatch')),
    observed_state TEXT NOT NULL CHECK (observed_state IN ('Unknown','Starting','Running','Succeeded','Failed','Canceled')),
    reconciliation_state TEXT NOT NULL CHECK (reconciliation_state IN ('None','NeedsReconcile','Reconciled')),
    side_effect_outcome TEXT NOT NULL CHECK (side_effect_outcome IN ('NotApplicable','Confirmed','OutcomeUnknown')),
    created_at_ns INTEGER NOT NULL,
    PRIMARY KEY (project_id, run_id),
    FOREIGN KEY (project_id, work_item_id) REFERENCES work_items(project_id, work_item_id)
);
CREATE TABLE run_leases (
    project_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    epoch INTEGER NOT NULL CHECK (epoch >= 0),
    holder TEXT,
    deadline_ns INTEGER,
    CHECK ((holder IS NULL AND deadline_ns IS NULL) OR (holder IS NOT NULL AND deadline_ns IS NOT NULL)),
    PRIMARY KEY (project_id, run_id),
    FOREIGN KEY (project_id, run_id) REFERENCES runs(project_id, run_id)
);
CREATE TABLE candidates (
    project_id TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    candidate_digest TEXT NOT NULL CHECK (length(candidate_digest) = 64 AND candidate_digest NOT GLOB '*[^0-9a-f]*'),
    input_subject_digest TEXT NOT NULL CHECK (length(input_subject_digest) = 64 AND input_subject_digest NOT GLOB '*[^0-9a-f]*'),
    created_at_ns INTEGER NOT NULL,
    PRIMARY KEY (project_id, candidate_id),
    UNIQUE (project_id, run_id, candidate_digest),
    FOREIGN KEY (project_id, run_id) REFERENCES runs(project_id, run_id)
);
CREATE TABLE artifacts (
    digest TEXT PRIMARY KEY NOT NULL CHECK (length(digest) = 64 AND digest NOT GLOB '*[^0-9a-f]*'),
    media_type TEXT NOT NULL CHECK (length(media_type) > 0),
    byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
    storage_key TEXT NOT NULL CHECK (length(storage_key) > 0),
    availability TEXT NOT NULL CHECK (availability IN ('Present','Missing','Quarantined'))
);
CREATE TABLE candidate_artifacts (
    project_id TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    artifact_digest TEXT NOT NULL CHECK (length(artifact_digest) = 64 AND artifact_digest NOT GLOB '*[^0-9a-f]*'),
    PRIMARY KEY (project_id, candidate_id, artifact_digest),
    FOREIGN KEY (project_id, candidate_id) REFERENCES candidates(project_id, candidate_id),
    FOREIGN KEY (artifact_digest) REFERENCES artifacts(digest)
);
CREATE TABLE reviews (
    project_id TEXT NOT NULL,
    review_id TEXT NOT NULL,
    completion_subject_digest TEXT NOT NULL CHECK (length(completion_subject_digest) = 64 AND completion_subject_digest NOT GLOB '*[^0-9a-f]*'),
    verdict TEXT NOT NULL CHECK (verdict IN ('Approved','Rejected')),
    reviewer_id TEXT NOT NULL CHECK (length(reviewer_id) > 0),
    independent INTEGER NOT NULL CHECK (independent IN (0,1)),
    created_at_ns INTEGER NOT NULL,
    PRIMARY KEY (project_id, review_id),
    FOREIGN KEY (project_id) REFERENCES projects(project_id)
);
CREATE TABLE evidence (
    project_id TEXT NOT NULL,
    evidence_id TEXT NOT NULL,
    completion_subject_digest TEXT NOT NULL CHECK (length(completion_subject_digest) = 64 AND completion_subject_digest NOT GLOB '*[^0-9a-f]*'),
    ac_id TEXT NOT NULL,
    ac_revision_digest TEXT NOT NULL CHECK (length(ac_revision_digest) = 64 AND ac_revision_digest NOT GLOB '*[^0-9a-f]*'),
    verdict TEXT NOT NULL CHECK (verdict IN ('Passed','Failed','Skipped','NotRun','Unknown','Error','Inconclusive')),
    applicability TEXT NOT NULL CHECK (applicability IN ('Current','Stale','Superseded')),
    availability TEXT NOT NULL CHECK (availability IN ('Present','Unavailable')),
    verifier_class TEXT NOT NULL CHECK (length(verifier_class) > 0),
    verifier_actor TEXT NOT NULL CHECK (length(verifier_actor) > 0),
    verifier_role TEXT NOT NULL CHECK (length(verifier_role) > 0),
    recipe_digest TEXT NOT NULL CHECK (length(recipe_digest) = 64 AND recipe_digest NOT GLOB '*[^0-9a-f]*'),
    environment_digest TEXT NOT NULL CHECK (length(environment_digest) = 64 AND environment_digest NOT GLOB '*[^0-9a-f]*'),
    artifact_digest TEXT CHECK (artifact_digest IS NULL OR (length(artifact_digest) = 64 AND artifact_digest NOT GLOB '*[^0-9a-f]*')),
    PRIMARY KEY (project_id, evidence_id),
    FOREIGN KEY (project_id, ac_id, ac_revision_digest) REFERENCES ac_revisions(project_id, ac_id, revision_digest),
    FOREIGN KEY (artifact_digest) REFERENCES artifacts(digest)
);
CREATE TABLE approvals (
    project_id TEXT NOT NULL,
    approval_id TEXT NOT NULL,
    completion_subject_digest TEXT NOT NULL CHECK (length(completion_subject_digest) = 64 AND completion_subject_digest NOT GLOB '*[^0-9a-f]*'),
    command_kind TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    expires_at_ns INTEGER NOT NULL,
    PRIMARY KEY (project_id, approval_id),
    FOREIGN KEY (project_id) REFERENCES projects(project_id)
);

CREATE TABLE command_results (
    project_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    result_digest TEXT NOT NULL CHECK (length(result_digest) = 64 AND result_digest NOT GLOB '*[^0-9a-f]*'),
    result_payload BLOB NOT NULL CHECK (length(result_payload) > 0),
    created_at_ns INTEGER NOT NULL,
    PRIMARY KEY (project_id, command_id),
    FOREIGN KEY (project_id) REFERENCES projects(project_id)
);
CREATE TABLE approval_consumptions (
    project_id TEXT NOT NULL,
    approval_consumption_id TEXT NOT NULL,
    completion_record_id TEXT NOT NULL,
    approval_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    completion_subject_digest TEXT NOT NULL CHECK (length(completion_subject_digest) = 64 AND completion_subject_digest NOT GLOB '*[^0-9a-f]*'),
    consuming_actor TEXT NOT NULL,
    consumed_at_ns INTEGER NOT NULL,
    PRIMARY KEY (project_id, approval_consumption_id),
    UNIQUE (project_id, approval_id),
    FOREIGN KEY (project_id, completion_record_id) REFERENCES completion_records(project_id, completion_record_id),
    FOREIGN KEY (project_id, approval_id) REFERENCES approvals(project_id, approval_id),
    FOREIGN KEY (project_id, command_id) REFERENCES command_results(project_id, command_id)
);

CREATE TABLE completion_records (
    project_id TEXT NOT NULL,
    completion_record_id TEXT NOT NULL,
    work_item_id TEXT NOT NULL,
    result_work_item_version INTEGER NOT NULL CHECK (result_work_item_version > 0),
    completion_subject_digest TEXT NOT NULL CHECK (length(completion_subject_digest) = 64 AND completion_subject_digest NOT GLOB '*[^0-9a-f]*'),
    completed_by_actor TEXT NOT NULL,
    completed_at_ns INTEGER NOT NULL,
    evidence_count INTEGER NOT NULL CHECK (evidence_count > 0),
    review_count INTEGER NOT NULL CHECK (review_count > 0),
    approval_count INTEGER NOT NULL CHECK (approval_count >= 0),
    PRIMARY KEY (project_id, completion_record_id),
    UNIQUE (project_id, work_item_id, result_work_item_version),
    FOREIGN KEY (project_id, work_item_id) REFERENCES work_items(project_id, work_item_id)
);
CREATE TABLE completion_record_evidence (
    project_id TEXT NOT NULL,
    completion_record_id TEXT NOT NULL,
    evidence_id TEXT NOT NULL,
    PRIMARY KEY (project_id, completion_record_id, evidence_id),
    FOREIGN KEY (project_id, completion_record_id) REFERENCES completion_records(project_id, completion_record_id),
    FOREIGN KEY (project_id, evidence_id) REFERENCES evidence(project_id, evidence_id)
);
CREATE TABLE completion_record_reviews (
    project_id TEXT NOT NULL,
    completion_record_id TEXT NOT NULL,
    review_id TEXT NOT NULL,
    PRIMARY KEY (project_id, completion_record_id, review_id),
    FOREIGN KEY (project_id, completion_record_id) REFERENCES completion_records(project_id, completion_record_id),
    FOREIGN KEY (project_id, review_id) REFERENCES reviews(project_id, review_id)
);
CREATE TABLE completion_record_approvals (
    project_id TEXT NOT NULL,
    completion_record_id TEXT NOT NULL,
    approval_id TEXT NOT NULL,
    PRIMARY KEY (project_id, completion_record_id, approval_id),
    FOREIGN KEY (project_id, completion_record_id) REFERENCES completion_records(project_id, completion_record_id),
    FOREIGN KEY (project_id, approval_id) REFERENCES approvals(project_id, approval_id)
);

CREATE TABLE idempotency_records (
    principal_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    canonical_request_digest TEXT NOT NULL CHECK (length(canonical_request_digest) = 64 AND canonical_request_digest NOT GLOB '*[^0-9a-f]*'),
    result_command_id TEXT NOT NULL,
    expires_at_ns INTEGER NOT NULL,
    tombstoned INTEGER NOT NULL CHECK (tombstoned IN (0,1)),
    PRIMARY KEY (principal_id, project_id, operation, idempotency_key),
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    FOREIGN KEY (project_id, result_command_id) REFERENCES command_results(project_id, command_id)
);
CREATE TABLE audit_groups (
    project_id TEXT NOT NULL,
    audit_group_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    created_at_ns INTEGER NOT NULL,
    PRIMARY KEY (project_id, audit_group_id),
    FOREIGN KEY (project_id, command_id) REFERENCES command_results(project_id, command_id)
);
CREATE TABLE audit_entries (
    audit_sequence INTEGER PRIMARY KEY NOT NULL CHECK (audit_sequence > 0),
    project_id TEXT NOT NULL,
    audit_group_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    subject_digest TEXT NOT NULL CHECK (length(subject_digest) = 64 AND subject_digest NOT GLOB '*[^0-9a-f]*'),
    before_digest TEXT CHECK (before_digest IS NULL OR (length(before_digest) = 64 AND before_digest NOT GLOB '*[^0-9a-f]*')),
    after_digest TEXT CHECK (after_digest IS NULL OR (length(after_digest) = 64 AND after_digest NOT GLOB '*[^0-9a-f]*')),
    UNIQUE (project_id, audit_sequence),
    FOREIGN KEY (project_id, audit_group_id) REFERENCES audit_groups(project_id, audit_group_id)
);
CREATE TABLE outbox (
    project_id TEXT NOT NULL,
    intent_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    audit_group_id TEXT NOT NULL,
    run_id TEXT,
    payload_digest TEXT NOT NULL CHECK (length(payload_digest) = 64 AND payload_digest NOT GLOB '*[^0-9a-f]*'),
    state TEXT NOT NULL CHECK (state IN ('Pending','Claimed','Sent','Acknowledged','FailedToDispatch')),
    claim_epoch INTEGER NOT NULL CHECK (claim_epoch >= 0),
    created_at_ns INTEGER NOT NULL,
    claimed_at_ns INTEGER,
    PRIMARY KEY (project_id, intent_id),
    FOREIGN KEY (project_id, command_id) REFERENCES command_results(project_id, command_id),
    FOREIGN KEY (project_id, audit_group_id) REFERENCES audit_groups(project_id, audit_group_id),
    FOREIGN KEY (project_id, run_id) REFERENCES runs(project_id, run_id)
);
CREATE TABLE projection_events (
    stream_epoch INTEGER NOT NULL CHECK (stream_epoch >= 1),
    event_sequence INTEGER NOT NULL CHECK (event_sequence > 0),
    project_id TEXT NOT NULL,
    payload_digest TEXT NOT NULL CHECK (length(payload_digest) = 64 AND payload_digest NOT GLOB '*[^0-9a-f]*'),
    payload BLOB NOT NULL,
    audit_sequence INTEGER NOT NULL,
    PRIMARY KEY (stream_epoch, event_sequence),
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    FOREIGN KEY (project_id, audit_sequence) REFERENCES audit_entries(project_id, audit_sequence)
);
CREATE TABLE stream_retention (
    project_id TEXT NOT NULL,
    stream_epoch INTEGER NOT NULL CHECK (stream_epoch >= 1),
    minimum_retained_sequence INTEGER NOT NULL CHECK (minimum_retained_sequence >= 0),
    PRIMARY KEY (project_id, stream_epoch),
    FOREIGN KEY (project_id) REFERENCES projects(project_id)
);

CREATE TRIGGER work_items_done_requires_completion
BEFORE UPDATE OF phase, version ON work_items
WHEN NEW.phase = 'Done' AND NOT EXISTS (
    SELECT 1 FROM completion_records
    WHERE project_id = NEW.project_id
      AND work_item_id = NEW.work_item_id
      AND result_work_item_version = NEW.version
      AND completion_subject_digest <> ''
)
BEGIN SELECT RAISE(ABORT, 'completion_record_required'); END;

CREATE TRIGGER schema_migrations_immutable_update BEFORE UPDATE ON schema_migrations BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER schema_migrations_immutable_delete BEFORE DELETE ON schema_migrations BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER ac_revisions_immutable_update BEFORE UPDATE ON ac_revisions BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER ac_revisions_immutable_delete BEFORE DELETE ON ac_revisions BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER work_item_ac_requirements_immutable_update BEFORE UPDATE ON work_item_ac_requirements BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER work_item_ac_requirements_immutable_delete BEFORE DELETE ON work_item_ac_requirements BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER dependency_revisions_immutable_update BEFORE UPDATE ON dependency_revisions BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER dependency_revisions_immutable_delete BEFORE DELETE ON dependency_revisions BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER dependency_edges_immutable_update BEFORE UPDATE ON dependency_edges BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER dependency_edges_immutable_delete BEFORE DELETE ON dependency_edges BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER candidates_immutable_update BEFORE UPDATE ON candidates BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER candidates_immutable_delete BEFORE DELETE ON candidates BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER candidate_artifacts_immutable_update BEFORE UPDATE ON candidate_artifacts BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER candidate_artifacts_immutable_delete BEFORE DELETE ON candidate_artifacts BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER reviews_immutable_update BEFORE UPDATE ON reviews BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER reviews_immutable_delete BEFORE DELETE ON reviews BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER evidence_immutable_update BEFORE UPDATE ON evidence BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER evidence_immutable_delete BEFORE DELETE ON evidence BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER approvals_immutable_update BEFORE UPDATE ON approvals BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER approvals_immutable_delete BEFORE DELETE ON approvals BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER approval_consumptions_immutable_update BEFORE UPDATE ON approval_consumptions BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER approval_consumptions_immutable_delete BEFORE DELETE ON approval_consumptions BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER completion_records_immutable_update BEFORE UPDATE ON completion_records BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER completion_records_immutable_delete BEFORE DELETE ON completion_records BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER completion_record_evidence_immutable_update BEFORE UPDATE ON completion_record_evidence BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER completion_record_evidence_immutable_delete BEFORE DELETE ON completion_record_evidence BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER completion_record_reviews_immutable_update BEFORE UPDATE ON completion_record_reviews BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER completion_record_reviews_immutable_delete BEFORE DELETE ON completion_record_reviews BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER completion_record_approvals_immutable_update BEFORE UPDATE ON completion_record_approvals BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER completion_record_approvals_immutable_delete BEFORE DELETE ON completion_record_approvals BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER artifacts_immutable_update BEFORE UPDATE ON artifacts BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER artifacts_immutable_delete BEFORE DELETE ON artifacts BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER audit_groups_immutable_update BEFORE UPDATE ON audit_groups BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER audit_groups_immutable_delete BEFORE DELETE ON audit_groups BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER audit_entries_immutable_update BEFORE UPDATE ON audit_entries BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER audit_entries_immutable_delete BEFORE DELETE ON audit_entries BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER command_results_immutable_update BEFORE UPDATE ON command_results BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER command_results_immutable_delete BEFORE DELETE ON command_results BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER projection_events_immutable_update BEFORE UPDATE ON projection_events BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER projection_events_immutable_delete BEFORE DELETE ON projection_events BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER runs_immutable_identity_update BEFORE UPDATE ON runs
WHEN NEW.project_id IS NOT OLD.project_id OR NEW.run_id IS NOT OLD.run_id OR NEW.work_item_id IS NOT OLD.work_item_id OR NEW.input_digest IS NOT OLD.input_digest OR NEW.adapter_id IS NOT OLD.adapter_id OR NEW.adapter_version IS NOT OLD.adapter_version OR NEW.scenario_id IS NOT OLD.scenario_id OR NEW.attempt IS NOT OLD.attempt OR NEW.created_at_ns IS NOT OLD.created_at_ns
BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER runs_immutable_delete BEFORE DELETE ON runs BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER idempotency_records_immutable_identity_update BEFORE UPDATE ON idempotency_records
WHEN NEW.principal_id IS NOT OLD.principal_id OR NEW.project_id IS NOT OLD.project_id OR NEW.operation IS NOT OLD.operation OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.canonical_request_digest IS NOT OLD.canonical_request_digest OR NEW.result_command_id IS NOT OLD.result_command_id OR NEW.expires_at_ns IS NOT OLD.expires_at_ns
BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER idempotency_records_immutable_delete BEFORE DELETE ON idempotency_records BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER outbox_immutable_identity_update BEFORE UPDATE ON outbox
WHEN NEW.project_id IS NOT OLD.project_id OR NEW.intent_id IS NOT OLD.intent_id OR NEW.command_id IS NOT OLD.command_id OR NEW.audit_group_id IS NOT OLD.audit_group_id OR NEW.run_id IS NOT OLD.run_id OR NEW.payload_digest IS NOT OLD.payload_digest OR NEW.created_at_ns IS NOT OLD.created_at_ns
BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER outbox_immutable_delete BEFORE DELETE ON outbox BEGIN SELECT RAISE(ABORT, 'immutable'); END;
