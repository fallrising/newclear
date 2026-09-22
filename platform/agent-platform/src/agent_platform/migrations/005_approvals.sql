ALTER TABLE runs ADD COLUMN require_approval boolean NOT NULL DEFAULT false;
CREATE TABLE approvals (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES runs(id),
    generation integer NOT NULL,
    action_digest text NOT NULL CHECK (action_digest ~ '^[0-9a-f]{64}$'),
    normalized_action jsonb NOT NULL,
    policy_revision text NOT NULL,
    expires_at timestamptz NOT NULL,
    decision text CHECK (decision IN ('approve','deny')),
    decided_by uuid REFERENCES operators(id),
    decided_at timestamptz,
    command_id uuid REFERENCES commands(id),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','denied','applied','expired','invalidated')),
    applied_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(run_id,generation,action_digest)
);
CREATE INDEX approvals_run ON approvals(run_id,created_at);
