-- TB-1 is opt-in, control-side mock only. No existing run is granted a capability.
-- Resource names, payloads, results and service secrets never enter this ledger.
CREATE TABLE tool_broker_services (
    service_id uuid PRIMARY KEY,
    config_sha256 text NOT NULL CHECK (config_sha256 ~ '^[a-f0-9]{64}$'),
    credential_revision uuid NOT NULL,
    revoked_at timestamptz
);
CREATE TABLE tool_broker_runs (
    run_id uuid PRIMARY KEY REFERENCES runs(id),
    service_id uuid NOT NULL REFERENCES tool_broker_services(service_id),
    policy_sha256 text NOT NULL CHECK (policy_sha256 ~ '^[a-f0-9]{64}$'),
    binding_id uuid NOT NULL REFERENCES sandbox_bindings(id),
    generation integer NOT NULL CHECK (generation > 0),
    lease_owner uuid NOT NULL,
    expires_at timestamptz NOT NULL,
    request_limit integer NOT NULL CHECK (request_limit BETWEEN 1 AND 100),
    in_flight_limit integer NOT NULL CHECK (in_flight_limit BETWEEN 1 AND 2),
    revoked_at timestamptz
);
CREATE TABLE tool_broker_tokens (
    token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    run_id uuid NOT NULL REFERENCES tool_broker_runs(run_id),
    generation integer NOT NULL,
    binding_id uuid NOT NULL,
    lease_owner uuid NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz
);
CREATE UNIQUE INDEX tool_broker_one_token ON tool_broker_tokens(run_id)
    WHERE revoked_at IS NULL;
CREATE TABLE tool_broker_operations (
    run_id uuid NOT NULL REFERENCES tool_broker_runs(run_id),
    operation_id uuid NOT NULL,
    generation integer NOT NULL,
    binding_id uuid NOT NULL,
    policy_sha256 text NOT NULL CHECK (policy_sha256 ~ '^[a-f0-9]{64}$'),
    payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
    operation text NOT NULL CHECK (operation IN
        ('github.repository.get','github.issue.get','github.file.get')),
    status text NOT NULL CHECK (status IN ('admitted','succeeded','unknown')),
    reason text NOT NULL,
    delivery text NOT NULL CHECK (delivery IN ('none','pending','acknowledged','unknown','withheld')),
    receipt_hash text CHECK (receipt_hash ~ '^[a-f0-9]{64}$'),
    http_calls integer NOT NULL DEFAULT 0 CHECK (http_calls BETWEEN 0 AND 8),
    response_bytes integer CHECK (response_bytes BETWEEN 0 AND 1048576),
    admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    deadline_at timestamptz NOT NULL,
    settled_at timestamptz,
    PRIMARY KEY (run_id,operation_id)
);
