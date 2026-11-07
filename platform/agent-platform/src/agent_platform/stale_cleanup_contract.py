"""Bounded, strict identities shared by the private maintenance boundary."""

import hashlib
import json
import re
from datetime import UTC, datetime, timedelta
from uuid import UUID

from .domain import Problem

PLAN_LIMIT = 65536
JOURNAL_LIMIT = 8 * 1024 * 1024
PLAN_FIELDS = {
    "schema_version",
    "attempt_id",
    "maintenance_id",
    "connector_cleanup_identity",
    "created_at",
    "expires_at",
    "run_id",
    "job_id",
    "binding_id",
    "node_id",
    "current_generation",
    "next_generation",
    "state_version",
    "terminal_state",
    "provider_handle",
    "claim_ref",
    "archive_id",
    "archive_sha256",
    "ownership_digest",
    "precondition_digest",
    "action",
    "approval_digest",
}


def fail(code="invalid"):
    raise Problem(409, "stale_cleanup_" + code)


def canonical(value, limit=PLAN_LIMIT):
    try:
        raw = json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False
        ).encode("utf-8")
        if len(raw) > limit:
            fail("oversized")
        return raw
    except (TypeError, ValueError, UnicodeError, RecursionError):
        fail()


def digest(value):
    return hashlib.sha256(canonical(value, JOURNAL_LIMIT)).hexdigest()


def timestamp(value):
    return value.astimezone(UTC).isoformat(timespec="microseconds")


def parsed_time(value):
    try:
        parsed = datetime.fromisoformat(value)
        if (
            type(value) is not str
            or parsed.utcoffset() != timedelta(0)
            or timestamp(parsed) != value
        ):
            fail()
        return parsed
    except (ValueError, TypeError, OverflowError):
        fail()


def uuid_text(value):
    try:
        if type(value) is not str or str(UUID(value)) != value:
            fail()
    except (ValueError, TypeError, AttributeError):
        fail()
    return value


def hash_text(value):
    if type(value) is not str or not re.fullmatch(r"[0-9a-f]{64}", value):
        fail()


def validate_plan(value, approval_digest=None):
    if type(value) is not dict or set(value) != PLAN_FIELDS:
        fail()
    canonical(value)
    if value["schema_version"] != "stale-cleanup-v1" or value["action"] != "release-owned":
        fail()
    for key in (
        "attempt_id",
        "maintenance_id",
        "connector_cleanup_identity",
        "run_id",
        "job_id",
        "binding_id",
        "archive_id",
    ):
        uuid_text(value[key])
    for key in ("archive_sha256", "ownership_digest", "precondition_digest", "approval_digest"):
        hash_text(value[key])
    for key in ("current_generation", "next_generation", "state_version"):
        if type(value[key]) is not int or not 1 <= value[key] < 2**31:
            fail()
    if (
        value["next_generation"] != value["current_generation"] + 1
        or value["terminal_state"] not in {"succeeded", "failed"}
        or value["node_id"] != "cocoon-local"
    ):
        fail()
    for key in ("provider_handle", "claim_ref"):
        if type(value[key]) is not str or not 1 <= len(value[key]) <= 256:
            fail()
    created, expires = parsed_time(value["created_at"]), parsed_time(value["expires_at"])
    try:
        if expires != created + timedelta(hours=1):
            fail()
    except OverflowError:
        fail()
    expected = digest({k: v for k, v in value.items() if k != "approval_digest"})
    if expected != value["approval_digest"] or (
        approval_digest is not None and approval_digest != expected
    ):
        fail("approval_mismatch")
    return json.loads(canonical(value))


def require_time(plan, now):
    if not parsed_time(plan["created_at"]) <= now < parsed_time(plan["expires_at"]):
        fail("expired")


def loads(raw, limit=PLAN_LIMIT):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                fail()
            result[key] = value
        return result

    def constant(value):
        fail()

    try:
        if len(raw) > limit:
            fail("oversized")
        value = json.loads(raw, object_pairs_hook=unique, parse_constant=constant)
        canonical(value, limit)
        return value
    except (ValueError, TypeError, UnicodeError, RecursionError):
        fail()
