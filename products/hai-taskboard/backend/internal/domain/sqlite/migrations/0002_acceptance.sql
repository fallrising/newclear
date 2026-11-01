-- Schema-only acceptance storage. No application rows or accepted heads are inferred.

CREATE TABLE repository_binding_versions (
    project_id TEXT NOT NULL CHECK (length(project_id) > 0),
    repository_binding_id TEXT NOT NULL CHECK (length(repository_binding_id) > 0),
    binding_version INTEGER NOT NULL CHECK (binding_version > 0),
    binding_digest TEXT NOT NULL CHECK (length(binding_digest) = 64 AND binding_digest NOT GLOB '*[^0-9a-f]*'),
    object_format TEXT NOT NULL CHECK (object_format IN ('sha1','sha256')),
    binding_content BLOB NOT NULL CHECK (length(binding_content) > 0),
    approved_by_actor TEXT NOT NULL CHECK (length(approved_by_actor) > 0),
    created_at_ns INTEGER NOT NULL,
    PRIMARY KEY (project_id, repository_binding_id, binding_version),
    UNIQUE (project_id, repository_binding_id, binding_version, object_format),
    FOREIGN KEY (project_id) REFERENCES projects(project_id)
) STRICT;

CREATE TABLE specification_proposals (
    project_id TEXT NOT NULL CHECK (length(project_id) > 0),
    proposal_digest TEXT NOT NULL CHECK (length(proposal_digest) = 64 AND proposal_digest NOT GLOB '*[^0-9a-f]*'),
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    repository_binding_id TEXT NOT NULL CHECK (length(repository_binding_id) > 0),
    binding_version INTEGER NOT NULL CHECK (binding_version > 0),
    object_format TEXT NOT NULL CHECK (object_format IN ('sha1','sha256')),
    commit_oid TEXT NOT NULL CHECK (commit_oid NOT GLOB '*[^0-9a-f]*' AND ((object_format = 'sha1' AND length(commit_oid) = 40) OR (object_format = 'sha256' AND length(commit_oid) = 64))),
    manifest_path TEXT NOT NULL CHECK (length(manifest_path) > 0),
    manifest_blob_oid TEXT NOT NULL CHECK (manifest_blob_oid NOT GLOB '*[^0-9a-f]*' AND ((object_format = 'sha1' AND length(manifest_blob_oid) = 40) OR (object_format = 'sha256' AND length(manifest_blob_oid) = 64))),
    manifest_digest TEXT NOT NULL CHECK (length(manifest_digest) = 64 AND manifest_digest NOT GLOB '*[^0-9a-f]*'),
    graph_revision_digest TEXT NOT NULL CHECK (length(graph_revision_digest) = 64 AND graph_revision_digest NOT GLOB '*[^0-9a-f]*'),
    canonical_content BLOB NOT NULL CHECK (length(canonical_content) > 0),
    created_at_ns INTEGER NOT NULL,
    PRIMARY KEY (project_id, proposal_digest),
    UNIQUE (project_id, proposal_digest, repository_binding_id, binding_version),
    UNIQUE (project_id, proposal_digest, graph_revision_digest),
    FOREIGN KEY (project_id, repository_binding_id, binding_version, object_format) REFERENCES repository_binding_versions(project_id, repository_binding_id, binding_version, object_format),
    FOREIGN KEY (project_id, graph_revision_digest) REFERENCES dependency_revisions(project_id, graph_revision_digest)
) STRICT;

CREATE TABLE accepted_spec_revisions (
    project_id TEXT NOT NULL CHECK (length(project_id) > 0),
    accepted_revision_digest TEXT NOT NULL CHECK (length(accepted_revision_digest) = 64 AND accepted_revision_digest NOT GLOB '*[^0-9a-f]*'),
    proposal_digest TEXT NOT NULL CHECK (length(proposal_digest) = 64 AND proposal_digest NOT GLOB '*[^0-9a-f]*'),
    graph_revision_digest TEXT NOT NULL CHECK (length(graph_revision_digest) = 64 AND graph_revision_digest NOT GLOB '*[^0-9a-f]*'),
    normative_binding_digest TEXT NOT NULL CHECK (length(normative_binding_digest) = 64 AND normative_binding_digest NOT GLOB '*[^0-9a-f]*'),
    policy_revision_digest TEXT NOT NULL CHECK (length(policy_revision_digest) = 64 AND policy_revision_digest NOT GLOB '*[^0-9a-f]*'),
    acceptance_subject_digest TEXT NOT NULL CHECK (length(acceptance_subject_digest) = 64 AND acceptance_subject_digest NOT GLOB '*[^0-9a-f]*'),
    canonical_content BLOB NOT NULL CHECK (length(canonical_content) > 0),
    acceptance_kind TEXT NOT NULL CHECK (acceptance_kind IN ('Initial','Impact')),
    base_accepted_revision_digest TEXT CHECK (base_accepted_revision_digest IS NULL OR (length(base_accepted_revision_digest) = 64 AND base_accepted_revision_digest NOT GLOB '*[^0-9a-f]*')),
    impact_plan_digest TEXT CHECK (impact_plan_digest IS NULL OR (length(impact_plan_digest) = 64 AND impact_plan_digest NOT GLOB '*[^0-9a-f]*')),
    activation_decision_digest TEXT CHECK (activation_decision_digest IS NULL OR (length(activation_decision_digest) = 64 AND activation_decision_digest NOT GLOB '*[^0-9a-f]*')),
    decision_value TEXT CHECK (decision_value IS NULL OR (decision_value IN ('Approve','Reject'))),
    accepted_by_actor TEXT NOT NULL CHECK (length(accepted_by_actor) > 0),
    created_at_ns INTEGER NOT NULL,
    PRIMARY KEY (project_id, accepted_revision_digest),
    UNIQUE (project_id, accepted_revision_digest, graph_revision_digest),
    FOREIGN KEY (project_id, proposal_digest, graph_revision_digest) REFERENCES specification_proposals(project_id, proposal_digest, graph_revision_digest),
    FOREIGN KEY (project_id, base_accepted_revision_digest) REFERENCES accepted_spec_revisions(project_id, accepted_revision_digest),
    FOREIGN KEY (project_id, impact_plan_digest, proposal_digest, base_accepted_revision_digest) REFERENCES specification_impact_plans(project_id, plan_digest, proposal_digest, base_accepted_revision_digest),
    FOREIGN KEY (project_id, activation_decision_digest, impact_plan_digest, proposal_digest, base_accepted_revision_digest, decision_value) REFERENCES specification_activation_decisions(project_id, decision_digest, plan_digest, proposal_digest, base_accepted_revision_digest, decision_value),
    CHECK ((acceptance_kind = 'Initial' AND base_accepted_revision_digest IS NULL AND impact_plan_digest IS NULL AND activation_decision_digest IS NULL AND decision_value IS NULL) OR (acceptance_kind = 'Impact' AND base_accepted_revision_digest IS NOT NULL AND impact_plan_digest IS NOT NULL AND activation_decision_digest IS NOT NULL AND decision_value IS NOT NULL AND decision_value = 'Approve'))
) STRICT;

CREATE TABLE accepted_revision_acs (
    project_id TEXT NOT NULL CHECK (length(project_id) > 0),
    accepted_revision_digest TEXT NOT NULL CHECK (length(accepted_revision_digest) = 64 AND accepted_revision_digest NOT GLOB '*[^0-9a-f]*'),
    ac_id TEXT NOT NULL CHECK (length(ac_id) > 0),
    ac_revision_digest TEXT NOT NULL CHECK (length(ac_revision_digest) = 64 AND ac_revision_digest NOT GLOB '*[^0-9a-f]*'),
    PRIMARY KEY (project_id, accepted_revision_digest, ac_id),
    UNIQUE (project_id, accepted_revision_digest, ac_id, ac_revision_digest),
    FOREIGN KEY (project_id, accepted_revision_digest) REFERENCES accepted_spec_revisions(project_id, accepted_revision_digest),
    FOREIGN KEY (project_id, ac_id, ac_revision_digest) REFERENCES ac_revisions(project_id, ac_id, revision_digest)
) STRICT;

CREATE TABLE accepted_work_item_bindings (
    project_id TEXT NOT NULL CHECK (length(project_id) > 0),
    accepted_revision_digest TEXT NOT NULL CHECK (length(accepted_revision_digest) = 64 AND accepted_revision_digest NOT GLOB '*[^0-9a-f]*'),
    work_item_id TEXT NOT NULL CHECK (length(work_item_id) > 0),
    binding_digest TEXT NOT NULL CHECK (length(binding_digest) = 64 AND binding_digest NOT GLOB '*[^0-9a-f]*'),
    canonical_content BLOB NOT NULL CHECK (length(canonical_content) > 0),
    PRIMARY KEY (project_id, accepted_revision_digest, work_item_id),
    UNIQUE (project_id, accepted_revision_digest, work_item_id, binding_digest),
    FOREIGN KEY (project_id, accepted_revision_digest) REFERENCES accepted_spec_revisions(project_id, accepted_revision_digest),
    FOREIGN KEY (project_id, work_item_id) REFERENCES work_items(project_id, work_item_id)
) STRICT;

CREATE TABLE accepted_work_item_requirements (
    project_id TEXT NOT NULL CHECK (length(project_id) > 0),
    accepted_revision_digest TEXT NOT NULL CHECK (length(accepted_revision_digest) = 64 AND accepted_revision_digest NOT GLOB '*[^0-9a-f]*'),
    work_item_id TEXT NOT NULL CHECK (length(work_item_id) > 0),
    binding_digest TEXT NOT NULL CHECK (length(binding_digest) = 64 AND binding_digest NOT GLOB '*[^0-9a-f]*'),
    ac_id TEXT NOT NULL CHECK (length(ac_id) > 0),
    ac_revision_digest TEXT NOT NULL CHECK (length(ac_revision_digest) = 64 AND ac_revision_digest NOT GLOB '*[^0-9a-f]*'),
    PRIMARY KEY (project_id, accepted_revision_digest, work_item_id, ac_id),
    UNIQUE (project_id, accepted_revision_digest, work_item_id, binding_digest, ac_id, ac_revision_digest),
    FOREIGN KEY (project_id, accepted_revision_digest, work_item_id, binding_digest) REFERENCES accepted_work_item_bindings(project_id, accepted_revision_digest, work_item_id, binding_digest),
    FOREIGN KEY (project_id, accepted_revision_digest, ac_id, ac_revision_digest) REFERENCES accepted_revision_acs(project_id, accepted_revision_digest, ac_id, ac_revision_digest)
) STRICT;

CREATE TABLE project_spec_heads (
    project_id TEXT NOT NULL CHECK (length(project_id) > 0),
    accepted_revision_digest TEXT NOT NULL CHECK (length(accepted_revision_digest) = 64 AND accepted_revision_digest NOT GLOB '*[^0-9a-f]*'),
    head_version INTEGER NOT NULL CHECK (head_version > 0),
    PRIMARY KEY (project_id),
    UNIQUE (project_id, accepted_revision_digest),
    FOREIGN KEY (project_id, accepted_revision_digest) REFERENCES accepted_spec_revisions(project_id, accepted_revision_digest)
) STRICT;

CREATE TABLE work_item_spec_heads (
    project_id TEXT NOT NULL CHECK (length(project_id) > 0),
    work_item_id TEXT NOT NULL CHECK (length(work_item_id) > 0),
    accepted_revision_digest TEXT NOT NULL CHECK (length(accepted_revision_digest) = 64 AND accepted_revision_digest NOT GLOB '*[^0-9a-f]*'),
    binding_digest TEXT NOT NULL CHECK (length(binding_digest) = 64 AND binding_digest NOT GLOB '*[^0-9a-f]*'),
    head_version INTEGER NOT NULL CHECK (head_version > 0),
    PRIMARY KEY (project_id, work_item_id),
    UNIQUE (project_id, work_item_id, accepted_revision_digest, binding_digest),
    FOREIGN KEY (project_id, work_item_id) REFERENCES work_items(project_id, work_item_id),
    FOREIGN KEY (project_id, accepted_revision_digest, work_item_id, binding_digest) REFERENCES accepted_work_item_bindings(project_id, accepted_revision_digest, work_item_id, binding_digest),
    FOREIGN KEY (project_id, accepted_revision_digest) REFERENCES project_spec_heads(project_id, accepted_revision_digest) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE current_ac_requirements (
    project_id TEXT NOT NULL CHECK (length(project_id) > 0),
    work_item_id TEXT NOT NULL CHECK (length(work_item_id) > 0),
    accepted_revision_digest TEXT NOT NULL CHECK (length(accepted_revision_digest) = 64 AND accepted_revision_digest NOT GLOB '*[^0-9a-f]*'),
    binding_digest TEXT NOT NULL CHECK (length(binding_digest) = 64 AND binding_digest NOT GLOB '*[^0-9a-f]*'),
    ac_id TEXT NOT NULL CHECK (length(ac_id) > 0),
    ac_revision_digest TEXT NOT NULL CHECK (length(ac_revision_digest) = 64 AND ac_revision_digest NOT GLOB '*[^0-9a-f]*'),
    PRIMARY KEY (project_id, work_item_id, ac_id),
    FOREIGN KEY (project_id, accepted_revision_digest, work_item_id, binding_digest, ac_id, ac_revision_digest) REFERENCES accepted_work_item_requirements(project_id, accepted_revision_digest, work_item_id, binding_digest, ac_id, ac_revision_digest),
    FOREIGN KEY (project_id, work_item_id, accepted_revision_digest, binding_digest) REFERENCES work_item_spec_heads(project_id, work_item_id, accepted_revision_digest, binding_digest) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE specification_impact_plans (
    project_id TEXT NOT NULL CHECK (length(project_id) > 0),
    plan_digest TEXT NOT NULL CHECK (length(plan_digest) = 64 AND plan_digest NOT GLOB '*[^0-9a-f]*'),
    kernel_plan_digest TEXT NOT NULL CHECK (length(kernel_plan_digest) = 64 AND kernel_plan_digest NOT GLOB '*[^0-9a-f]*'),
    proposal_digest TEXT NOT NULL CHECK (length(proposal_digest) = 64 AND proposal_digest NOT GLOB '*[^0-9a-f]*'),
    repository_binding_id TEXT NOT NULL CHECK (length(repository_binding_id) > 0),
    binding_version INTEGER NOT NULL CHECK (binding_version > 0),
    base_accepted_revision_digest TEXT NOT NULL CHECK (length(base_accepted_revision_digest) = 64 AND base_accepted_revision_digest NOT GLOB '*[^0-9a-f]*'),
    base_graph_revision_digest TEXT NOT NULL CHECK (length(base_graph_revision_digest) = 64 AND base_graph_revision_digest NOT GLOB '*[^0-9a-f]*'),
    proposed_graph_revision_digest TEXT NOT NULL CHECK (length(proposed_graph_revision_digest) = 64 AND proposed_graph_revision_digest NOT GLOB '*[^0-9a-f]*'),
    policy_revision_digest TEXT NOT NULL CHECK (length(policy_revision_digest) = 64 AND policy_revision_digest NOT GLOB '*[^0-9a-f]*'),
    read_set_digest TEXT NOT NULL CHECK (length(read_set_digest) = 64 AND read_set_digest NOT GLOB '*[^0-9a-f]*'),
    algorithm_version TEXT NOT NULL CHECK (length(algorithm_version) > 0),
    canonical_content BLOB NOT NULL CHECK (length(canonical_content) > 0),
    created_at_ns INTEGER NOT NULL,
    PRIMARY KEY (project_id, plan_digest),
    UNIQUE (project_id, plan_digest, proposal_digest, base_accepted_revision_digest),
    UNIQUE (project_id, plan_digest, proposal_digest, base_accepted_revision_digest, read_set_digest),
    FOREIGN KEY (project_id, proposal_digest, repository_binding_id, binding_version) REFERENCES specification_proposals(project_id, proposal_digest, repository_binding_id, binding_version),
    FOREIGN KEY (project_id, proposal_digest, proposed_graph_revision_digest) REFERENCES specification_proposals(project_id, proposal_digest, graph_revision_digest),
    FOREIGN KEY (project_id, base_accepted_revision_digest, base_graph_revision_digest) REFERENCES accepted_spec_revisions(project_id, accepted_revision_digest, graph_revision_digest)
) STRICT;

CREATE TABLE specification_activation_decisions (
    project_id TEXT NOT NULL CHECK (length(project_id) > 0),
    decision_digest TEXT NOT NULL CHECK (length(decision_digest) = 64 AND decision_digest NOT GLOB '*[^0-9a-f]*'),
    plan_digest TEXT NOT NULL CHECK (length(plan_digest) = 64 AND plan_digest NOT GLOB '*[^0-9a-f]*'),
    proposal_digest TEXT NOT NULL CHECK (length(proposal_digest) = 64 AND proposal_digest NOT GLOB '*[^0-9a-f]*'),
    base_accepted_revision_digest TEXT NOT NULL CHECK (length(base_accepted_revision_digest) = 64 AND base_accepted_revision_digest NOT GLOB '*[^0-9a-f]*'),
    read_set_digest TEXT NOT NULL CHECK (length(read_set_digest) = 64 AND read_set_digest NOT GLOB '*[^0-9a-f]*'),
    operation TEXT NOT NULL CHECK (operation = 'ActivateSpecificationImpact'),
    decision_value TEXT NOT NULL CHECK (decision_value IN ('Approve','Reject')),
    actor_id TEXT NOT NULL CHECK (length(actor_id) > 0),
    subject_digest TEXT NOT NULL CHECK (length(subject_digest) = 64 AND subject_digest NOT GLOB '*[^0-9a-f]*'),
    canonical_content BLOB NOT NULL CHECK (length(canonical_content) > 0),
    created_at_ns INTEGER NOT NULL,
    PRIMARY KEY (project_id, decision_digest),
    UNIQUE (project_id, decision_digest, plan_digest, proposal_digest, base_accepted_revision_digest, decision_value),
    FOREIGN KEY (project_id, plan_digest, proposal_digest, base_accepted_revision_digest, read_set_digest) REFERENCES specification_impact_plans(project_id, plan_digest, proposal_digest, base_accepted_revision_digest, read_set_digest)
) STRICT;

CREATE TRIGGER repository_binding_versions_immutable_update BEFORE UPDATE ON repository_binding_versions
BEGIN SELECT RAISE(ABORT, 'immutable'); END;

CREATE TRIGGER repository_binding_versions_immutable_delete BEFORE DELETE ON repository_binding_versions
BEGIN SELECT RAISE(ABORT, 'immutable'); END;

CREATE TRIGGER repository_binding_versions_immutable_insert BEFORE INSERT ON repository_binding_versions
WHEN EXISTS (SELECT 1 FROM repository_binding_versions WHERE (project_id IS NEW.project_id AND repository_binding_id IS NEW.repository_binding_id AND binding_version IS NEW.binding_version) OR (project_id IS NEW.project_id AND repository_binding_id IS NEW.repository_binding_id AND binding_version IS NEW.binding_version AND object_format IS NEW.object_format))
BEGIN SELECT RAISE(ABORT, 'immutable'); END;

CREATE TRIGGER specification_proposals_immutable_update BEFORE UPDATE ON specification_proposals
BEGIN SELECT RAISE(ABORT, 'immutable'); END;

CREATE TRIGGER specification_proposals_immutable_delete BEFORE DELETE ON specification_proposals
BEGIN SELECT RAISE(ABORT, 'immutable'); END;

CREATE TRIGGER specification_proposals_immutable_insert BEFORE INSERT ON specification_proposals
WHEN EXISTS (SELECT 1 FROM specification_proposals WHERE (project_id IS NEW.project_id AND proposal_digest IS NEW.proposal_digest) OR (project_id IS NEW.project_id AND proposal_digest IS NEW.proposal_digest AND repository_binding_id IS NEW.repository_binding_id AND binding_version IS NEW.binding_version) OR (project_id IS NEW.project_id AND proposal_digest IS NEW.proposal_digest AND graph_revision_digest IS NEW.graph_revision_digest))
BEGIN SELECT RAISE(ABORT, 'immutable'); END;

CREATE TRIGGER accepted_spec_revisions_immutable_update BEFORE UPDATE ON accepted_spec_revisions
BEGIN SELECT RAISE(ABORT, 'immutable'); END;

CREATE TRIGGER accepted_spec_revisions_immutable_delete BEFORE DELETE ON accepted_spec_revisions
BEGIN SELECT RAISE(ABORT, 'immutable'); END;

CREATE TRIGGER accepted_spec_revisions_immutable_insert BEFORE INSERT ON accepted_spec_revisions
WHEN EXISTS (SELECT 1 FROM accepted_spec_revisions WHERE (project_id IS NEW.project_id AND accepted_revision_digest IS NEW.accepted_revision_digest) OR (project_id IS NEW.project_id AND accepted_revision_digest IS NEW.accepted_revision_digest AND graph_revision_digest IS NEW.graph_revision_digest))
BEGIN SELECT RAISE(ABORT, 'immutable'); END;

CREATE TRIGGER accepted_revision_acs_immutable_update BEFORE UPDATE ON accepted_revision_acs
BEGIN SELECT RAISE(ABORT, 'immutable'); END;

CREATE TRIGGER accepted_revision_acs_immutable_delete BEFORE DELETE ON accepted_revision_acs
BEGIN SELECT RAISE(ABORT, 'immutable'); END;

CREATE TRIGGER accepted_revision_acs_immutable_insert BEFORE INSERT ON accepted_revision_acs
WHEN EXISTS (SELECT 1 FROM accepted_revision_acs WHERE (project_id IS NEW.project_id AND accepted_revision_digest IS NEW.accepted_revision_digest AND ac_id IS NEW.ac_id) OR (project_id IS NEW.project_id AND accepted_revision_digest IS NEW.accepted_revision_digest AND ac_id IS NEW.ac_id AND ac_revision_digest IS NEW.ac_revision_digest))
BEGIN SELECT RAISE(ABORT, 'immutable'); END;

CREATE TRIGGER accepted_work_item_bindings_immutable_update BEFORE UPDATE ON accepted_work_item_bindings
BEGIN SELECT RAISE(ABORT, 'immutable'); END;

CREATE TRIGGER accepted_work_item_bindings_immutable_delete BEFORE DELETE ON accepted_work_item_bindings
BEGIN SELECT RAISE(ABORT, 'immutable'); END;

CREATE TRIGGER accepted_work_item_bindings_immutable_insert BEFORE INSERT ON accepted_work_item_bindings
WHEN EXISTS (SELECT 1 FROM accepted_work_item_bindings WHERE (project_id IS NEW.project_id AND accepted_revision_digest IS NEW.accepted_revision_digest AND work_item_id IS NEW.work_item_id) OR (project_id IS NEW.project_id AND accepted_revision_digest IS NEW.accepted_revision_digest AND work_item_id IS NEW.work_item_id AND binding_digest IS NEW.binding_digest))
BEGIN SELECT RAISE(ABORT, 'immutable'); END;

CREATE TRIGGER accepted_work_item_requirements_immutable_update BEFORE UPDATE ON accepted_work_item_requirements
BEGIN SELECT RAISE(ABORT, 'immutable'); END;

CREATE TRIGGER accepted_work_item_requirements_immutable_delete BEFORE DELETE ON accepted_work_item_requirements
BEGIN SELECT RAISE(ABORT, 'immutable'); END;

CREATE TRIGGER accepted_work_item_requirements_immutable_insert BEFORE INSERT ON accepted_work_item_requirements
WHEN EXISTS (SELECT 1 FROM accepted_work_item_requirements WHERE (project_id IS NEW.project_id AND accepted_revision_digest IS NEW.accepted_revision_digest AND work_item_id IS NEW.work_item_id AND ac_id IS NEW.ac_id) OR (project_id IS NEW.project_id AND accepted_revision_digest IS NEW.accepted_revision_digest AND work_item_id IS NEW.work_item_id AND binding_digest IS NEW.binding_digest AND ac_id IS NEW.ac_id AND ac_revision_digest IS NEW.ac_revision_digest))
BEGIN SELECT RAISE(ABORT, 'immutable'); END;

CREATE TRIGGER specification_impact_plans_immutable_update BEFORE UPDATE ON specification_impact_plans
BEGIN SELECT RAISE(ABORT, 'immutable'); END;

CREATE TRIGGER specification_impact_plans_immutable_delete BEFORE DELETE ON specification_impact_plans
BEGIN SELECT RAISE(ABORT, 'immutable'); END;

CREATE TRIGGER specification_impact_plans_immutable_insert BEFORE INSERT ON specification_impact_plans
WHEN EXISTS (SELECT 1 FROM specification_impact_plans WHERE (project_id IS NEW.project_id AND plan_digest IS NEW.plan_digest) OR (project_id IS NEW.project_id AND plan_digest IS NEW.plan_digest AND proposal_digest IS NEW.proposal_digest AND base_accepted_revision_digest IS NEW.base_accepted_revision_digest) OR (project_id IS NEW.project_id AND plan_digest IS NEW.plan_digest AND proposal_digest IS NEW.proposal_digest AND base_accepted_revision_digest IS NEW.base_accepted_revision_digest AND read_set_digest IS NEW.read_set_digest))
BEGIN SELECT RAISE(ABORT, 'immutable'); END;

CREATE TRIGGER specification_activation_decisions_immutable_update BEFORE UPDATE ON specification_activation_decisions
BEGIN SELECT RAISE(ABORT, 'immutable'); END;

CREATE TRIGGER specification_activation_decisions_immutable_delete BEFORE DELETE ON specification_activation_decisions
BEGIN SELECT RAISE(ABORT, 'immutable'); END;

CREATE TRIGGER specification_activation_decisions_immutable_insert BEFORE INSERT ON specification_activation_decisions
WHEN EXISTS (SELECT 1 FROM specification_activation_decisions WHERE (project_id IS NEW.project_id AND decision_digest IS NEW.decision_digest) OR (project_id IS NEW.project_id AND decision_digest IS NEW.decision_digest AND plan_digest IS NEW.plan_digest AND proposal_digest IS NEW.proposal_digest AND base_accepted_revision_digest IS NEW.base_accepted_revision_digest AND decision_value IS NEW.decision_value))
BEGIN SELECT RAISE(ABORT, 'immutable'); END;
