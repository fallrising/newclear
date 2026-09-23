-- Legacy rows remain unpinned: drain and re-register; never bless old queued work.
ALTER TABLE runtime_catalog ADD COLUMN egress_policy_sha256 text
 CHECK (egress_policy_sha256 ~ '^[a-f0-9]{64}$');
ALTER TABLE runs ADD COLUMN egress_policy_sha256 text
 CHECK (egress_policy_sha256 ~ '^[a-f0-9]{64}$');
