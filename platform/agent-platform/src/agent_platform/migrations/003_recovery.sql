ALTER TABLE runs ADD COLUMN interrupted_from text;
ALTER TABLE runs ADD COLUMN reconciled_at timestamptz;
CREATE INDEX jobs_recovery ON jobs(available_at,id) WHERE status='interrupted';
