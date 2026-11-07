"""Explicit approved event-prefix pruning with permanent source replay identities."""

import hashlib
import json
import re
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import psycopg
from psycopg.types.json import Jsonb

SCHEMA_VERSION = "event-gc-v1"
PLAN_LIMIT = 65536
BYTE_LIMIT = 8388608
MAX_SEQ = 9223372036854775807
PLAN_FIELDS = {
    "schema_version",
    "maintenance_id",
    "created_at",
    "expires_at",
    "cutoff",
    "retention_days",
    "limit",
    "event_limit",
    "byte_limit",
    "candidates",
    "approval_digest",
}
CANDIDATE_FIELDS = {
    "run_id",
    "old_floor",
    "last_event_seq",
    "through_seq",
    "first_created_at",
    "event_count",
    "payload_bytes",
    "encoded_bytes",
    "prefix_sha256",
    "identity_sha256",
}
LOCK_TABLES = (
    "maintenance_identity,jobs,runs,sandbox_bindings,resource_reservations,adapter_operations,"
    "run_event_identities,run_events,event_gc_plans,event_gc_receipts"
)
# Ownership proof is deliberately independent of archive/export availability.
ELIGIBLE = """
    r.state IN ('succeeded','failed','cancelled')
    AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.run_id=r.id AND j.status<>'done')
    AND NOT EXISTS (SELECT 1 FROM sandbox_bindings b
        WHERE b.run_id=r.id AND b.id IS DISTINCT FROM r.sandbox_id)
    AND NOT EXISTS (SELECT 1 FROM sandbox_bindings b
        WHERE b.id=r.sandbox_id AND b.run_id<>r.id)
    AND NOT EXISTS (SELECT 1 FROM runs other
        WHERE other.sandbox_id=r.sandbox_id AND other.id<>r.id)
    AND (
        (r.cleanup_state='not_allocated' AND r.sandbox_id IS NULL
         AND r.generation=0 AND r.backend_ref IS NULL
         AND NOT EXISTS (SELECT 1 FROM sandbox_bindings b WHERE b.run_id=r.id)
         AND NOT EXISTS (SELECT 1 FROM adapter_operations op WHERE op.run_id=r.id)
         AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.run_id=r.id
             AND (j.generation<>0 OR j.attempts<>0 OR j.lease_owner IS NOT NULL
                  OR j.lease_until IS NOT NULL)))
        OR
        (r.cleanup_state='confirmed' AND EXISTS (
            SELECT 1 FROM sandbox_bindings b
            JOIN resource_reservations rr ON rr.sandbox_id=b.id
            WHERE b.id=r.sandbox_id AND b.run_id=r.id AND b.generation=r.generation
              AND b.cleanup_state='confirmed' AND b.desired_state='stopped'
              AND b.observed_state='stopped' AND rr.released_at IS NOT NULL
              AND ((r.backend='openhands' AND b.node_id='cocoon-local'
                    AND b.provider_handle NOT LIKE 'pending:%%' AND b.provider_handle<>'')
                   OR (r.backend='fake' AND b.node_id='fake-local'
                       AND (b.provider_handle NOT LIKE 'pending:%%' AND b.provider_handle<>''
                            OR b.provider_handle='pending:' || r.id::text)))))
    )
"""


def canonical(value):
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False
    ).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def timestamp(value):
    return value.astimezone(UTC).isoformat(timespec="microseconds")


def parsed_time(value):
    if not isinstance(value, str) or len(value) != 32:
        raise ValueError("event_gc_plan_invalid")
    try:
        result = datetime.fromisoformat(value)
        if result.utcoffset() != timedelta(0) or timestamp(result) != value:
            raise ValueError()
        return result
    except ValueError:
        raise ValueError("event_gc_plan_invalid") from None


def uuid_text(value):
    try:
        if not isinstance(value, str) or len(value) != 36 or str(UUID(value)) != value:
            raise ValueError()
    except ValueError:
        raise ValueError("event_gc_plan_invalid") from None


def integer(value, low, high):
    return type(value) is int and low <= value <= high


def bounds(retention_days, limit, event_limit):
    if not integer(retention_days, 30, 36500):
        raise ValueError("event_gc_retention_invalid")
    if not integer(limit, 1, 100) or not integer(event_limit, 1, 1000):
        raise ValueError("event_gc_limit_invalid")


def validate_plan(plan, approval_digest):
    if not isinstance(plan, dict) or set(plan) != PLAN_FIELDS:
        raise ValueError("event_gc_plan_invalid")
    bounds(plan["retention_days"], plan["limit"], plan["event_limit"])
    if plan["schema_version"] != SCHEMA_VERSION or type(plan["byte_limit"]) is not int:
        raise ValueError("event_gc_plan_invalid")
    if plan["byte_limit"] != BYTE_LIMIT:
        raise ValueError("event_gc_plan_invalid")
    uuid_text(plan["maintenance_id"])
    created, expires, cutoff = (
        parsed_time(plan[k]) for k in ("created_at", "expires_at", "cutoff")
    )
    try:
        valid = expires == created + timedelta(hours=1) and cutoff == created - timedelta(
            days=plan["retention_days"]
        )
    except OverflowError:
        valid = False
    if not valid:
        raise ValueError("event_gc_plan_invalid")
    items = plan["candidates"]
    if not isinstance(items, list) or len(items) > plan["limit"]:
        raise ValueError("event_gc_plan_invalid")
    order, ids, count, size = [], set(), 0, 0
    for item in items:
        if not isinstance(item, dict) or set(item) != CANDIDATE_FIELDS:
            raise ValueError("event_gc_plan_invalid")
        uuid_text(item["run_id"])
        when = parsed_time(item["first_created_at"])
        if when >= cutoff or item["run_id"] in ids:
            raise ValueError("event_gc_plan_invalid")
        if not (
            integer(item["old_floor"], 1, MAX_SEQ)
            and integer(item["last_event_seq"], 1, MAX_SEQ)
            and integer(item["through_seq"], item["old_floor"], MAX_SEQ - 1)
            and item["through_seq"] <= item["last_event_seq"]
            and integer(item["event_count"], 1, plan["event_limit"])
            and item["event_count"] == item["through_seq"] - item["old_floor"] + 1
            and integer(item["payload_bytes"], 1, BYTE_LIMIT)
            and integer(item["encoded_bytes"], item["payload_bytes"], BYTE_LIMIT)
        ):
            raise ValueError("event_gc_plan_invalid")
        if any(
            not isinstance(item[k], str) or re.fullmatch("[a-f0-9]{64}", item[k]) is None
            for k in ("prefix_sha256", "identity_sha256")
        ):
            raise ValueError("event_gc_plan_invalid")
        count += item["event_count"]
        size += item["encoded_bytes"]
        ids.add(item["run_id"])
        order.append((when, item["run_id"]))
    if count > plan["event_limit"] or size > BYTE_LIMIT or order != sorted(order):
        raise ValueError("event_gc_plan_invalid")
    supplied = plan["approval_digest"]
    if (
        not isinstance(supplied, str)
        or re.fullmatch("[a-f0-9]{64}", supplied) is None
        or type(approval_digest) is not str
        or supplied != approval_digest
        or digest({k: v for k, v in plan.items() if k != "approval_digest"}) != supplied
    ):
        raise ValueError("event_gc_approval_invalid")
    raw = canonical(plan)
    if len(raw) > PLAN_LIMIT:
        raise ValueError("event_gc_plan_invalid")
    return json.loads(raw)


def lock(conn):
    conn.execute("SELECT pg_advisory_xact_lock(77310401)")
    conn.execute("SELECT pg_advisory_xact_lock(77310402)")
    conn.execute("LOCK TABLE " + LOCK_TABLES + " IN EXCLUSIVE MODE NOWAIT")


def identity(conn):
    row = conn.execute("SELECT id FROM maintenance_identity WHERE singleton").fetchone()
    if row is None:
        raise ValueError("event_gc_identity_missing")
    return str(row["id"])


def _first_rows(conn, cutoff, limit, ids=None):
    selection = " AND r.id=ANY(%s::uuid[])" if ids is not None else ""
    params = (cutoff, ids, limit) if ids is not None else (cutoff, limit)
    return conn.execute(
        "SELECT r.id,r.event_floor,r.last_event_seq,e.created_at FROM runs r "
        "JOIN run_events e ON e.run_id=r.id AND e.seq=r.event_floor "
        "WHERE e.created_at<%s AND "
        + ELIGIBLE
        + selection
        + " ORDER BY e.created_at,r.id LIMIT %s",
        params,
    ).fetchall()


def _lengths(conn, run_id, floor, limit, *, identities=False, through=MAX_SEQ):
    # Both relations/column sets are constants, never plan-derived identifiers.
    table = "run_event_identities" if identities else "run_events"
    payload = "0" if identities else "octet_length(convert_to(payload::text,'UTF8'))"
    return conn.execute(
        "SELECT seq,event_id,created_at,octet_length(convert_to(source,'UTF8')) AS source_bytes,"
        "octet_length(convert_to(source_event_id,'UTF8')) AS source_id_bytes,"
        "octet_length(convert_to(type,'UTF8')) AS type_bytes," + payload + " AS payload_bytes "
        "FROM " + table + " WHERE run_id=%s AND seq BETWEEN %s AND %s ORDER BY seq LIMIT %s",
        (run_id, floor, through, limit),
    ).fetchall()


def _record(conn, run_id, row, *, identities=False):
    table = "run_event_identities" if identities else "run_events"
    columns = (
        "substring(convert_to(source,'UTF8') FROM 1 FOR %s) AS source,"
        "substring(convert_to(source_event_id,'UTF8') FROM 1 FOR %s) AS source_event_id,"
        "substring(convert_to(type,'UTF8') FROM 1 FOR %s) AS type"
    )
    sizes = [row[k] for k in ("source_bytes", "source_id_bytes", "type_bytes")]
    if not identities:
        columns += ",substring(convert_to(payload::text,'UTF8') FROM 1 FOR %s) AS payload_text"
        sizes.append(row["payload_bytes"])
    raw = conn.execute(
        "SELECT " + columns + " FROM " + table + " WHERE run_id=%s AND seq=%s",
        (*sizes, run_id, row["seq"]),
    ).fetchone()
    if raw is None or [len(v) for v in raw.values()] != sizes:
        raise ValueError("event_gc_candidates_changed")
    result = {
        "run_id": str(run_id),
        "seq": row["seq"],
        "event_id": str(row["event_id"]),
        "created_at": timestamp(row["created_at"]),
    }
    result.update({key: bytes(value).decode("utf-8") for key, value in raw.items()})
    return result


def _upper(row, *, identities=False):
    metadata = row["source_bytes"] + row["source_id_bytes"] + row["type_bytes"]
    return 6 * (row["payload_bytes"] + (1 if identities else 2) * metadata) + 2048


def candidates(conn, cutoff, limit, event_limit, approved=None):
    ids = None if approved is None else [item["run_id"] for item in approved]
    ranges = {} if approved is None else {item["run_id"]: item for item in approved}
    first = _first_rows(conn, cutoff, limit, ids)
    inspections, used, emitted = event_limit + 1, 0, 0
    result = []
    for run in first:
        if inspections == 0 or emitted == event_limit:
            break
        through = ranges[str(run["id"])]["through_seq"] if approved is not None else MAX_SEQ
        rows = _lengths(conn, run["id"], run["event_floor"], inspections, through=through)
        inspections -= len(rows)
        full, identities = hashlib.sha256(b"["), hashlib.sha256(b"[")
        count, payload_bytes, encoded_bytes, expected = 0, 0, 4, run["event_floor"]
        if used + 4 > BYTE_LIMIT:
            break
        used += 4
        inconsistent = False
        for row in rows:
            if row["seq"] != expected or row["seq"] > run["last_event_seq"]:
                inconsistent = True
                break
            if row["created_at"] >= cutoff or emitted == event_limit or row["seq"] == MAX_SEQ:
                break
            upper = _upper(row) + (2 if count else 0)
            if used + upper > BYTE_LIMIT:
                break
            # Charge the conservative preflight even when this run is later rejected.
            used += upper
            record = _record(conn, run["id"], row)
            full_raw = canonical(record)
            del record["payload_text"]
            identity_raw = canonical(record)
            actual = len(full_raw) + len(identity_raw) + (2 if count else 0)
            if actual > upper:
                raise ValueError("event_gc_candidates_changed")
            if count:
                full.update(b",")
                identities.update(b",")
            full.update(full_raw)
            identities.update(identity_raw)
            encoded_bytes += actual
            payload_bytes += row["payload_bytes"]
            count += 1
            emitted += 1
            expected += 1
        if count and not inconsistent:
            full.update(b"]")
            identities.update(b"]")
            result.append(
                {
                    "run_id": str(run["id"]),
                    "old_floor": run["event_floor"],
                    "last_event_seq": run["last_event_seq"],
                    "through_seq": expected - 1,
                    "first_created_at": timestamp(run["created_at"]),
                    "event_count": count,
                    "payload_bytes": payload_bytes,
                    "encoded_bytes": encoded_bytes,
                    "prefix_sha256": full.hexdigest(),
                    "identity_sha256": identities.hexdigest(),
                }
            )
    return result


def preview(db, *, retention_days=30, limit=100, event_limit=1000):
    bounds(retention_days, limit, event_limit)
    try:
        with db.transaction() as conn:
            lock(conn)
            now = conn.execute("SELECT clock_timestamp() AS now").fetchone()["now"]
            cutoff = now - timedelta(days=retention_days)
            plan = {
                "schema_version": SCHEMA_VERSION,
                "maintenance_id": identity(conn),
                "created_at": timestamp(now),
                "expires_at": timestamp(now + timedelta(hours=1)),
                "cutoff": timestamp(cutoff),
                "retention_days": retention_days,
                "limit": limit,
                "event_limit": event_limit,
                "byte_limit": BYTE_LIMIT,
                "candidates": candidates(conn, cutoff, limit, event_limit),
            }
            plan["approval_digest"] = digest(plan)
            validate_plan(plan, plan["approval_digest"])
            conn.execute(
                "INSERT INTO event_gc_plans(approval_digest,plan) VALUES (%s,%s)",
                (plan["approval_digest"], Jsonb(plan)),
            )
            return plan
    except psycopg.Error:
        raise ValueError("event_gc_database_unavailable") from None


def _receipt(plan, when):
    return {
        "schema_version": SCHEMA_VERSION,
        "approval_digest": plan["approval_digest"],
        "maintenance_id": plan["maintenance_id"],
        "pruned_at": timestamp(when),
        "ranges": [{**item, "new_floor": item["through_seq"] + 1} for item in plan["candidates"]],
        "total_count": sum(item["event_count"] for item in plan["candidates"]),
        "total_bytes": sum(item["payload_bytes"] for item in plan["candidates"]),
    }


def _replay(conn, plan, saved):
    receipt = saved["receipt"]
    if not isinstance(receipt, dict) or saved["plan"] != plan:
        raise ValueError("event_gc_receipt_invalid")
    try:
        when = parsed_time(receipt.get("pruned_at"))
        valid = (
            parsed_time(plan["created_at"]) <= when < parsed_time(plan["expires_at"])
            and canonical(receipt) == canonical(_receipt(plan, when))
            and type(receipt["total_count"]) is int
            and type(receipt["total_bytes"]) is int
            and all(type(item["new_floor"]) is int for item in receipt["ranges"])
        )
    except (ValueError, KeyError, TypeError):
        valid = False
    if not valid:
        raise ValueError("event_gc_receipt_invalid")
    budget = BYTE_LIMIT
    for item in plan["candidates"]:
        floor = conn.execute(
            "SELECT event_floor FROM runs WHERE id=%s", (item["run_id"],)
        ).fetchone()
        if floor is None or floor["event_floor"] < item["through_seq"] + 1:
            raise ValueError("event_gc_receipt_invalid")
        if conn.execute(
            "SELECT 1 FROM run_events WHERE run_id=%s AND seq BETWEEN %s AND %s LIMIT 1",
            (item["run_id"], item["old_floor"], item["through_seq"]),
        ).fetchone():
            raise ValueError("event_gc_receipt_invalid")
        rows = _lengths(
            conn,
            item["run_id"],
            item["old_floor"],
            item["event_count"] + 1,
            identities=True,
            through=item["through_seq"],
        )
        if len(rows) != item["event_count"]:
            raise ValueError("event_gc_receipt_invalid")
        hashed = hashlib.sha256(b"[")
        budget -= 2
        for index, row in enumerate(rows):
            if row["seq"] != item["old_floor"] + index:
                raise ValueError("event_gc_receipt_invalid")
            upper = _upper(row, identities=True) + bool(index)
            if upper > budget:
                raise ValueError("event_gc_receipt_invalid")
            budget -= upper
            raw = canonical(_record(conn, item["run_id"], row, identities=True))
            if len(raw) + bool(index) > upper:
                raise ValueError("event_gc_receipt_invalid")
            if index:
                hashed.update(b",")
            hashed.update(raw)
        hashed.update(b"]")
        if hashed.hexdigest() != item["identity_sha256"]:
            raise ValueError("event_gc_receipt_invalid")
    return receipt


def apply(db, plan, *, approval_digest):
    plan = validate_plan(plan, approval_digest)
    try:
        with db.transaction() as conn:
            lock(conn)
            now = conn.execute("SELECT clock_timestamp() AS now").fetchone()["now"]
            if identity(conn) != plan["maintenance_id"]:
                raise ValueError("event_gc_identity_changed")
            if not parsed_time(plan["created_at"]) <= now < parsed_time(plan["expires_at"]):
                raise ValueError("event_gc_plan_expired")
            issued = conn.execute(
                "SELECT plan FROM event_gc_plans WHERE approval_digest=%s", (approval_digest,)
            ).fetchone()
            if issued is None or issued["plan"] != plan:
                raise ValueError("event_gc_plan_unrecognized")
            saved = conn.execute(
                "SELECT plan,receipt FROM event_gc_receipts WHERE approval_digest=%s",
                (approval_digest,),
            ).fetchone()
            if saved is not None:
                return _replay(conn, plan, saved)
            actual = candidates(
                conn,
                parsed_time(plan["cutoff"]),
                plan["limit"],
                plan["event_limit"],
                plan["candidates"],
            )
            if actual != plan["candidates"]:
                raise ValueError("event_gc_candidates_changed")
            receipt = _receipt(plan, now)
            conn.execute(
                "INSERT INTO event_gc_receipts(approval_digest,plan,receipt,created_at) "
                "VALUES (%s,%s,%s,%s)",
                (approval_digest, Jsonb(plan), Jsonb(receipt), now),
            )
            conn.execute(
                "SELECT set_config('agent_platform.event_gc_approval',%s,true)", (approval_digest,)
            )
            for item in actual:
                changed = conn.execute(
                    "DELETE FROM run_events WHERE run_id=%s AND seq BETWEEN %s AND %s",
                    (item["run_id"], item["old_floor"], item["through_seq"]),
                ).rowcount
                if changed != item["event_count"]:
                    raise ValueError("event_gc_candidates_changed")
                conn.execute(
                    "UPDATE runs SET event_floor=%s WHERE id=%s",
                    (item["through_seq"] + 1, item["run_id"]),
                )
            conn.execute(
                "INSERT INTO audit_events(id,action,target,decision) "
                "VALUES (%s,'event_gc.apply',%s,'approved')",
                (uuid4(), approval_digest),
            )
            return receipt
    except psycopg.Error:
        raise ValueError("event_gc_database_unavailable") from None
