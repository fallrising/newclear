-- Wave B3 Media system tables. Bytes live on disk, not in PostgreSQL.
-- Never CREATE TABLE album or a public static media directory.

ALTER TABLE cms_field ADD COLUMN IF NOT EXISTS public_bytes BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE cms_media (
    id UUID PRIMARY KEY,
    owner_principal_id UUID NOT NULL,
    title TEXT NOT NULL,
    alt_text TEXT NOT NULL DEFAULT '',
    original_filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    byte_size BIGINT NOT NULL,
    stored_bytes BIGINT NOT NULL,
    width INT,
    height INT,
    checksum_sha256 CHAR(64) NOT NULL,
    status TEXT NOT NULL,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cms_media_status_chk CHECK (status IN ('available', 'deleted'))
);

CREATE TABLE cms_media_variant (
    media_id UUID NOT NULL REFERENCES cms_media (id) ON DELETE CASCADE,
    variant TEXT NOT NULL,
    content_type TEXT NOT NULL,
    byte_size BIGINT NOT NULL,
    width INT,
    height INT,
    object_key TEXT NOT NULL,
    PRIMARY KEY (media_id, variant),
    CONSTRAINT cms_media_variant_chk CHECK (variant IN ('original', 'thumbnail', 'web'))
);

CREATE TABLE cms_media_attachment (
    media_id UUID NOT NULL REFERENCES cms_media (id) ON DELETE CASCADE,
    entry_id UUID NOT NULL,
    field_key TEXT NOT NULL,
    attached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (media_id, entry_id, field_key)
);

CREATE INDEX cms_media_attachment_entry_idx ON cms_media_attachment (entry_id);

CREATE TABLE cms_media_settings (
    id INT PRIMARY KEY,
    max_file_bytes BIGINT NOT NULL,
    max_library_bytes BIGINT NOT NULL,
    max_files INT NOT NULL,
    max_files_per_principal INT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO cms_media_settings (id, max_file_bytes, max_library_bytes, max_files, max_files_per_principal)
VALUES (1, 15728640, 2147483648, 10000, 2000)
ON CONFLICT (id) DO NOTHING;
