-- Raw audit history expires only through an exact reviewed maintenance plan.
-- Persistent operation evidence contains no actor/action/target/decision fields.
CREATE TABLE audit_gc_plans (
    approval_digest text PRIMARY KEY CHECK (approval_digest ~ '^[0-9a-f]{64}$'),
    plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE audit_gc_receipts (
    approval_digest text PRIMARY KEY REFERENCES audit_gc_plans(approval_digest),
    plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
    receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
    transaction_id bigint NOT NULL DEFAULT txid_current(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE audit_gc_tombstones (
    id uuid PRIMARY KEY,
    approval_digest text NOT NULL REFERENCES audit_gc_receipts(approval_digest),
    created_at timestamptz NOT NULL,
    record_sha256 text NOT NULL CHECK (record_sha256 ~ '^[0-9a-f]{64}$'),
    encoded_bytes bigint NOT NULL CHECK (encoded_bytes BETWEEN 1 AND 8388608),
    pruned_at timestamptz NOT NULL
);
CREATE INDEX audit_events_retention ON audit_events(created_at,id);
CREATE FUNCTION immutable_audit_gc_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit retention records are immutable'; END; $$;
CREATE TRIGGER audit_gc_plan_immutable BEFORE UPDATE OR DELETE ON audit_gc_plans
    FOR EACH ROW EXECUTE FUNCTION immutable_audit_gc_record();
CREATE TRIGGER audit_gc_receipt_immutable BEFORE UPDATE OR DELETE ON audit_gc_receipts
    FOR EACH ROW EXECUTE FUNCTION immutable_audit_gc_record();
CREATE TRIGGER audit_gc_tombstone_immutable BEFORE UPDATE OR DELETE ON audit_gc_tombstones
    FOR EACH ROW EXECUTE FUNCTION immutable_audit_gc_record();
CREATE TRIGGER audit_event_update_immutable BEFORE UPDATE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION immutable_audit_gc_record();
CREATE FUNCTION available_audit_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM audit_gc_tombstones WHERE id=NEW.id) THEN
        RAISE EXCEPTION 'Expired audit identities cannot be reused';
    END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER audit_event_available_insert BEFORE INSERT ON audit_events
    FOR EACH ROW EXECUTE FUNCTION available_audit_identity();
CREATE FUNCTION approved_audit_tombstone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM audit_gc_receipts r
        JOIN audit_gc_plans p ON p.approval_digest=r.approval_digest
        CROSS JOIN maintenance_identity m
        CROSS JOIN LATERAL jsonb_array_elements(p.plan->'candidates') c
        WHERE r.approval_digest=current_setting('agent_platform.audit_gc_approval',true)
            AND NEW.approval_digest=r.approval_digest
            AND r.transaction_id=txid_current() AND r.plan=p.plan
            AND p.plan->>'maintenance_id'=m.id::text
            AND r.receipt->>'maintenance_id'=m.id::text
            AND p.plan->>'schema_version'='audit-gc-v1'
            AND r.receipt->>'schema_version'='audit-gc-v1'
            AND r.receipt->>'approval_digest'=r.approval_digest
            AND r.receipt->'candidates'=p.plan->'candidates'
            AND (r.receipt->>'count')::integer=jsonb_array_length(p.plan->'candidates')
            AND (r.receipt->>'pruned_at')::timestamptz=r.created_at
            AND NEW.pruned_at=r.created_at
            AND (p.plan->>'created_at')::timestamptz<=r.created_at
            AND r.created_at<(p.plan->>'expires_at')::timestamptz
            AND clock_timestamp()>=(p.plan->>'created_at')::timestamptz
            AND clock_timestamp()<(p.plan->>'expires_at')::timestamptz
            AND c->>'id'=NEW.id::text
            AND (c->>'created_at')::timestamptz=NEW.created_at
            AND NEW.created_at<(p.plan->>'cutoff')::timestamptz
            AND c->>'record_sha256'=NEW.record_sha256
            AND (c->>'encoded_bytes')::bigint=NEW.encoded_bytes
    ) THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Audit tombstone requires current approved retention receipt';
END; $$;
CREATE TRIGGER audit_gc_approved_tombstone BEFORE INSERT ON audit_gc_tombstones
    FOR EACH ROW EXECUTE FUNCTION approved_audit_tombstone();
CREATE FUNCTION approved_audit_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM audit_gc_tombstones t
        JOIN audit_gc_receipts r ON r.approval_digest=t.approval_digest
        JOIN audit_gc_plans p ON p.approval_digest=r.approval_digest
        CROSS JOIN maintenance_identity m
        CROSS JOIN LATERAL jsonb_array_elements(p.plan->'candidates') c
        WHERE t.id=OLD.id AND t.created_at=OLD.created_at
            AND r.approval_digest=current_setting('agent_platform.audit_gc_approval',true)
            AND r.transaction_id=txid_current() AND r.plan=p.plan
            AND p.plan->>'maintenance_id'=m.id::text
            AND r.receipt->>'maintenance_id'=m.id::text
            AND p.plan->>'schema_version'='audit-gc-v1'
            AND r.receipt->>'schema_version'='audit-gc-v1'
            AND r.receipt->>'approval_digest'=r.approval_digest
            AND r.receipt->'candidates'=p.plan->'candidates'
            AND (r.receipt->>'count')::integer=jsonb_array_length(p.plan->'candidates')
            AND (r.receipt->>'pruned_at')::timestamptz=r.created_at
            AND t.pruned_at=r.created_at
            AND (p.plan->>'created_at')::timestamptz<=r.created_at
            AND r.created_at<(p.plan->>'expires_at')::timestamptz
            AND clock_timestamp()>=(p.plan->>'created_at')::timestamptz
            AND clock_timestamp()<(p.plan->>'expires_at')::timestamptz
            AND OLD.created_at<(p.plan->>'cutoff')::timestamptz
            AND c->>'id'=OLD.id::text
            AND (c->>'created_at')::timestamptz=OLD.created_at
            AND c->>'record_sha256'=t.record_sha256
            AND (c->>'encoded_bytes')::bigint=t.encoded_bytes
    ) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Audit deletion requires current approved retention receipt';
END; $$;
CREATE TRIGGER audit_event_approved_delete BEFORE DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION approved_audit_delete();
