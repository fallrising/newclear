-- A run's proxy policy and consumed request slots survive credential rotation/restart.
-- These tables do not release VM reservations or authorize a guest network route.
CREATE TABLE model_proxy_runs (
    run_id uuid PRIMARY KEY REFERENCES runs(id),
    policy_sha256 text NOT NULL CHECK (policy_sha256 ~ '^[a-f0-9]{64}$'),
    request_limit integer NOT NULL CHECK (request_limit BETWEEN 1 AND 100),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE model_proxy_tokens (
    token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    run_id uuid NOT NULL REFERENCES model_proxy_runs(run_id),
    generation integer NOT NULL CHECK (generation > 0),
    lease_owner uuid NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX model_proxy_one_token ON model_proxy_tokens(run_id)
    WHERE revoked_at IS NULL;
CREATE TABLE model_proxy_requests (
    run_id uuid NOT NULL REFERENCES model_proxy_runs(run_id),
    request_id uuid NOT NULL,
    generation integer NOT NULL CHECK (generation > 0),
    payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
    status text NOT NULL CHECK (status IN ('reserved','final','unknown')),
    reason text NOT NULL,
    input_tokens bigint CHECK (input_tokens >= 0),
    output_tokens bigint CHECK (output_tokens >= 0),
    -- No trusted price contract exists in this slice. Unknown is never zero money.
    amount_decimal numeric CHECK (amount_decimal >= 0),
    currency text,
    price_revision text,
    reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    settled_at timestamptz,
    PRIMARY KEY(run_id,request_id),
    CHECK ((status='final' AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL
            AND settled_at IS NOT NULL) OR
           (status<>'final' AND input_tokens IS NULL AND output_tokens IS NULL)),
    CHECK (amount_decimal IS NULL AND currency IS NULL AND price_revision IS NULL)
);
