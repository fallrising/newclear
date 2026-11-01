-- BW4: audit retention setting (surface-admin §7.2, 02 BQ-03). One row; the purge job deletes events older than it.

CREATE TABLE cms_audit_settings (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    retention_days INTEGER NOT NULL CHECK (retention_days IN (30, 90, 365)),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES cms_principal (id)
);

INSERT INTO cms_audit_settings (id, retention_days) VALUES (1, 90);
