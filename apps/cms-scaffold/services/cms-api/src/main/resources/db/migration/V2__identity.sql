-- Wave B1 Identity system tables.
-- Demo types stay seeds, not DDL. Never CREATE TABLE album.

CREATE TABLE cms_principal (
    id UUID PRIMARY KEY,
    username VARCHAR(32) NOT NULL,
    display_name VARCHAR(80) NOT NULL,
    email VARCHAR(254),
    status VARCHAR(16) NOT NULL,
    failed_login_count INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT cms_principal_status_chk CHECK (status IN ('active', 'disabled', 'locked')),
    CONSTRAINT cms_principal_username_chk CHECK (username ~ '^[a-z0-9._-]{3,32}$')
);

CREATE UNIQUE INDEX cms_principal_username_ci ON cms_principal (LOWER(username));
CREATE UNIQUE INDEX cms_principal_email_ci ON cms_principal (LOWER(email)) WHERE email IS NOT NULL;

CREATE TABLE cms_credential (
    id UUID PRIMARY KEY,
    principal_id UUID NOT NULL REFERENCES cms_principal (id),
    type VARCHAR(32) NOT NULL,
    secret_hash TEXT NOT NULL,
    algo VARCHAR(32) NOT NULL,
    rotated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cms_credential_type_chk CHECK (type = 'password')
);

CREATE UNIQUE INDEX cms_credential_password_principal
    ON cms_credential (principal_id)
    WHERE type = 'password';

CREATE TABLE cms_role (
    id UUID PRIMARY KEY,
    code VARCHAR(32) NOT NULL,
    display_name VARCHAR(80) NOT NULL,
    system BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cms_role_code_uq UNIQUE (code)
);

CREATE TABLE cms_principal_role (
    principal_id UUID NOT NULL REFERENCES cms_principal (id),
    role_id UUID NOT NULL REFERENCES cms_role (id),
    content_type_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    PRIMARY KEY (principal_id, role_id)
);

CREATE TABLE cms_permission (
    id UUID PRIMARY KEY,
    role_id UUID NOT NULL REFERENCES cms_role (id),
    action VARCHAR(64) NOT NULL,
    content_type_code VARCHAR(64),
    predicate_json JSONB,
    allowed_surfaces TEXT[] NOT NULL DEFAULT ARRAY['back', 'admin']::TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX cms_permission_role_idx ON cms_permission (role_id);

CREATE TABLE cms_session (
    id UUID PRIMARY KEY,
    principal_id UUID NOT NULL REFERENCES cms_principal (id),
    token_hash BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    created_surface VARCHAR(16) NOT NULL,
    ip TEXT,
    user_agent TEXT,
    CONSTRAINT cms_session_token_hash_uq UNIQUE (token_hash)
);

CREATE INDEX cms_session_principal_idx ON cms_session (principal_id);

CREATE TABLE cms_audit_event (
    id UUID PRIMARY KEY,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_principal_id UUID REFERENCES cms_principal (id),
    category VARCHAR(32) NOT NULL,
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(64),
    target_id UUID,
    surface VARCHAR(16),
    outcome VARCHAR(16) NOT NULL,
    ip TEXT,
    detail_json JSONB
);

CREATE INDEX cms_audit_event_at_idx ON cms_audit_event (at);
CREATE INDEX cms_audit_event_actor_idx ON cms_audit_event (actor_principal_id);
