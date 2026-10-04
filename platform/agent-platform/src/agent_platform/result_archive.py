"""Bounded, immutable result snapshots; never reconstruct downloads from runs.result."""

import hashlib
import json
import re
from uuid import NAMESPACE_URL, UUID, uuid5

from .domain import Problem
from .result_download import diff_bytes

ARCHIVE_LIMIT = 1024 * 1024
SCHEMA_VERSION = "result-archive-v1"
MIME = "application/json"
METADATA = "id,run_id,kind,sha256,size,mime,created_at"
RESULT_TEXT = {"execution_mode", "summary", "workspace_value"}
VERIFICATION_TEXT = {"status", "name", "reason", "revision", "contract_sha256", "diff_sha256"}
CHECK_TEXT = {"id", "status", "reason", "output_sha256"}
CHECK_INTS = {"exit_code", "duration_ms", "output_bytes"}


def invalid():
    return Problem(409, "artifact_invalid")


def text(value):
    if not isinstance(value, str) or len(value) > ARCHIVE_LIMIT:
        raise invalid()
    return value


def fields(value, strings, integers=()):
    if not isinstance(value, dict):
        raise invalid()
    output = {key: text(value[key]) for key in strings if key in value}
    for key in integers:
        if key in value:
            number = value[key]
            if number is not None and (type(number) is not int or not -(2**63) <= number < 2**63):
                raise invalid()
            output[key] = number
    return output


def result_snapshot(run, result):
    if not isinstance(result, dict):
        raise invalid()
    output = fields(result, RESULT_TEXT - {"workspace_value"})
    if "workspace_value" in result:
        output["workspace_value"] = (
            None if result["workspace_value"] is None else text(result["workspace_value"])
        )
    verification = result.get("verification")
    verified = fields(verification, VERIFICATION_TEXT, {"exit_code"})
    if verified.get("status") not in {"passed", "failed", "unknown", "not_run"}:
        raise invalid()
    if "checks" in verification:
        checks = verification["checks"]
        if not isinstance(checks, list) or len(checks) > 8:
            raise invalid()
        verified["checks"] = [fields(check, CHECK_TEXT, CHECK_INTS) for check in checks]
    output["verification"] = verified
    if "diff" in result:
        diff_bytes({"base_sha": run["base_sha"], "result": result})
        output.update(
            {key: result[key] for key in ("diff", "diff_bytes", "diff_sha256", "base_sha")}
        )
    elif any(key in result for key in ("diff_bytes", "diff_sha256", "base_sha")):
        raise invalid()
    return output


def archive_id(run_id):
    return uuid5(NAMESPACE_URL, f"agent-platform:{SCHEMA_VERSION}:{UUID(str(run_id))}")


def serialize(run, result):
    """Canonical JSON with a fixed allowlist and bounded encoding work."""
    try:
        if (
            type(run["attempt_no"]) is not int
            or run["attempt_no"] < 1
            or re.fullmatch(r"(?:[a-f0-9]{40}|[a-f0-9]{64})", run["base_sha"]) is None
            or not isinstance(run["goal"], str)
            or not 1 <= len(run["goal"]) <= 20000
        ):
            raise invalid()
        value = {
            "schema_version": SCHEMA_VERSION,
            "artifact_id": str(archive_id(run["id"])),
            "run_id": str(UUID(str(run["id"]))),
            "task_id": str(UUID(str(run["task_id"]))),
            "attempt_no": run["attempt_no"],
            "base_sha": run["base_sha"],
            "profile_revision": str(UUID(str(run["profile_revision"]))),
            "goal": run["goal"],
            "result": result_snapshot(run, result),
        }
        payload = bytearray()
        encoder = json.JSONEncoder(
            ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
        )
        for chunk in encoder.iterencode(value):
            encoded = chunk.encode("utf-8")
            if len(payload) + len(encoded) > ARCHIVE_LIMIT:
                raise invalid()
            payload.extend(encoded)
        return bytes(payload)
    except (KeyError, TypeError, ValueError, UnicodeError, RecursionError):
        raise invalid() from None


def persist_archive(conn, run, result):
    """Caller owns the same transaction as result storage and terminal transition."""
    payload = serialize(run, result)
    digest = hashlib.sha256(payload).hexdigest()
    row = conn.execute(
        f"INSERT INTO result_archives(id,run_id,payload,sha256,size) VALUES (%s,%s,%s,%s,%s) "
        f"ON CONFLICT(run_id) DO NOTHING RETURNING {METADATA}",
        (archive_id(run["id"]), run["id"], payload, digest, len(payload)),
    ).fetchone()
    if row:
        return row
    row = conn.execute(
        f"SELECT {METADATA},substring(payload FROM 1 FOR %s) AS payload "
        "FROM result_archives WHERE run_id=%s",
        (ARCHIVE_LIMIT + 1, run["id"]),
    ).fetchone()
    if (
        row["payload"] != payload
        or row["sha256"] != digest
        or row["size"] != len(payload)
        or row["id"] != archive_id(run["id"])
        or row["mime"] != MIME
        or row["kind"] != "result"
    ):
        raise Problem(409, "artifact_immutable")
    return {key: value for key, value in row.items() if key != "payload"}


def require_run(conn, run_id):
    run = conn.execute(
        "SELECT id,task_id,attempt_no,base_sha,profile_revision,goal FROM runs WHERE id=%s",
        (run_id,),
    ).fetchone()
    if run is None:
        raise Problem(404, "run_not_found")
    return run


def list_archives(db, run_id):
    with db.transaction() as conn:
        require_run(conn, run_id)
        return {
            "items": conn.execute(
                f"SELECT {METADATA} FROM result_archives WHERE run_id=%s", (run_id,)
            ).fetchall()
        }


def read_archive(db, run_id, artifact_id):
    with db.transaction() as conn:
        run = require_run(conn, run_id)
        row = conn.execute(
            f"SELECT {METADATA},substring(payload FROM 1 FOR %s) AS payload FROM result_archives "
            "WHERE run_id=%s AND id=%s",
            (ARCHIVE_LIMIT + 1, run_id, artifact_id),
        ).fetchone()
    if row is None:
        raise Problem(404, "artifact_not_found")
    payload = row["payload"]
    if (
        not 0 < len(payload) <= ARCHIVE_LIMIT
        or row["size"] != len(payload)
        or row["sha256"] != hashlib.sha256(payload).hexdigest()
        or row["mime"] != MIME
        or row["kind"] != "result"
        or row["id"] != archive_id(run_id)
    ):
        raise invalid()
    try:
        value = json.loads(payload)
        if not isinstance(value, dict) or serialize(run, value["result"]) != payload:
            raise invalid()
    except (KeyError, TypeError, ValueError, UnicodeError, RecursionError):
        raise invalid() from None
    return payload
