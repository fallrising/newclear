"""Graceful tool admission barrier, independently attested guest quiescence.

The SDK's native paused status is not a completion proof. AlwaysConfirm closes
future terminal admission; waiting/finished plus a stable guest process baseline
prove that the current supported terminal batch has drained.
"""

from datetime import UTC, datetime
from urllib.parse import urlencode

from agent_platform_m0.contracts import OPENHANDS_SHA, OPENHANDS_VERSION

from .connector_recovery import observe_sandbox
from .domain import Problem

PROOF_KEYS = {"admission_closed", "at_tool_boundary", "same_boot", "same_processes"}


def paused(value):
    proof = value.get("proof", {})
    return (
        value.get("state") == "paused"
        and set(proof) == PROOF_KEYS
        and all(v is True for v in proof.values())
    )


def boundary(service, row, http, path):
    before = service.conversation(row, http)
    if before.get("confirmation_policy") != {"kind": "AlwaysConfirm"}:
        raise Problem(409, "pause_admission_not_closed")
    proof = dict.fromkeys(PROOF_KEYS, False)
    proof["admission_closed"] = True
    if before.get("execution_status") not in {"waiting_for_confirmation", "finished"}:
        return {"state": "pausing", "proof": proof}
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
    ids = [e["id"] for e in history]
    if len(ids) != len(set(ids)):
        raise Problem(409, "backend_duplicate_event")
    # Never infer completion from a soft timeout or missing exit status. Only the
    # pinned terminal tool is supported; conservatively retain ambiguous history.
    for item in history:
        if item.get("kind") == "ActionEvent" and item.get("tool_name") not in {
            "terminal",
            "finish",
            "think",
        }:
            raise Problem(409, "pause_tool_unsupported")
        observation = item.get("observation", {})
        if observation.get("kind") == "TerminalObservation":
            code = observation.get("exit_code")
            if type(code) is not int or code == -1 or observation.get("timeout"):
                return {"state": "pausing", "proof": proof}
    proof["at_tool_boundary"] = True
    baseline = row.get("guest_baseline")
    if not baseline:
        raise Problem(409, "pause_baseline_missing")
    observed = service.quiescence(row, baseline)
    proof.update({key: observed.get(key) is True for key in ("same_boot", "same_processes")})
    after = service.conversation(row, http)
    for value in (before, after):
        if value.get("id") != row["run_id"]:
            raise Problem(409, "pause_conversation_mismatch")
    if any(
        before.get(k) != after.get(k)
        for k in ("execution_status", "confirmation_policy", "leaf_event_id")
    ):
        raise Problem(409, "pause_boundary_changed")
    return {
        "state": "paused" if all(proof.values()) else "pausing",
        "proof": proof,
        "backend_state": after["execution_status"],
    }


def control(service, run_id, request):
    from .connector import fingerprint

    with service.journal.locked(run_id):
        row = service.require(run_id, request.generation)
        service.guard(row, controlling=True)
        if datetime.fromisoformat(row["input"]["deadline"]) <= datetime.now(UTC):
            raise Problem(409, "run_deadline_expired")
        if observe_sandbox(service, row):
            raise Problem(409, "pause_runtime_stopped")
        # An uncertain prompt/approval may still be in flight. Never give it a
        # second admission opportunity or declare it quiescent.
        if any(
            op["state"] != "completed"
            for name, op in row["operations"].items()
            if not name.startswith("control:")
        ):
            raise Problem(409, "connector_operation_uncertain")
        if row["operations"].get("prompt", {}).get("state") != "completed":
            raise Problem(409, "pause_prompt_unconfirmed")
        pause_id, command_id = str(request.pause_id), str(request.command_id)
        original = (
            "AlwaysConfirm"
            if row["input"].get("require_approval") or row["input"].get("model_transport")
            else "NeverConfirm"
        )
        record = row.get("pause")
        if request.action == "pause":
            if command_id != pause_id:
                raise Problem(409, "pause_command_mismatch")
            if not record or record["id"] != pause_id:
                if record and record["hold"]:
                    raise Problem(409, "pause_already_requested")
                record = {"id": pause_id, "hold": True, "original_policy": original}
                row["pause"] = record
                service.journal.write(row)
            if not record["hold"] or record.get("resume_command"):
                raise Problem(409, "pause_already_resumed")
        elif not record or record["id"] != pause_id:
            raise Problem(409, "pause_intent_missing")

        with service.relay(row) as http:
            path = "/api/conversations/" + row["run_id"]
            info = http.expect("GET", "/server_info")
            if (
                info.get("build_git_sha") != OPENHANDS_SHA
                or info.get("version") != OPENHANDS_VERSION
            ):
                raise Problem(409, "agent_version_mismatch")
            if request.action == "pause":
                key = "control:" + pause_id + ":gate"
                current = service.conversation(row, http)
                old = row["operations"].get(key)
                # This exact idempotent policy write is reconciled by observation.
                # Only this connector can change the policy. No /run is replayed.
                if (
                    old
                    and old["state"] == "started"
                    and current.get("confirmation_policy") == {"kind": "AlwaysConfirm"}
                ):
                    old.update(state="completed", result={"admission_closed": True})
                    service.journal.write(row)

                def close_admission():
                    service.guard(row, controlling=True)
                    if original != "AlwaysConfirm":
                        http.expect(
                            "POST",
                            path + "/confirmation_policy",
                            {"policy": {"kind": "AlwaysConfirm"}},
                        )
                    return {"admission_closed": True}

                service.journal.operation(
                    row, key, fingerprint({"pause_id": pause_id}), close_admission
                )
                result = boundary(service, row, http, path)
                if paused(result):
                    record["confirmed"] = True
                    service.journal.write(row)
                return result

            if not record.get("confirmed"):
                raise Problem(409, "pause_not_confirmed")
            if record.get("resume_command") not in {None, command_id}:
                raise Problem(409, "resume_command_mismatch")
            key = "control:" + command_id + ":resume"
            if key not in row["operations"]:
                if not paused(boundary(service, row, http, path)):
                    raise Problem(409, "resume_quiescence_unconfirmed")
                record["resume_command"] = command_id
                service.journal.write(row)

            def resume():
                service.guard(row, controlling=True)
                if datetime.fromisoformat(row["input"]["deadline"]) <= datetime.now(UTC):
                    raise Problem(409, "run_deadline_expired")
                state = service.conversation(row, http)["execution_status"]
                if state not in {"waiting_for_confirmation", "finished"}:
                    raise Problem(409, "resume_boundary_changed")
                if original == "NeverConfirm":
                    http.expect(
                        "POST", path + "/confirmation_policy", {"policy": {"kind": original}}
                    )
                    if state == "waiting_for_confirmation":
                        if datetime.fromisoformat(row["input"]["deadline"]) <= datetime.now(UTC):
                            raise Problem(409, "run_deadline_expired")
                        service.guard(row, controlling=True)
                        http.expect("POST", path + "/run")
                # AlwaysConfirm deliberately leaves the pending batch for a new
                # generation-bound human approval. /run would implicitly approve it.
                return {"state": "resumed", "pause_id": pause_id, "command_id": command_id}

            result = service.journal.operation(
                row, key, fingerprint({"pause_id": pause_id}), resume
            )
            current = service.conversation(row, http)
            allowed = (
                {"running", "finished"}
                if original == "NeverConfirm"
                else {"waiting_for_confirmation", "finished"}
            )
            if (
                current.get("confirmation_policy") != {"kind": original}
                or current.get("execution_status") not in allowed
            ):
                return {**result, "state": "resuming"}
            record["hold"] = False
            service.journal.write(row)
            return result
