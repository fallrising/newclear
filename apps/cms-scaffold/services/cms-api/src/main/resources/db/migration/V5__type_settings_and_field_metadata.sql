-- BW1a: content type settings and field metadata (02 §3.1).
-- Kernel columns only; demo values are written by ContentTypeSeed, not here.

ALTER TABLE cms_content_type
    ADD COLUMN sort_field       VARCHAR(63),
    ADD COLUMN visibility_field VARCHAR(63),
    ADD COLUMN owner_field      VARCHAR(63);

ALTER TABLE cms_field
    ADD COLUMN label       VARCHAR(80),
    ADD COLUMN group_key   VARCHAR(32),
    ADD COLUMN listable    BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN filterable  BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN enum_labels JSONB,
    ADD COLUMN placeholder VARCHAR(120);
