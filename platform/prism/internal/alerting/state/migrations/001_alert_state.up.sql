CREATE TABLE IF NOT EXISTS alerting_schema_migrations (
    version INT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alert_state (
    tenant_id   TEXT NOT NULL,
    fingerprint BIGINT NOT NULL,
    rule_id     UUID,
    labels      JSONB NOT NULL,
    state       SMALLINT NOT NULL,
    active_at   TIMESTAMPTZ,
    fired_at    TIMESTAMPTZ,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, fingerprint)
);
