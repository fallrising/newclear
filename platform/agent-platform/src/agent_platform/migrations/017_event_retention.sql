-- Permanent payload-free replay identities retain the original index key shapes.
CREATE TABLE run_event_identities (
    run_id uuid NOT NULL REFERENCES runs(id),
    seq bigint NOT NULL CHECK (seq > 0),
    event_id uuid NOT NULL UNIQUE,
    source text NOT NULL,
    source_event_id text NOT NULL,
    type text NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY(run_id,seq),
    UNIQUE(run_id,source,source_event_id)
);
INSERT INTO run_event_identities(run_id,seq,event_id,source,source_event_id,type,created_at)
    SELECT run_id,seq,event_id,source,source_event_id,type,created_at FROM run_events;
ALTER TABLE run_events ADD CONSTRAINT run_event_identity
    FOREIGN KEY(run_id,seq) REFERENCES run_event_identities(run_id,seq);
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM run_events e LEFT JOIN run_event_identities i
            ON i.run_id=e.run_id AND i.seq=e.seq
        WHERE ROW(e.run_id,e.seq,e.event_id,e.source,e.source_event_id,e.type,e.created_at)
            IS DISTINCT FROM
            ROW(i.run_id,i.seq,i.event_id,i.source,i.source_event_id,i.type,i.created_at)
    ) THEN RAISE EXCEPTION 'Event identity backfill mismatch'; END IF;
END; $$;
CREATE FUNCTION immutable_event_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Event identities are immutable'; END; $$;
CREATE TRIGGER event_identity_immutable BEFORE UPDATE OR DELETE ON run_event_identities
    FOR EACH ROW EXECUTE FUNCTION immutable_event_identity();
CREATE FUNCTION matching_event_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM run_event_identities i WHERE i.run_id=NEW.run_id AND i.seq=NEW.seq
            AND ROW(NEW.run_id,NEW.seq,NEW.event_id,NEW.source,NEW.source_event_id,NEW.type,NEW.created_at)
                IS NOT DISTINCT FROM
                ROW(i.run_id,i.seq,i.event_id,i.source,i.source_event_id,i.type,i.created_at)
    ) THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Event identity mismatch';
END; $$;
CREATE TRIGGER run_event_identity_match BEFORE INSERT OR UPDATE ON run_events
    FOR EACH ROW EXECUTE FUNCTION matching_event_identity();
CREATE TABLE event_gc_plans (
    approval_digest text PRIMARY KEY CHECK (approval_digest ~ '^[0-9a-f]{64}$'),
    plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE event_gc_receipts (
    approval_digest text PRIMARY KEY REFERENCES event_gc_plans(approval_digest),
    plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
    receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
    transaction_id bigint NOT NULL DEFAULT txid_current(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION immutable_event_gc_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Event retention records are immutable'; END; $$;
CREATE TRIGGER event_gc_plan_immutable BEFORE UPDATE OR DELETE ON event_gc_plans
    FOR EACH ROW EXECUTE FUNCTION immutable_event_gc_record();
CREATE TRIGGER event_gc_receipt_immutable BEFORE UPDATE OR DELETE ON event_gc_receipts
    FOR EACH ROW EXECUTE FUNCTION immutable_event_gc_record();
CREATE FUNCTION approved_event_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM event_gc_receipts r
        JOIN event_gc_plans p ON p.approval_digest=r.approval_digest
        CROSS JOIN maintenance_identity m
        CROSS JOIN LATERAL jsonb_array_elements(p.plan->'candidates') c
        CROSS JOIN LATERAL jsonb_array_elements(r.receipt->'ranges') approved
        JOIN run_event_identities i ON i.run_id=OLD.run_id AND i.seq=OLD.seq
        WHERE r.approval_digest=current_setting('agent_platform.event_gc_approval',true)
            AND r.transaction_id=txid_current() AND r.plan=p.plan
            AND p.plan->>'maintenance_id'=m.id::text
            AND r.receipt->>'maintenance_id'=m.id::text
            AND p.plan->>'schema_version'='event-gc-v1'
            AND r.receipt->>'schema_version'='event-gc-v1'
            AND r.receipt->>'approval_digest'=r.approval_digest
            AND (r.receipt->>'pruned_at')::timestamptz=r.created_at
            AND (p.plan->>'created_at')::timestamptz<=r.created_at
            AND r.created_at<(p.plan->>'expires_at')::timestamptz
            AND clock_timestamp()>=(p.plan->>'created_at')::timestamptz
            AND clock_timestamp()<(p.plan->>'expires_at')::timestamptz
            AND c->>'run_id'=OLD.run_id::text
            AND OLD.seq BETWEEN (c->>'old_floor')::bigint AND (c->>'through_seq')::bigint
            AND (c->>'event_count')::bigint=(c->>'through_seq')::bigint-(c->>'old_floor')::bigint+1
            AND approved=c || jsonb_build_object('new_floor',(c->>'through_seq')::bigint+1)
            AND ROW(OLD.run_id,OLD.seq,OLD.event_id,OLD.source,OLD.source_event_id,OLD.type,OLD.created_at)
                IS NOT DISTINCT FROM
                ROW(i.run_id,i.seq,i.event_id,i.source,i.source_event_id,i.type,i.created_at)
    ) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Event deletion requires current approved retention receipt';
END; $$;
CREATE TRIGGER run_event_approved_delete BEFORE DELETE ON run_events
    FOR EACH ROW EXECUTE FUNCTION approved_event_delete();
