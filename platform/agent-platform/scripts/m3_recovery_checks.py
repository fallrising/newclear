"""Strict evidence and owned-process barriers for opt-in recovery acceptance."""

import json
import os
import signal
import subprocess
import time
from pathlib import Path

EXPECTED_KEYS = {"pid", "start_ticks", "nonce", "case", "run_id"}
CASES = ("normal", "model-reserved", "model-response", "broker-delivered", "result-before-save")


def require(value, code):
    if not value:
        raise RuntimeError(code)


def process_identity(pid):
    require(type(pid) is int and pid > 0, "process_identity_invalid")
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
        return {"pid": pid, "start_ticks": int(fields[19]), "state": fields[0]}
    except (OSError, ValueError, IndexError):
        raise RuntimeError("process_identity_unavailable") from None


def stop_at_barrier(path, record):
    """Atomically publish a private boundary then stop every thread in this process."""
    path = Path(path)
    identity = process_identity(os.getpid())
    payload = {
        **record,
        "pid": identity["pid"],
        "start_ticks": identity["start_ticks"],
        "phase": "held",
    }
    temporary = path.with_name(path.name + f".{identity['pid']}.tmp")
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as stream:
            json.dump(payload, stream, default=str)
            stream.flush()
            os.fsync(stream.fileno())
        # Linking an already fsynced file is atomic and refuses an existing barrier.
        os.link(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    os.kill(identity["pid"], signal.SIGSTOP)
    raise RuntimeError("barrier_resumed")


def wait_stopped_barrier(child, path, *, expected, timeout=30):
    require(
        set(expected) == EXPECTED_KEYS
        and expected["pid"] == child.pid
        and all(type(expected[key]) is int and expected[key] > 0 for key in ("pid", "start_ticks"))
        and all(
            type(expected[key]) is str and expected[key] for key in ("nonce", "case", "run_id")
        ),
        "barrier_expected_invalid",
    )
    require(type(timeout) in {int, float} and 0 < timeout <= 240, "barrier_timeout_invalid")
    deadline = time.monotonic() + timeout
    path = Path(path)
    while True:
        require(child.poll() is None, "barrier_child_exited")
        identity = process_identity(child.pid)
        require(
            identity["start_ticks"] == expected["start_ticks"], "barrier_process_identity_mismatch"
        )
        if path.exists():
            try:
                record = json.loads(path.read_text())
            except (OSError, ValueError):
                raise RuntimeError("barrier_record_invalid") from None
            require(
                isinstance(record, dict)
                and record.get("phase") == "held"
                and all(
                    type(record.get(key)) is type(value) and record[key] == value
                    for key, value in expected.items()
                ),
                "barrier_identity_mismatch",
            )
            if identity["state"] in {"T", "t"}:
                return {"barrier": record, "observed_state": identity["state"], **expected}
        require(time.monotonic() < deadline, "barrier_not_stopped")
        time.sleep(0.02)


def kill_at_barrier(child, path, *, expected, timeout=30):
    proof = wait_stopped_barrier(child, path, expected=expected, timeout=timeout)
    # Recheck PID reuse/stopped state immediately before signaling this owned Popen.
    identity = process_identity(child.pid)
    require(
        identity["start_ticks"] == expected["start_ticks"] and identity["state"] in {"T", "t"},
        "barrier_process_identity_mismatch",
    )
    child.kill()
    try:
        returncode = child.wait(timeout=min(timeout, 10))
    except subprocess.TimeoutExpired:
        raise RuntimeError("barrier_kill_timeout") from None
    require(type(returncode) is int and returncode == -signal.SIGKILL, "barrier_kill_unconfirmed")
    return {**proof, "returncode": returncode}


def integer(value, code="count_evidence_invalid"):
    require(type(value) is int and value >= 0, code)
    return value


def timestamp(value):
    from datetime import datetime

    try:
        result = datetime.fromisoformat(value)
        require(result.tzinfo is not None, "timestamp_evidence_invalid")
        return result
    except (ValueError, TypeError):
        raise RuntimeError("timestamp_evidence_invalid") from None


def validate_case(value, combined):
    """Accept literal native recovery states; never normalize uncertainty into success."""
    case = value["case"]
    require(case in CASES, "case_invalid")
    success = case in {"normal", "result-before-save"}
    crashed = case != "normal"
    reserved = case in {"model-reserved", "model-response"}
    requests = 2 if success else 1
    upstream = 0 if case == "model-reserved" else requests
    tool_count = int(not reserved)
    snapshots, segments = value["snapshots"], value["segments"]
    require(
        set(snapshots) == ({"before_kill", "after_kill", "final"} if crashed else {"final"}),
        "snapshot_evidence_missing",
    )
    require(
        len(segments) == (2 if crashed else 1)
        and segments[0]["role"] == "original"
        and (not crashed or segments[1]["role"] == "successor"),
        "process_segments_invalid",
    )
    final = snapshots["final"]
    for snapshot in snapshots.values():
        usage, counters = snapshot["usage"], snapshot["upstream"]
        for key in ("request_limit", "request_slots_consumed", "uncertain_requests"):
            integer(usage[key])
        for key in ("model_calls", "tool_calls", "tool_authenticated"):
            integer(counters[key])
        for count in snapshot["resources"].values():
            integer(count)
        require(
            usage["configured"] is True
            and usage["guest_connected"] is True
            and usage["request_limit"] == 10
            and usage["request_slots_consumed"] == requests
            and usage["uncertain_requests"] == int(reserved)
            and len(usage["entries"]) == requests,
            "model_ledger_mismatch",
        )
        require(
            counters["model_calls"] == upstream
            and counters["tool_calls"] == counters["tool_authenticated"] == tool_count
            and counters["model_authenticated"] is True,
            "dispatch_replay_or_missing",
        )
        require(len(snapshot["operations"]) == tool_count, "broker_operation_count_mismatch")
        for entry in usage["entries"]:
            require(
                entry["status"] == ("reserved" if reserved else "final")
                and entry["reason"]
                == ("dispatch_outcome_unknown" if reserved else "mock_reported_usage"),
                "model_literal_status_mismatch",
            )
            require(
                all(entry[k] is None for k in ("settled_at", "input_tokens", "output_tokens"))
                if reserved
                else entry["settled_at"] is not None
                and integer(entry["input_tokens"]) > 0
                and integer(entry["output_tokens"]) > 0,
                "model_settlement_mismatch",
            )
        for operation in snapshot["operations"]:
            require(
                operation["status"] == "succeeded"
                and operation["reason"] == "tool_ok"
                and operation["delivery"] == ("acknowledged" if success else "pending")
                and type(operation["receipt_hash"]) is str
                and len(operation["receipt_hash"]) == 64
                and integer(operation["http_calls"]) == 1,
                "broker_literal_delivery_mismatch",
            )
        require(
            len(snapshot["bindings"]) == len(snapshot["reservations"]) == 1,
            "replacement_binding_or_reservation",
        )
        require(
            snapshot["bindings"][0]["id"]
            == snapshot["run"]["sandbox_id"]
            == snapshot["reservations"][0]["sandbox_id"],
            "binding_identity_mismatch",
        )
        for group in ("model_tokens", "tool_tokens", "tool_grants", "model_policy"):
            require(snapshot[group], "authority_evidence_missing")
        for group in ("model_tokens", "tool_tokens", "tool_grants"):
            for authority in snapshot[group]:
                require(integer(authority.get("generation")) == 1, "authority_generation_changed")
        require(
            len(snapshot["tool_grants"]) == len(snapshot["model_policy"]) == 1,
            "authority_evidence_missing",
        )
    records = [record for segment in segments for record in segment["records"]]
    pages = [record for record in records if record["kind"] == "events"]
    trace = combined.worker.validate_trace(pages, finished=success)
    ids = [item["event_id"] for page in pages for item in page["events"]]
    require(
        ids == [e["source_event_id"] for e in final["events"] if e["source"] == "openhands"],
        "sdk_stored_cursor_mismatch",
    )
    claims = [[r for r in segment["records"] if r["kind"] == "claim"] for segment in segments]
    require(all(len(group) == 1 for group in claims), "claim_evidence_missing")
    original = claims[0][0]
    for segment, group in zip(segments, claims, strict=True):
        integer(segment["pid"])
        integer(segment["start_ticks"])
        require(type(segment["returncode"]) is int, "process_exit_evidence_invalid")
        claim = group[0]
        require(
            integer(claim["reserved"]) == 1
            and integer(claim["generation"]) > 0
            and claim["run_id"] == value["run_id"]
            and claim["binding_id"] == final["run"]["sandbox_id"],
            "claim_identity_mismatch",
        )
    require(
        integer(original["generation"]) == 1 and not original.get("recovery", False),
        "initial_claim_invalid",
    )
    require(
        final["run"]["generation"] == (2 if crashed else 1)
        and type(final["run"]["generation"]) is int,
        "final_generation_invalid",
    )
    require(
        segments[0]["returncode"] == (-signal.SIGKILL if crashed else 0)
        and segments[-1]["returncode"] == (0 if crashed else 0),
        "process_exit_evidence_invalid",
    )
    if crashed:
        fault = value["fault"]
        require(
            fault is not None
            and fault["observed_state"] in {"T", "t"}
            and type(fault["returncode"]) is int
            and fault["returncode"] == -signal.SIGKILL,
            "exact_stopped_kill_missing",
        )
        for key in EXPECTED_KEYS:
            require(
                type(fault[key]) is type(segments[0][key])
                and fault[key] == segments[0][key]
                and fault["barrier"][key] == fault[key],
                "fault_barrier_identity_mismatch",
            )
        require(fault["barrier"]["phase"] == "held", "fault_barrier_not_held")
        before, after = snapshots["before_kill"], snapshots["after_kill"]
        require(
            before["run"]["result"] is None
            and after["run"]["result"] is None
            and before["job"]["lease_expired"] is False,
            "fault_was_not_live",
        )
        require(
            before["job"]["lease_until"] == after["job"]["lease_until"], "lease_changed_after_stop"
        )
        successor = claims[1][0]
        require(
            successor["recovery"] is True
            and successor["generation"] == original["generation"] + 1
            and successor["owner"] != original["owner"]
            and successor["job_id"] == original["job_id"],
            "native_takeover_missing",
        )
        expired = [r["job"] for r in segments[1]["records"] if r["kind"] == "expired_lease"]
        require(
            len(expired) == 1
            and expired[0]["lease_expired"] is True
            and expired[0]["lease_until"] == before["job"]["lease_until"]
            and expired[0]["lease_owner"] == original["owner"]
            and timestamp(expired[0]["observed_at"]) >= timestamp(expired[0]["lease_until"])
            and timestamp(successor["observed_at"]) >= timestamp(expired[0]["lease_until"]),
            "natural_lease_expiry_missing",
        )
        require(
            segments[0]["policy_hashes"] == segments[1]["policy_hashes"]
            and set(segments[0]["policy_hashes"])
            == {"model.json", "model.secret", "tool.json", "tool.secret"},
            "successor_policy_changed",
        )
        require(
            not any(
                r["kind"] in {"events", "allocate"}
                or (r["kind"] == "tool" and r["action"] != "close")
                or (r["kind"] == "operation" and r["action"] != "release")
                for r in segments[1]["records"]
            ),
            "successor_progress_or_polling",
        )
        inspections = [r for r in segments[1]["records"] if r["kind"] == "inspect"]
        expected_phase = "result" if case == "result-before-save" else "running"
        require(
            len(inspections) == 1
            and inspections[0]["phase"] == expected_phase
            and type(inspections[0]["generation"]) is int
            and inspections[0]["generation"] == 2,
            "successor_inspect_phase_mismatch",
        )
        reconciled = [e for e in final["events"] if e["type"] == "runtime.reconciled"]
        require(
            len(reconciled) == 1
            and reconciled[0]["payload"]
            == {
                "phase": expected_phase,
                "generation": 2,
            }
            and type(reconciled[0]["payload"]["generation"]) is int,
            "durable_reconcile_phase_mismatch",
        )
        for snapshot in (before, after):
            require(
                snapshot["reservations"][0]["released_at"] is None
                and snapshot["resources"] == {"claims": 1, "vms": 1},
                "capacity_released_early",
            )
            require(
                snapshot["usage"]["entries"] == final["usage"]["entries"]
                and snapshot["operations"] == final["operations"],
                "uncertain_work_rewritten_or_replayed",
            )
            require(
                snapshot["bindings"][0]["id"] == final["bindings"][0]["id"]
                and snapshot["bindings"][0]["provider_handle"]
                == final["bindings"][0]["provider_handle"]
                and snapshot["journal"]["handle"] == final["journal"]["handle"]
                and snapshot["journal"]["claim_ref"] == final["journal"]["claim_ref"]
                and snapshot["journal"]["observed"] == final["journal"]["observed"]
                and snapshot["journal"]["operations"]["allocate"]
                == final["journal"]["operations"]["allocate"]
                and snapshot["journal"]["operations"]["prompt"]
                == final["journal"]["operations"]["prompt"],
                "original_runtime_identity_changed",
            )
            for key in ("model_tokens", "tool_tokens", "tool_grants"):
                require(
                    [{k: v for k, v in row.items() if k != "revoked_at"} for row in snapshot[key]]
                    == [{k: v for k, v in row.items() if k != "revoked_at"} for row in final[key]],
                    "successor_issued_or_rebound_authority",
                )
            for key in ("tool_grants", "model_policy"):
                require(
                    snapshot[key][0]["policy_sha256"] == final[key][0]["policy_sha256"],
                    "successor_policy_changed",
                )
        probe = value["fence_probe"]
        require(
            type(probe["status"]) is int
            and probe["status"] == 409
            and probe["error"] == "connector_generation_stale"
            and probe["before"] == probe["after"] == final["upstream"],
            "old_generation_fence_missing",
        )
        if reserved:
            require(
                fault["barrier"]["request_id"] == before["usage"]["entries"][0]["request_id"],
                "fault_request_identity_mismatch",
            )
        if case == "broker-delivered":
            require(
                before["journal"]["tool_channel"]["current"]["state"] == "delivered"
                and fault["barrier"]["operation_id"] == before["operations"][0]["operation_id"],
                "connector_delivery_boundary_missing",
            )
        if case == "result-before-save":
            persisted = before["journal"]["operations"]["result"]
            require(
                before["run"]["state"] == "finalizing"
                and persisted["state"] == "completed"
                and persisted["result"] == final["run"]["result"]
                and fault["barrier"]["result_sha256"] == final["run"]["result"]["diff_sha256"]
                and any(e["type"] == "tool.session_drained" for e in before["events"])
                and not any(e["type"] == "run.result_saved" for e in before["events"]),
                "persisted_result_boundary_missing",
            )
    else:
        require(value["fault"] is None, "normal_has_fault")
    require(sum(r["kind"] == "allocate" for r in records) == 1, "replacement_allocation")
    proofs = [r for r in records if r["kind"] == "raw_proof"]
    require(
        proofs
        and all(
            r["observed_state"] == "stopped"
            and set(r["proof"]) == combined.worker.base.STOP_KEYS
            and all(v is True for v in r["proof"].values())
            and integer(r["reserved_before_return"]) == 1
            for r in proofs
        ),
        "full_stop_proof_missing",
    )
    require(
        final["run"]["cleanup_state"] == "confirmed"
        and final["reservations"][0]["released_at"] is not None
        and final["resources"] == {"claims": 0, "vms": 0},
        "final_cleanup_missing",
    )
    require(
        all(
            r["revoked_at"] is not None
            for key in ("tool_grants", "tool_tokens")
            for r in final[key]
        ),
        "tool_authority_not_revoked",
    )
    cutoffs = [e for e in final["events"] if e["type"] == "model.cutoff"]
    result_events = [e for e in final["events"] if e["type"] == "run.result_saved"]
    if success:
        require(
            final["run"]["state"] == "succeeded"
            and final["run"]["reason"] is None
            and not final["usage"]["cutoff_reason"]
            and not cutoffs
            and len(result_events) == 1,
            "success_evidence_missing",
        )
        result = combined.checks.validate_result(final["run"]["result"], value["base_sha"])
        require(trace["markers"] == ["WORKER_TOOL_1"], "sdk_observation_missing")
    else:
        require(
            final["run"]["state"] == "failed"
            and final["run"]["result"] is None
            and final["run"]["reason"]
            == final["usage"]["cutoff_reason"]
            == "model_transport_uncertain"
            and len(cutoffs) == 1
            and cutoffs[0]["payload"]
            == {
                "reason": "model_transport_uncertain",
                "capacity_retained": True,
            }
            and not result_events,
            "native_recovery_cutoff_missing",
        )
        require(
            all(r["revoked_at"] is not None for r in final["model_tokens"]),
            "model_authority_not_revoked",
        )
        result = {}
    if tool_count:
        combined.worker.validate_approvals(
            value["decisions"], final["approvals"], final["events"], "cancel-in-flight"
        )
        require(
            integer(value["decisions"][0]["dispatches_before"]) == 0, "dispatch_before_approval"
        )
    else:
        require(not value["decisions"] and not final["approvals"], "unexpected_public_approval")
    return {
        "case": case,
        **trace,
        **result,
        "run_state": final["run"]["state"],
        "reason": final["run"]["reason"],
        "model_requests": requests,
        "model_upstream_calls": upstream,
        "uncertain_requests": int(reserved),
        "tool_operations": tool_count,
        "tool_acked": int(success),
        "successor_sdk_poll_count": 0 if crashed else None,
        "recovery_source": "persisted-result"
        if case == "result-before-save"
        else "native-cutoff"
        if crashed
        else "normal",
        "original_binding_retained": True,
        "capacity_retained_until_full_proof": True,
        "cleanup_confirmed": True,
        "passed": True,
    }


def reserve_boundary(original, boundary, proxy, run_id, token, request_id, payload):
    value = original(proxy, run_id, token, request_id, payload)
    boundary("model-reserved", request_id=str(request_id))
    return value


def settle_boundary(original, boundary, proxy, run_id, request_id, **kwargs):
    if kwargs.get("usage") is not None:
        boundary("model-response", request_id=str(request_id))
    return original(proxy, run_id, request_id, **kwargs)


def tool_boundary(original, boundary, run, action, **data):
    value = original(run, action, **data)
    if (
        action == "deliver"
        and type(value) is dict
        and set(value) == {"accepted"}
        and value["accepted"] is True
    ):
        boundary("broker-delivered", operation_id=data["operation_id"])
    return value


def result_boundary(value, boundary, action):
    if action == "result":
        boundary("result-before-save", result_sha256=value["diff_sha256"])
    return value
