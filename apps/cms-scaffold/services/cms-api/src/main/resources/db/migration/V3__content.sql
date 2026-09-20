-- Wave B2 Content system tables.
-- Demo types are seeds, not DDL. Never CREATE TABLE album.

CREATE TABLE cms_content_type (
    id UUID PRIMARY KEY,
    type_key VARCHAR(63) NOT NULL,
    display_name VARCHAR(80) NOT NULL,
    plural_display_name VARCHAR(80) NOT NULL,
    description TEXT,
    title_field VARCHAR(63) NOT NULL DEFAULT 'title',
    slug_policy VARCHAR(16) NOT NULL DEFAULT 'required',
    singleton BOOLEAN NOT NULL DEFAULT false,
    enabled BOOLEAN NOT NULL DEFAULT true,
    previewable BOOLEAN NOT NULL DEFAULT true,
    public_requires_published_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cms_content_type_key_uq UNIQUE (type_key),
    CONSTRAINT cms_content_type_key_chk CHECK (type_key ~ '^[a-z][a-z0-9_]{1,62}$'),
    CONSTRAINT cms_content_type_slug_policy_chk CHECK (slug_policy IN ('required', 'optional', 'none'))
);

CREATE TABLE cms_field (
    id UUID PRIMARY KEY,
    content_type_id UUID NOT NULL REFERENCES cms_content_type (id) ON DELETE CASCADE,
    field_key VARCHAR(63) NOT NULL,
    field_type VARCHAR(32) NOT NULL,
    required BOOLEAN NOT NULL DEFAULT false,
    unique_in_type BOOLEAN NOT NULL DEFAULT false,
    indexed BOOLEAN NOT NULL DEFAULT false,
    visibility VARCHAR(16) NOT NULL DEFAULT 'public',
    sort_order INT NOT NULL DEFAULT 0,
    default_value JSONB,
    validations JSONB,
    ref_target_type_key VARCHAR(63),
    on_delete VARCHAR(16) NOT NULL DEFAULT 'restrict',
    enum_values JSONB,
    help_text TEXT,
    enabled BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT cms_field_key_uq UNIQUE (content_type_id, field_key),
    CONSTRAINT cms_field_visibility_chk CHECK (visibility IN ('public', 'back', 'internal')),
    CONSTRAINT cms_field_on_delete_chk CHECK (on_delete IN ('restrict', 'set_null', 'cascade_soft'))
);

CREATE TABLE cms_entry (
    id UUID PRIMARY KEY,
    content_type_id UUID NOT NULL REFERENCES cms_content_type (id),
    slug VARCHAR(160),
    publication_state VARCHAR(16) NOT NULL,
    version INT NOT NULL DEFAULT 1,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    published_payload JSONB,
    published_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_by UUID,
    updated_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cms_entry_state_chk CHECK (publication_state IN ('draft', 'published', 'archived'))
);

CREATE UNIQUE INDEX cms_entry_slug_uq ON cms_entry (content_type_id, slug);

CREATE INDEX cms_entry_type_state_idx ON cms_entry (content_type_id, publication_state)
    WHERE deleted_at IS NULL;

CREATE TABLE cms_entry_revision (
    id UUID PRIMARY KEY,
    entry_id UUID NOT NULL REFERENCES cms_entry (id) ON DELETE CASCADE,
    revision_no INT NOT NULL,
    slug VARCHAR(160),
    payload JSONB NOT NULL,
    published_at TIMESTAMPTZ NOT NULL,
    published_by UUID,
    content_type_key VARCHAR(63) NOT NULL,
    CONSTRAINT cms_entry_revision_uq UNIQUE (entry_id, revision_no)
);

CREATE TABLE cms_entry_ref (
    from_entry_id UUID NOT NULL REFERENCES cms_entry (id) ON DELETE CASCADE,
    field_key VARCHAR(63) NOT NULL,
    to_id UUID NOT NULL,
    to_kind VARCHAR(16) NOT NULL,
    sort_position INT NOT NULL DEFAULT 0,
    CONSTRAINT cms_entry_ref_kind_chk CHECK (to_kind IN ('entry', 'media', 'principal'))
);

CREATE INDEX cms_entry_ref_from_idx ON cms_entry_ref (from_entry_id, field_key);
CREATE INDEX cms_entry_ref_to_idx ON cms_entry_ref (to_id, field_key);

CREATE TABLE cms_entry_index (
    entry_id UUID NOT NULL REFERENCES cms_entry (id) ON DELETE CASCADE,
    field_key VARCHAR(63) NOT NULL,
    value_kind VARCHAR(16) NOT NULL,
    value_string TEXT,
    value_int BIGINT,
    value_bool BOOLEAN,
    value_ts TIMESTAMPTZ
);

CREATE INDEX cms_entry_index_lookup_idx ON cms_entry_index (field_key, value_string);

CREATE TABLE cms_navigation_menu (
    id UUID PRIMARY KEY,
    menu_key VARCHAR(63) NOT NULL,
    surface VARCHAR(16) NOT NULL DEFAULT 'front',
    publication_state VARCHAR(16) NOT NULL DEFAULT 'draft',
    version INT NOT NULL DEFAULT 1,
    document JSONB NOT NULL DEFAULT '{"items":[]}'::jsonb,
    published_document JSONB,
    updated_by UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cms_navigation_menu_key_uq UNIQUE (menu_key),
    CONSTRAINT cms_navigation_menu_state_chk CHECK (publication_state IN ('draft', 'published'))
);
