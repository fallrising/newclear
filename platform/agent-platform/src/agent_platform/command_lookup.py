"""CU-M3-U01: positive-only command evidence; never command admission or dispatch."""

import hashlib
import json
from uuid import UUID

from pydantic import ValidationError

from .domain import Problem, TaskInput
from .review import ReviewInput, ReworkInput

LIMIT = 2 * 1024 * 1024


def canonical_id(value):
    try:
        if not isinstance(value, str) or str(UUID(value)) != value:
            raise ValueError
        return value
    except (ValueError, TypeError, AttributeError):
        raise Problem(422, "canonical_uuid_required") from None


def lookup(db, operator, key, source=None, action=None):
    canonical_id(key)
    if source is None:
        route = "tasks.create"
    else:
        canonical_id(source)
        if action not in {"reviews", "rework"}:
            raise Problem(404, "command_not_found")
        route = f"runs/{source}/{action}"
    with db.transaction() as conn:
        conn.execute("SET TRANSACTION READ ONLY")
        row = conn.execute(
            "SELECT status,payload_hash,run_id,CASE WHEN octet_length(result::text)<=%s "
            "THEN result END AS result FROM commands "
            "WHERE operator_id=%s AND route=%s AND idempotency_key=%s",
            (LIMIT, operator, route, key),
        ).fetchone()
    if row is None:
        raise Problem(404, "command_not_found")
    if row["status"] != "completed":
        raise Problem(409, "command_unconfirmed")
    try:
        result = row["result"]
        if result["status"] != 202:
            raise ValueError
        receipt = result["body"]
        run, task = receipt["run"], receipt["task"]
        if (
            str(UUID(run["id"])) != run["id"]
            or str(row["run_id"]) != run["id"]
            or str(UUID(task["id"])) != task["id"]
            or run["task_id"] != task["id"]
            or task["created_by"] != str(operator)
        ):
            raise ValueError
        if source is None:
            payload = TaskInput.model_validate(
                {
                    **{k: task[k] for k in ("project_id", "title")},
                    **{k: run[k] for k in ("base_sha", "profile_revision", "goal")},
                }
            )
        elif action == "reviews":
            context = run["review_context"]
            if (
                run["purpose"] != "review"
                or context["writer_run_id"] != source
                or context["reviewer_profile_revision"] != run["profile_revision"]
            ):
                raise ValueError
            payload = ReviewInput.model_validate(
                {
                    **{k: context[k] for k in ("artifact_id", "candidate_sha256")},
                    "profile_revision": run["profile_revision"],
                }
            )
        else:
            if run["purpose"] != "coding" or run["rework_context"]["review_run_id"] != source:
                raise ValueError
            payload = ReworkInput()
        request = payload.model_dump(mode="json")
        digest = hashlib.sha256(
            json.dumps(request, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        if digest != row["payload_hash"]:
            raise ValueError
        evidence = {
            "version": "fanz-command-evidence-v1",
            "key": key,
            "route": route,
            "payload_hash": digest,
            "request": request,
            "receipt": receipt,
        }
        if len(json.dumps(evidence).encode()) > LIMIT:
            raise ValueError
        return evidence
    except (KeyError, TypeError, ValueError, AttributeError, ValidationError):
        raise Problem(409, "command_evidence_invalid") from None
