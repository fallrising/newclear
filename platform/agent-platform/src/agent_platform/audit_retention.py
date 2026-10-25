"""Explicit audit-history expiry, retaining only minimal operation evidence."""

import hashlib
import json
import re
from datetime import UTC, datetime, timedelta
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb

from .auth import audit

SCHEMA_VERSION = "audit-gc-v1"
PLAN_LIMIT = 65536
BYTE_LIMIT = 8388608
PLAN_FIELDS = {
    "schema_version",
    "maintenance_id",
    "created_at",
    "expires_at",
    "cutoff",
    "retention_days",
    "limit",
    "byte_limit",
    "candidates",
    "approval_digest",
}
CANDIDATE_FIELDS = {"id", "created_at", "encoded_bytes", "record_sha256"}
LOCK_TABLES = (
    "maintenance_identity,audit_events,audit_gc_plans,audit_gc_receipts,audit_gc_tombstones"
)


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
        raise ValueError("audit_gc_plan_invalid")
    try:
        result = datetime.fromisoformat(value)
        if result.utcoffset() != timedelta(0) or timestamp(result) != value:
            raise ValueError()
        return result
    except ValueError:
        raise ValueError("audit_gc_plan_invalid") from None


def uuid_text(value):
    try:
        if not isinstance(value, str) or len(value) != 36 or str(UUID(value)) != value:
            raise ValueError()
    except ValueError:
        raise ValueError("audit_gc_plan_invalid") from None


def integer(value, low, high):
    return type(value) is int and low <= value <= high


def bounds(retention_days, limit):
    if not integer(retention_days, 90, 36500):
        raise ValueError("audit_gc_retention_invalid")
    if not integer(limit, 1, 100):
        raise ValueError("audit_gc_limit_invalid")


def validate_plan(plan, approval_digest):
    if not isinstance(plan, dict) or set(plan) != PLAN_FIELDS:
        raise ValueError("audit_gc_plan_invalid")
    bounds(plan["retention_days"], plan["limit"])
    if plan["schema_version"] != SCHEMA_VERSION or type(plan["byte_limit"]) is not int:
        raise ValueError("audit_gc_plan_invalid")
    if plan["byte_limit"] != BYTE_LIMIT:
        raise ValueError("audit_gc_plan_invalid")
    uuid_text(plan["maintenance_id"])
    created, expires, cutoff = (
        parsed_time(plan[field]) for field in ("created_at", "expires_at", "cutoff")
    )
    try:
        valid = expires == created + timedelta(hours=1) and cutoff == created - timedelta(
            days=plan["retention_days"]
        )
    except OverflowError:
        valid = False
    if not valid:
        raise ValueError("audit_gc_plan_invalid")
    items = plan["candidates"]
    if not isinstance(items, list) or len(items) > plan["limit"]:
        raise ValueError("audit_gc_plan_invalid")
    order, ids, total = [], set(), 0
    for item in items:
        if not isinstance(item, dict) or set(item) != CANDIDATE_FIELDS:
            raise ValueError("audit_gc_plan_invalid")
        uuid_text(item["id"])
        when = parsed_time(item["created_at"])
        if when >= cutoff or item["id"] in ids or not integer(item["encoded_bytes"], 1, BYTE_LIMIT):
            raise ValueError("audit_gc_plan_invalid")
        if (
            not isinstance(item["record_sha256"], str)
            or re.fullmatch("[a-f0-9]{64}", item["record_sha256"]) is None
        ):
            raise ValueError("audit_gc_plan_invalid")
        order.append((when, item["id"]))
        ids.add(item["id"])
        total += item["encoded_bytes"]
    if order != sorted(order) or total > BYTE_LIMIT:
        raise ValueError("audit_gc_plan_invalid")
    supplied = plan["approval_digest"]
    if (
        not isinstance(supplied, str)
        or re.fullmatch("[a-f0-9]{64}", supplied) is None
        or type(approval_digest) is not str
        or approval_digest != supplied
        or digest({key: value for key, value in plan.items() if key != "approval_digest"})
        != supplied
    ):
        raise ValueError("audit_gc_approval_invalid")
    raw = canonical(plan)
    if len(raw) > PLAN_LIMIT:
        raise ValueError("audit_gc_plan_invalid")
    return json.loads(raw)


def lock(conn):
    conn.execute("SELECT pg_advisory_xact_lock(77310401)")
    conn.execute("SELECT pg_advisory_xact_lock(77310402)")
    conn.execute("LOCK TABLE " + LOCK_TABLES + " IN EXCLUSIVE MODE NOWAIT")


def identity(conn):
    row = conn.execute("SELECT id FROM maintenance_identity WHERE singleton").fetchone()
    if row is None:
        raise ValueError("audit_gc_identity_missing")
    return str(row["id"])


def _lengths(conn, cutoff, limit, ids=None):
    selection = " AND id=ANY(%s::uuid[])" if ids is not None else ""
    parameters = (cutoff, ids, limit) if ids is not None else (cutoff, limit)
    return conn.execute(
        "SELECT id,actor,created_at,target IS NULL AS target_null,"
        "octet_length(convert_to(action,'UTF8')) AS action_bytes,"
        "coalesce(octet_length(convert_to(target,'UTF8')),0) AS target_bytes,"
        "octet_length(convert_to(decision,'UTF8')) AS decision_bytes FROM audit_events "
        "WHERE created_at<%s" + selection + " ORDER BY created_at,id LIMIT %s",
        parameters,
    ).fetchall()


def _upper(row):
    return 6 * (row["action_bytes"] + row["target_bytes"] + row["decision_bytes"]) + 512


def _record(conn, row):
    sizes = [row[field] for field in ("action_bytes", "target_bytes", "decision_bytes")]
    values = conn.execute(
        "SELECT substring(convert_to(action,'UTF8') FROM 1 FOR %s) AS action,"
        "substring(convert_to(target,'UTF8') FROM 1 FOR %s) AS target,"
        "substring(convert_to(decision,'UTF8') FROM 1 FOR %s) AS decision "
        "FROM audit_events WHERE id=%s",
        (*sizes, row["id"]),
    ).fetchone()
    if values is None:
        raise ValueError("audit_gc_candidates_changed")
    decoded = {}
    for (key, value), length in zip(values.items(), sizes, strict=True):
        if key == "target" and row["target_null"] and value is None:
            decoded[key] = None
        elif value is None or len(value) != length:
            raise ValueError("audit_gc_candidates_changed")
        else:
            decoded[key] = bytes(value).decode("utf-8")
    return {
        "id": str(row["id"]),
        "actor": str(row["actor"]) if row["actor"] is not None else None,
        "created_at": timestamp(row["created_at"]),
        **decoded,
    }


def candidates(conn, cutoff, limit, ids=None):
    rows = _lengths(conn, cutoff, limit, ids)
    result, reserved = [], 0
    for row in rows:
        upper = _upper(row)
        if reserved + upper > BYTE_LIMIT:
            continue
        reserved += upper
        raw = canonical(_record(conn, row))
        if len(raw) > upper:
            raise ValueError("audit_gc_candidates_changed")
        result.append(
            {
                "id": str(row["id"]),
                "created_at": timestamp(row["created_at"]),
                "encoded_bytes": len(raw),
                "record_sha256": hashlib.sha256(raw).hexdigest(),
            }
        )
    return result


def preview(db, *, retention_days=90, limit=100):
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
                "byte_limit": BYTE_LIMIT,
                "candidates": candidates(conn, cutoff, limit),
            }
            plan["approval_digest"] = digest(plan)
            validate_plan(plan, plan["approval_digest"])
            conn.execute(
                "INSERT INTO audit_gc_plans(approval_digest,plan) VALUES (%s,%s)",
                (plan["approval_digest"], Jsonb(plan)),
            )
            return plan
    except psycopg.Error:
        raise ValueError("audit_gc_database_unavailable") from None


def _receipt(plan, when):
    return {
        "schema_version": SCHEMA_VERSION,
        "approval_digest": plan["approval_digest"],
        "maintenance_id": plan["maintenance_id"],
        "pruned_at": timestamp(when),
        "candidates": plan["candidates"],
        "count": len(plan["candidates"]),
        "total_encoded_bytes": sum(item["encoded_bytes"] for item in plan["candidates"]),
    }


def _replay(conn, plan, saved):
    receipt = saved["receipt"]
    if not isinstance(receipt, dict) or canonical(saved["plan"]) != canonical(plan):
        raise ValueError("audit_gc_receipt_invalid")
    try:
        when = parsed_time(receipt.get("pruned_at"))
        valid = parsed_time(plan["created_at"]) <= when < parsed_time(
            plan["expires_at"]
        ) and canonical(receipt) == canonical(_receipt(plan, when))
    except (ValueError, TypeError, RecursionError):
        valid = False
    if not valid:
        raise ValueError("audit_gc_receipt_invalid")
    ids = [item["id"] for item in plan["candidates"]]
    if conn.execute(
        "SELECT 1 FROM audit_events WHERE id=ANY(%s::uuid[]) LIMIT 1", (ids,)
    ).fetchone():
        raise ValueError("audit_gc_receipt_invalid")
    rows = conn.execute(
        "SELECT id,approval_digest,created_at,record_sha256,encoded_bytes,pruned_at "
        "FROM audit_gc_tombstones WHERE id=ANY(%s::uuid[]) ORDER BY created_at,id",
        (ids,),
    ).fetchall()
    actual = [
        {
            "id": str(row["id"]),
            "approval_digest": row["approval_digest"],
            "created_at": timestamp(row["created_at"]),
            "record_sha256": row["record_sha256"],
            "encoded_bytes": row["encoded_bytes"],
            "pruned_at": timestamp(row["pruned_at"]),
        }
        for row in rows
    ]
    expected = [
        {
            **item,
            "approval_digest": plan["approval_digest"],
            "pruned_at": receipt["pruned_at"],
        }
        for item in plan["candidates"]
    ]
    if actual != expected:
        raise ValueError("audit_gc_receipt_invalid")
    return receipt


def apply(db, plan, *, approval_digest):
    plan = validate_plan(plan, approval_digest)
    try:
        with db.transaction() as conn:
            lock(conn)
            now = conn.execute("SELECT clock_timestamp() AS now").fetchone()["now"]
            if identity(conn) != plan["maintenance_id"]:
                raise ValueError("audit_gc_identity_changed")
            if not parsed_time(plan["created_at"]) <= now < parsed_time(plan["expires_at"]):
                raise ValueError("audit_gc_plan_expired")
            issued = conn.execute(
                "SELECT plan FROM audit_gc_plans WHERE approval_digest=%s",
                (approval_digest,),
            ).fetchone()
            if issued is None or canonical(issued["plan"]) != canonical(plan):
                raise ValueError("audit_gc_plan_unrecognized")
            saved = conn.execute(
                "SELECT plan,receipt FROM audit_gc_receipts WHERE approval_digest=%s",
                (approval_digest,),
            ).fetchone()
            if saved is not None:
                return _replay(conn, plan, saved)
            ids = [item["id"] for item in plan["candidates"]]
            actual = candidates(conn, parsed_time(plan["cutoff"]), plan["limit"], ids)
            if actual != plan["candidates"]:
                raise ValueError("audit_gc_candidates_changed")
            receipt = _receipt(plan, now)
            conn.execute(
                "INSERT INTO audit_gc_receipts(approval_digest,plan,receipt,created_at) "
                "VALUES (%s,%s,%s,%s)",
                (approval_digest, Jsonb(plan), Jsonb(receipt), now),
            )
            conn.execute(
                "SELECT set_config('agent_platform.audit_gc_approval',%s,true)",
                (approval_digest,),
            )
            for item in actual:
                conn.execute(
                    "INSERT INTO audit_gc_tombstones(id,approval_digest,created_at,"
                    "record_sha256,encoded_bytes,pruned_at) "
                    "VALUES (%s,%s,%s,%s,%s,%s)",
                    (
                        item["id"],
                        approval_digest,
                        parsed_time(item["created_at"]),
                        item["record_sha256"],
                        item["encoded_bytes"],
                        now,
                    ),
                )
            changed = conn.execute(
                "DELETE FROM audit_events WHERE id=ANY(%s::uuid[])", (ids,)
            ).rowcount
            if changed != len(ids):
                raise ValueError("audit_gc_candidates_changed")
            audit(conn, None, "audit_gc.apply", approval_digest)
            return receipt
    except psycopg.Error:
        raise ValueError("audit_gc_database_unavailable") from None
