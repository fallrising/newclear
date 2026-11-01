"""Manual, approved payload retention with permanent identities and receipts."""

import hashlib
import json
import re
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import psycopg
from psycopg.types.json import Jsonb

from .result_archive import ARCHIVE_LIMIT

SCHEMA_VERSION = "archive-gc-v1"
PLAN_LIMIT = 65536
PLAN_FIELDS = {
    "schema_version",
    "maintenance_id",
    "created_at",
    "expires_at",
    "cutoff",
    "retention_days",
    "limit",
    "candidates",
    "approval_digest",
}
CANDIDATE_FIELDS = {"id", "run_id", "sha256", "size", "created_at"}
LOCK_TABLES = (
    "maintenance_identity,runs,jobs,sandbox_bindings,resource_reservations,adapter_operations,"
    "github_exports,result_archives,archive_gc_plans,archive_gc_receipts"
)
# No absence inference after an allocation attempt: require generation zero and
# no handles, bindings or operations, or a matching stopped/released binding.
ELIGIBLE = """
    a.pruned_at IS NULL AND a.payload IS NOT NULL AND a.created_at < %s
    AND r.state IN ('succeeded','failed','cancelled')
    AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.run_id=r.id AND j.status<>'done')
    AND NOT EXISTS (SELECT 1 FROM github_exports e WHERE e.artifact_id=a.id)
    AND NOT EXISTS (
        SELECT 1 FROM sandbox_bindings other
        WHERE other.run_id=r.id AND other.id IS DISTINCT FROM r.sandbox_id)
    AND NOT EXISTS (
        SELECT 1 FROM sandbox_bindings other
        WHERE other.id=r.sandbox_id AND other.run_id<>r.id)
    AND NOT EXISTS (
        SELECT 1 FROM runs other
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
    try:
        raw = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
        if len(raw) > PLAN_LIMIT:
            raise ValueError
        return raw
    except (TypeError, ValueError, UnicodeError, RecursionError):
        raise ValueError("archive_gc_plan_invalid") from None


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def timestamp(value):
    return value.astimezone(UTC).isoformat(timespec="microseconds")


def parsed_time(value):
    if not isinstance(value, str) or len(value) != 32:
        raise ValueError("archive_gc_plan_invalid")
    try:
        result = datetime.fromisoformat(value)
        if result.utcoffset() != timedelta(0) or timestamp(result) != value:
            raise ValueError
        return result
    except ValueError:
        raise ValueError("archive_gc_plan_invalid") from None


def uuid_text(value):
    if not isinstance(value, str) or len(value) != 36:
        raise ValueError("archive_gc_plan_invalid")
    try:
        if str(UUID(value)) != value:
            raise ValueError
    except ValueError:
        raise ValueError("archive_gc_plan_invalid") from None


def bounds(retention_days, limit):
    if type(retention_days) is not int or not 30 <= retention_days <= 36500:
        raise ValueError("archive_gc_retention_invalid")
    if type(limit) is not int or not 1 <= limit <= 100:
        raise ValueError("archive_gc_limit_invalid")


def validate_plan(plan, approval_digest):
    # Bound structure before canonical encoding to avoid copying arbitrary input.
    if not isinstance(plan, dict) or set(plan) != PLAN_FIELDS:
        raise ValueError("archive_gc_plan_invalid")
    bounds(plan["retention_days"], plan["limit"])
    if plan["schema_version"] != SCHEMA_VERSION:
        raise ValueError("archive_gc_plan_invalid")
    uuid_text(plan["maintenance_id"])
    created = parsed_time(plan["created_at"])
    expires = parsed_time(plan["expires_at"])
    cutoff = parsed_time(plan["cutoff"])
    try:
        valid_times = expires == created + timedelta(hours=1) and cutoff == created - timedelta(
            days=plan["retention_days"]
        )
    except OverflowError:
        valid_times = False
    if not valid_times:
        raise ValueError("archive_gc_plan_invalid")
    candidates = plan["candidates"]
    if not isinstance(candidates, list) or len(candidates) > plan["limit"]:
        raise ValueError("archive_gc_plan_invalid")
    order = []
    ids = set()
    runs = set()
    for item in candidates:
        if not isinstance(item, dict) or set(item) != CANDIDATE_FIELDS:
            raise ValueError("archive_gc_plan_invalid")
        uuid_text(item["id"])
        uuid_text(item["run_id"])
        if not isinstance(item["sha256"], str) or not re.fullmatch("[a-f0-9]{64}", item["sha256"]):
            raise ValueError("archive_gc_plan_invalid")
        if type(item["size"]) is not int or not 1 <= item["size"] <= 1048576:
            raise ValueError("archive_gc_plan_invalid")
        when = parsed_time(item["created_at"])
        if when >= cutoff or item["id"] in ids or item["run_id"] in runs:
            raise ValueError("archive_gc_plan_invalid")
        order.append((when, item["id"]))
        ids.add(item["id"])
        runs.add(item["run_id"])
    if order != sorted(order):
        raise ValueError("archive_gc_plan_invalid")
    supplied = plan["approval_digest"]
    if (
        not isinstance(supplied, str)
        or re.fullmatch("[a-f0-9]{64}", supplied) is None
        or type(approval_digest) is not str
        or approval_digest != supplied
        or digest({key: value for key, value in plan.items() if key != "approval_digest"})
        != supplied
    ):
        raise ValueError("archive_gc_approval_invalid")
    # A detached JSON copy prevents caller mutation during a database wait.
    return json.loads(canonical(plan))


def lock(conn):
    conn.execute("SELECT pg_advisory_xact_lock(77310401)")
    conn.execute("SELECT pg_advisory_xact_lock(77310402)")
    conn.execute("LOCK TABLE " + LOCK_TABLES + " IN SHARE ROW EXCLUSIVE MODE")


def identity(conn):
    row = conn.execute("SELECT id FROM maintenance_identity WHERE singleton").fetchone()
    if row is None:
        raise ValueError("archive_gc_identity_missing")
    return str(row["id"])


def candidates(conn, cutoff, limit, ids=None):
    # Both queries are static SQL; plan values only enter bound parameters.
    selection = " AND a.id=ANY(%s::uuid[])" if ids is not None else ""
    parameters = (cutoff, ids, limit) if ids is not None else (cutoff, limit)
    rows = conn.execute(
        "SELECT a.id,a.run_id,a.sha256,a.size,a.created_at "
        "FROM result_archives a JOIN runs r ON r.id=a.run_id WHERE "
        + ELIGIBLE
        + selection
        + " ORDER BY a.created_at,a.id LIMIT %s",
        parameters,
    ).fetchall()
    return [
        {
            "id": str(row["id"]),
            "run_id": str(row["run_id"]),
            "sha256": row["sha256"],
            "size": row["size"],
            "created_at": timestamp(row["created_at"]),
        }
        for row in rows
    ]


def preview(db, *, retention_days=30, limit=100):
    """Record an issued immutable plan; never change archive bytes or run state."""
    bounds(retention_days, limit)
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
                "candidates": candidates(conn, cutoff, limit),
            }
            plan["approval_digest"] = digest(plan)
            conn.execute(
                "INSERT INTO archive_gc_plans(approval_digest,plan) VALUES (%s,%s)",
                (plan["approval_digest"], Jsonb(plan)),
            )
            return plan
    except psycopg.Error:
        raise ValueError("archive_gc_database_unavailable") from None


def apply(db, plan, *, approval_digest):
    """Atomically tombstone exactly the approved, still eligible candidate set."""
    plan = validate_plan(plan, approval_digest)
    try:
        with db.transaction() as conn:
            lock(conn)
            now = conn.execute("SELECT clock_timestamp() AS now").fetchone()["now"]
            if identity(conn) != plan["maintenance_id"]:
                raise ValueError("archive_gc_identity_changed")
            if not parsed_time(plan["created_at"]) <= now < parsed_time(plan["expires_at"]):
                raise ValueError("archive_gc_plan_expired")
            issued = conn.execute(
                "SELECT plan FROM archive_gc_plans WHERE approval_digest=%s", (approval_digest,)
            ).fetchone()
            if issued is None or issued["plan"] != plan:
                raise ValueError("archive_gc_plan_unrecognized")
            saved = conn.execute(
                "SELECT plan,receipt FROM archive_gc_receipts WHERE approval_digest=%s",
                (approval_digest,),
            ).fetchone()
            if saved is not None:
                if saved["plan"] != plan or not receipt_matches(saved["receipt"], plan):
                    raise ValueError("archive_gc_receipt_invalid")
                pruned = conn.execute(
                    "SELECT count(*) AS n FROM result_archives WHERE id=ANY(%s::uuid[]) "
                    "AND payload IS NULL AND pruned_at=%s",
                    (
                        [item["id"] for item in plan["candidates"]],
                        parsed_time(saved["receipt"]["pruned_at"]),
                    ),
                ).fetchone()["n"]
                if pruned != len(plan["candidates"]):
                    raise ValueError("archive_gc_receipt_invalid")
                return saved["receipt"]
            exact_ids = [item["id"] for item in plan["candidates"]]
            actual = candidates(conn, parsed_time(plan["cutoff"]), plan["limit"], exact_ids)
            if actual != plan["candidates"]:
                raise ValueError("archive_gc_candidates_changed")
            # Validate actual immutable bytes one artifact at a time, within the
            # same locks; never gather a possible 100 MiB batch into memory.
            for item in actual:
                payload = conn.execute(
                    "SELECT substring(payload FROM 1 FOR %s) AS payload "
                    "FROM result_archives WHERE id=%s",
                    (ARCHIVE_LIMIT + 1, item["id"]),
                ).fetchone()["payload"]
                if (
                    payload is None
                    or len(payload) != item["size"]
                    or hashlib.sha256(payload).hexdigest() != item["sha256"]
                ):
                    raise ValueError("archive_gc_payload_invalid")
            receipt = {
                "schema_version": SCHEMA_VERSION,
                "approval_digest": approval_digest,
                "maintenance_id": plan["maintenance_id"],
                "pruned_at": timestamp(now),
                "artifact_ids": exact_ids,
                "count": len(exact_ids),
                "total_bytes": sum(item["size"] for item in actual),
            }
            conn.execute(
                "INSERT INTO archive_gc_receipts(approval_digest,plan,receipt) VALUES (%s,%s,%s)",
                (approval_digest, Jsonb(plan), Jsonb(receipt)),
            )
            conn.execute(
                "SELECT set_config('agent_platform.gc_approval',%s,true)", (approval_digest,)
            )
            changed = conn.execute(
                "UPDATE result_archives SET payload=NULL,pruned_at=%s WHERE id=ANY(%s::uuid[])",
                (now, exact_ids),
            ).rowcount
            if changed != len(exact_ids):
                raise ValueError("archive_gc_candidates_changed")
            conn.execute(
                "INSERT INTO audit_events(id,action,target,decision) VALUES "
                "(%s,'archive_gc.apply',%s,'approved')",
                (uuid4(), approval_digest),
            )
            return receipt
    except psycopg.Error:
        raise ValueError("archive_gc_database_unavailable") from None


def receipt_matches(receipt, plan):
    expected = {
        "schema_version": SCHEMA_VERSION,
        "approval_digest": plan["approval_digest"],
        "maintenance_id": plan["maintenance_id"],
        "artifact_ids": [item["id"] for item in plan["candidates"]],
        "count": len(plan["candidates"]),
        "total_bytes": sum(item["size"] for item in plan["candidates"]),
    }
    if not isinstance(receipt, dict) or set(receipt) != set(expected) | {"pruned_at"}:
        return False
    if type(receipt["count"]) is not int or type(receipt["total_bytes"]) is not int:
        return False
    if any(receipt[key] != value for key, value in expected.items()):
        return False
    try:
        when = parsed_time(receipt["pruned_at"])
        return parsed_time(plan["created_at"]) <= when < parsed_time(plan["expires_at"])
    except ValueError:
        return False
