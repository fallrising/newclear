-- BW1b: cms_entry_index gets a scope (work = working copy, published = published copy) and lookup indexes (02 §3.2).
-- Rows are written by the content store on every entry insert and update; V7 backfills existing entries.

-- Preserve numeric values already accepted by entry validation, including fractional ranks.
ALTER TABLE cms_entry_index ALTER COLUMN value_int TYPE NUMERIC;

ALTER TABLE cms_entry_index ADD COLUMN scope VARCHAR(12) NOT NULL DEFAULT 'work';
ALTER TABLE cms_entry_index ADD CONSTRAINT cms_entry_index_scope_chk CHECK (scope IN ('work', 'published'));
ALTER TABLE cms_entry_index ADD CONSTRAINT cms_entry_index_kind_chk
    CHECK (value_kind IN ('string', 'enum', 'int', 'bool', 'datetime', 'ref'));
CREATE INDEX cms_entry_index_str_idx ON cms_entry_index (field_key, scope, value_string);
CREATE INDEX cms_entry_index_ts_idx  ON cms_entry_index (field_key, scope, value_ts);
CREATE INDEX cms_entry_index_int_idx ON cms_entry_index (field_key, scope, value_int);
CREATE INDEX cms_entry_index_entry_idx ON cms_entry_index (entry_id, scope);
DROP INDEX cms_entry_index_lookup_idx;
