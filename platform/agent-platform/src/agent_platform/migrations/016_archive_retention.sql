-- The singleton is intentionally omitted from backups and regenerated on restore.
CREATE TABLE maintenance_identity (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO maintenance_identity DEFAULT VALUES;
CREATE TABLE archive_gc_plans (
    approval_digest text PRIMARY KEY CHECK (approval_digest ~ '^[0-9a-f]{64}$'),
    plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE archive_gc_receipts (
    approval_digest text PRIMARY KEY REFERENCES archive_gc_plans(approval_digest),
    plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
    receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
    transaction_id bigint NOT NULL DEFAULT txid_current(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION immutable_archive_gc_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Archive retention records are immutable'; END; $$;
CREATE TRIGGER archive_gc_plan_immutable BEFORE UPDATE OR DELETE ON archive_gc_plans
    FOR EACH ROW EXECUTE FUNCTION immutable_archive_gc_record();
CREATE TRIGGER archive_gc_receipt_immutable BEFORE UPDATE OR DELETE ON archive_gc_receipts
    FOR EACH ROW EXECUTE FUNCTION immutable_archive_gc_record();

ALTER TABLE result_archives ADD COLUMN pruned_at timestamptz;
ALTER TABLE result_archives ALTER COLUMN payload DROP NOT NULL;
ALTER TABLE result_archives ADD CONSTRAINT archive_payload_lifecycle CHECK (
    (payload IS NOT NULL AND pruned_at IS NULL) OR (payload IS NULL AND pruned_at IS NOT NULL)
);
CREATE OR REPLACE FUNCTION immutable_result_archive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.payload IS NOT NULL AND OLD.pruned_at IS NULL
           AND NEW.payload IS NULL AND NEW.pruned_at IS NOT NULL
           AND ROW(NEW.id,NEW.run_id,NEW.kind,NEW.sha256,NEW.size,NEW.mime,NEW.created_at)
               IS NOT DISTINCT FROM
               ROW(OLD.id,OLD.run_id,OLD.kind,OLD.sha256,OLD.size,OLD.mime,OLD.created_at)
           AND EXISTS (
               SELECT 1 FROM archive_gc_receipts r,
                    jsonb_array_elements(r.plan->'candidates') candidate
               WHERE r.approval_digest = current_setting('agent_platform.gc_approval', true)
                 AND r.transaction_id = txid_current()
                 AND (r.receipt->>'pruned_at')::timestamptz = NEW.pruned_at
                 AND candidate->>'id' = OLD.id::text
                 AND candidate->>'run_id' = OLD.run_id::text
                 AND candidate->>'sha256' = OLD.sha256
                 AND (candidate->>'size')::integer = OLD.size
                 AND (candidate->>'created_at')::timestamptz = OLD.created_at
           ) THEN RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'Result archives are immutable';
END; $$;
CREATE FUNCTION available_archive_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.payload IS NULL OR NEW.pruned_at IS NOT NULL THEN
        RAISE EXCEPTION 'New result archives must be available';
    END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER result_archive_available_insert BEFORE INSERT ON result_archives
    FOR EACH ROW EXECUTE FUNCTION available_archive_insert();

-- A concurrent approval that read before retention must recheck after waiting.
CREATE FUNCTION available_export_archive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM id FROM result_archives WHERE id=NEW.artifact_id
        AND run_id=NEW.run_id AND sha256=NEW.artifact_sha256
        AND payload IS NOT NULL AND pruned_at IS NULL FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Export archive is unavailable' USING ERRCODE = '23514',
            CONSTRAINT = 'github_export_archive_available';
    END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER github_export_archive_available BEFORE INSERT ON github_exports
    FOR EACH ROW EXECUTE FUNCTION available_export_archive();
