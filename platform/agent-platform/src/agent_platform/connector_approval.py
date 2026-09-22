"""Approval of the exact pending batch on a private, single-writer conversation."""

import hashlib
import json
from datetime import UTC, datetime
from urllib.parse import urlencode

from .domain import Problem

POLICY = "always-confirm-v1"


def pending_approval(service, row):
    if not row["input"].get("require_approval"):
        raise Problem(409, "approval_policy_mismatch")
    with service.relay(row) as http:
        path = "/api/conversations/" + row["run_id"]
        before = service.conversation(row, http)
        history, page_id, seen = [], None, set()
        for _ in range(100):
            query = {"limit": 100}
            if page_id:
                query["page_id"] = page_id
            page = http.expect("GET", path + "/events/search?" + urlencode(query))
            history.extend(page["items"])
            page_id = page.get("next_page_id")
            if not page_id:
                break
            if page_id in seen:
                raise Problem(409, "backend_pagination_cycle")
            seen.add(page_id)
        else:
            raise Problem(409, "backend_history_limit")
        after = service.conversation(row, http)
    for value in (before, after):
        if (
            value.get("id") != row["run_id"]
            or value.get("execution_status") != "waiting_for_confirmation"
            or value.get("confirmation_policy") != {"kind": "AlwaysConfirm"}
        ):
            raise Problem(409, "approval_backend_not_waiting")
    if before.get("leaf_event_id") != after.get("leaf_event_id"):
        raise Problem(409, "approval_history_changed")
    ids = [item["id"] for item in history]
    if len(ids) != len(set(ids)):
        raise Problem(409, "backend_duplicate_event")
    observed, errors, pending = set(), set(), []
    # Mirror the pinned SDK's get_unmatched_actions, preserving complete action params.
    for item in reversed(history):
        kind = item.get("kind")
        if kind in {"ObservationEvent", "UserRejectObservation"}:
            observed.add(item["action_id"])
        elif kind == "AgentErrorEvent":
            errors.add(item["tool_call_id"])
        elif kind == "ActionEvent" and item.get("action") is not None:
            if item["id"] not in observed and item["tool_call_id"] not in errors:
                if item.get("tool_name") != "terminal":
                    raise Problem(409, "approval_tool_unsupported")
                pending.insert(
                    0, {k: item[k] for k in ("id", "tool_name", "tool_call_id", "action")}
                )
    if not pending or len(pending) > 16:
        raise Problem(409, "approval_batch_invalid")
    normalized = {
        "run_id": row["run_id"],
        "generation": row["generation"],
        "policy_revision": POLICY,
        "actions": pending,
    }
    raw = json.dumps(normalized, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    if len(raw.encode()) > 32768:
        raise Problem(409, "approval_batch_too_large")
    if any(secret in raw for secret in (row["session_key"], row["handle"]["token"], service.token)):
        raise Problem(409, "approval_sensitive_parameters")
    return {
        "action_digest": hashlib.sha256(raw.encode()).hexdigest(),
        "normalized_action": normalized,
        "policy_revision": POLICY,
    }


def approve(service, run_id, request):
    from .connector import fingerprint
    from .connector_recovery import observe_sandbox

    with service.journal.locked(run_id):
        row = service.require(run_id, request.generation)
        service.guard(row)
        if request.expires_at.tzinfo is None:
            raise Problem(422, "approval_expiry_requires_timezone")

        operation = "approval:" + str(request.approval_id)
        if operation not in row["operations"]:
            if observe_sandbox(service, row):
                raise Problem(409, "approval_runtime_stopped")
            actual = pending_approval(service, row)
            if actual["action_digest"] != request.action_digest:
                raise Problem(409, "approval_action_changed")
            if min(
                request.expires_at, datetime.fromisoformat(row["input"]["deadline"])
            ) <= datetime.now(UTC):
                raise Problem(409, "approval_expired")

        def effect():
            service.guard(row)
            if request.expires_at <= datetime.now(UTC):
                raise Problem(409, "approval_expired")
            with service.relay(row) as http:
                http.expect(
                    "POST",
                    "/api/conversations/" + row["run_id"] + "/events/respond_to_confirmation",
                    {"accept": True},
                )
            return {
                "accepted": True,
                "approval_id": str(request.approval_id),
                "action_digest": request.action_digest,
            }

        return service.journal.operation(
            row,
            operation,
            fingerprint(request.model_dump(mode="json")),
            effect,
        )
