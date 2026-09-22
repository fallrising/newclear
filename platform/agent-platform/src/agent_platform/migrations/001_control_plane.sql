CREATE TABLE operators (
    id uuid PRIMARY KEY,
    singleton boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),
    username text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
    token_hash text PRIMARY KEY,
    operator_id uuid NOT NULL REFERENCES operators(id),
    csrf_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE login_limits (
    bucket text PRIMARY KEY,
    attempts integer NOT NULL CHECK (attempts >= 0),
    window_start timestamptz NOT NULL
);
CREATE TABLE projects (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    canonical_repo text NOT NULL,
    policy_revision integer NOT NULL DEFAULT 1 CHECK (policy_revision > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agent_profile_revisions (
    id uuid PRIMARY KEY,
    profile_id uuid NOT NULL,
    revision integer NOT NULL CHECK (revision > 0),
    name text NOT NULL,
    backend text NOT NULL CHECK (backend = 'fake'),
    model_ref text NOT NULL CHECK (model_ref = 'fixture:m1'),
    template_digest text NOT NULL CHECK (template_digest = 'fixture:m1'),
    tool_policy jsonb NOT NULL,
    limits jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(profile_id, revision)
);
CREATE FUNCTION immutable_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Profile revisions are immutable'; END; $$;
CREATE TRIGGER profile_immutable BEFORE UPDATE OR DELETE ON agent_profile_revisions
    FOR EACH ROW EXECUTE FUNCTION immutable_profile();
CREATE TABLE tasks (
    id uuid PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES projects(id),
    title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    created_by uuid NOT NULL REFERENCES operators(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz
);
CREATE INDEX tasks_page ON tasks(created_at DESC,id DESC);
CREATE TABLE runs (
    id uuid PRIMARY KEY,
    task_id uuid NOT NULL REFERENCES tasks(id),
    attempt_no integer NOT NULL CHECK (attempt_no > 0),
    base_sha text NOT NULL CHECK (base_sha ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
    profile_revision uuid NOT NULL REFERENCES agent_profile_revisions(id),
    goal text NOT NULL CHECK (length(goal) BETWEEN 1 AND 20000),
    state text NOT NULL CHECK (state IN ('queued','provisioning','running','awaiting_approval',
        'pausing','paused','finalizing','cancelling','interrupted','succeeded','failed','cancelled')),
    state_version integer NOT NULL DEFAULT 1 CHECK (state_version > 0),
    generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
    last_event_seq bigint NOT NULL DEFAULT 0,
    event_floor bigint NOT NULL DEFAULT 1,
    backend_ref text,
    backend_cursor text,
    sandbox_id uuid,
    deadline timestamptz NOT NULL,
    reason text,
    result jsonb,
    cleanup_state text NOT NULL DEFAULT 'not_allocated'
        CHECK (cleanup_state IN ('not_allocated','pending','confirmed','unknown')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(task_id,attempt_no)
);
CREATE UNIQUE INDEX one_active_run_per_task ON runs(task_id)
    WHERE state NOT IN ('succeeded','failed','cancelled');
CREATE TABLE jobs (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES runs(id),
    kind text NOT NULL CHECK (kind = 'execute'),
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','leased','done','interrupted')),
    available_at timestamptz NOT NULL DEFAULT now(),
    lease_owner uuid,
    lease_until timestamptz,
    generation integer NOT NULL DEFAULT 0,
    attempts integer NOT NULL DEFAULT 0,
    UNIQUE(run_id,kind,generation)
);
CREATE INDEX jobs_admission ON jobs(available_at,id) WHERE status='queued';
CREATE TABLE commands (
    id uuid PRIMARY KEY,
    operator_id uuid NOT NULL REFERENCES operators(id),
    route text NOT NULL,
    idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
    payload_hash text NOT NULL,
    run_id uuid REFERENCES runs(id),
    expected_version integer,
    status text NOT NULL CHECK (status IN ('pending','completed')),
    result jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(operator_id,route,idempotency_key)
);
CREATE TABLE run_events (
    run_id uuid NOT NULL REFERENCES runs(id),
    seq bigint NOT NULL CHECK (seq > 0),
    event_id uuid NOT NULL UNIQUE,
    source text NOT NULL,
    source_event_id text NOT NULL,
    type text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(run_id,seq),
    UNIQUE(run_id,source,source_event_id)
);
CREATE TABLE run_messages (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES runs(id),
    role text NOT NULL CHECK (role IN ('user','assistant')),
    content text NOT NULL,
    command_id uuid REFERENCES commands(id),
    backend_message_id text,
    UNIQUE(run_id,command_id),
    UNIQUE(run_id,backend_message_id)
);
CREATE TABLE sandbox_bindings (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL UNIQUE REFERENCES runs(id),
    node_id text NOT NULL CHECK (node_id = 'fake-local'),
    provider_handle text NOT NULL UNIQUE,
    generation integer NOT NULL,
    desired_state text NOT NULL,
    observed_state text NOT NULL,
    lease_deadline timestamptz NOT NULL,
    last_seen timestamptz NOT NULL DEFAULT now(),
    cleanup_state text NOT NULL CHECK (cleanup_state IN ('pending','confirmed','unknown'))
);
ALTER TABLE runs ADD CONSTRAINT run_sandbox_fk FOREIGN KEY(sandbox_id) REFERENCES sandbox_bindings(id);
CREATE TABLE resource_reservations (
    sandbox_id uuid PRIMARY KEY REFERENCES sandbox_bindings(id),
    cpu integer NOT NULL CHECK (cpu > 0),
    memory_bytes bigint NOT NULL CHECK (memory_bytes > 0),
    disk_bytes bigint NOT NULL CHECK (disk_bytes > 0),
    released_at timestamptz
);
CREATE TABLE runtime_capacity (
    node_id text PRIMARY KEY CHECK (node_id = 'fake-local'),
    slots integer NOT NULL CHECK (slots BETWEEN 1 AND 4),
    draining boolean NOT NULL DEFAULT false
);
INSERT INTO runtime_capacity(node_id,slots) VALUES ('fake-local',4);
CREATE TABLE adapter_operations (
    operation_id text PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES runs(id),
    kind text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_events (
    id uuid PRIMARY KEY,
    actor uuid REFERENCES operators(id),
    action text NOT NULL,
    target text,
    decision text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
