"""Fail-closed oracles for observed combined Worker acceptance evidence."""

import hashlib
import json

from agent_platform.verification import VerificationPolicy, contract_sha256

RESULT_FILE = "m3-integrated.json"
EXPECTED = {"repository_get": True}
CLEANUP_KEYS = (
    "cleanup_failures",
    "remaining_claims",
    "remaining_vms",
    "remaining_reservations",
    "remaining_worker_processes",
    "remaining_connector_processes",
)


def require(value, code):
    if not value:
        raise RuntimeError(code)


def cleanup_passed(report):
    return all(type(report.get(key)) is int and report[key] == 0 for key in CLEANUP_KEYS)


def verification():
    return {
        "mode": "commands",
        "revision": "m3-integrated-v1",
        "checks": [
            {
                "id": "combined-result",
                "argv": [
                    "python3",
                    "-I",
                    "-c",
                    "import json;from pathlib import Path;assert "
                    f"json.loads(Path({RESULT_FILE!r}).read_text()) == {EXPECTED!r}",
                ],
                "timeout_seconds": 10,
            }
        ],
    }


def validate_result(result, base_sha):
    raw = json.dumps(EXPECTED, sort_keys=True)
    patch = result["diff"]
    lines = patch.splitlines()
    require(
        len(lines) == 7
        and lines[0] == f"diff --git a/{RESULT_FILE} b/{RESULT_FILE}"
        and lines[1] == "new file mode 100644"
        and lines[2].startswith("index 0000000..")
        and lines[3:6] == ["--- /dev/null", f"+++ b/{RESULT_FILE}", "@@ -0,0 +1 @@"]
        and lines[6] == "+" + raw
        and patch.endswith("\n"),
        "result_patch_mismatch",
    )
    digest = hashlib.sha256(patch.encode()).hexdigest()
    require(
        result["base_sha"] == base_sha
        and type(result["diff_bytes"]) is int
        and result["diff_sha256"] == digest
        and result["diff_bytes"] == len(patch.encode()),
        "result_integrity_mismatch",
    )
    check = result["verification"]
    contract = contract_sha256(VerificationPolicy.model_validate(verification()))
    require(
        check["status"] == "passed"
        and check["name"] == "profile_verification"
        and check["contract_sha256"] == contract
        and check["diff_sha256"] == digest
        and len(check["checks"]) == 1
        and check["checks"][0]["id"] == "combined-result"
        and check["checks"][0]["status"] == "passed"
        and type(check["checks"][0]["exit_code"]) is int
        and check["checks"][0]["exit_code"] == 0,
        "profile_verification_missing",
    )
    return {
        "diff_sha256": digest,
        "verification_contract_sha256": contract,
        "profile_verification_passed": True,
    }


def validate_observations(value, worker):
    case, run, usage = value["case"], value["run"], value["usage"]
    require(case in {"normal", "request-cutoff", "invalid-usage"}, "case_invalid")
    normal, unknown = case == "normal", case == "invalid-usage"
    # bool is a subclass of int; require actual measured integer counts.
    counts = [
        usage.get(key)
        for key in (
            "request_limit",
            "request_slots_consumed",
            "uncertain_requests",
        )
    ]
    counts.extend(
        value.get(key)
        for key in (
            "model_calls",
            "tool_calls",
            "tool_authenticated",
            "reservations",
            "claims",
            "vms",
        )
    )
    counts.extend(
        value["authority"].get(key)
        for key in (
            "model_runs",
            "model_tokens",
            "model_active_tokens",
            "tool_runs",
            "tool_active_runs",
            "tool_tokens",
            "tool_active_tokens",
        )
    )
    counts.extend(
        record.get("reserved_before_return")
        for record in value["records"]
        if record["kind"] == "proof"
    )
    counts.extend(operation.get("http_calls") for operation in value["operations"])
    counts.extend(decision.get("dispatches_before") for decision in value["decisions"])
    counts.extend(item.get("generation") for item in [*value["decisions"], *value["approvals"]])
    require(all(type(count) is int and count >= 0 for count in counts), "count_evidence_invalid")
    pages, records = value["pages"], value["records"]
    result = {"case": case, **worker.validate_trace(pages, finished=normal)}
    require(
        [item["event_id"] for page in pages for item in page["events"]] == value["stored_ids"],
        "worker_events_not_persisted",
    )
    wanted = 2 if normal else 1
    require(
        usage["configured"] is True
        and usage["guest_connected"] is True
        and usage["request_limit"] == (1 if case == "request-cutoff" else 10)
        and usage["request_slots_consumed"] == wanted
        and len(usage["entries"]) == wanted
        and value["model_calls"] == wanted
        and value["model_authenticated"] is True,
        "model_request_evidence_mismatch",
    )
    require(
        usage["uncertain_requests"] == int(unknown)
        and all(e["status"] == ("unknown" if unknown else "final") for e in usage["entries"]),
        "model_unknown_evidence_missing",
    )
    cutoffs = [e for e in value["events"] if e["type"] == "model.cutoff"]
    if normal:
        require(
            run["state"] == "succeeded" and not usage["cutoff_reason"] and not cutoffs,
            "worker_did_not_succeed",
        )
        result.update(validate_result(run["result"], value["base_sha"]))
        require(result["markers"] == ["WORKER_TOOL_1"], "sdk_observation_missing")
        # This existing oracle's single-approval branch validates identity and public order.
        worker.validate_approvals(
            value["decisions"], value["approvals"], value["events"], "cancel-in-flight"
        )
        require(value["decisions"][0]["dispatches_before"] == 0, "dispatch_before_approval")
        require(
            len(value["operations"]) == 1
            and value["tool_calls"] == value["tool_authenticated"] == 1,
            "tool_replay_or_dispatch_mismatch",
        )
        operation = value["operations"][0]
        require(
            operation["status"] == "succeeded"
            and operation["delivery"] == "acknowledged"
            and operation["receipt_present"] is True
            and operation["http_calls"] == 1,
            "tool_ack_evidence_missing",
        )
    else:
        reason = "model_response_invalid" if unknown else "model_request_limit_reached"
        require(run["state"] == "failed" and run["result"] is None, "fault_reported_success")
        require(
            run["reason"] == usage["cutoff_reason"] == reason
            and len(cutoffs) == 1
            and cutoffs[0]["payload"] == {"reason": reason, "capacity_retained": True},
            "native_cutoff_evidence_missing",
        )
        if unknown:
            require(usage["entries"][0]["reason"] == reason, "unknown_reason_missing")
        require(
            not value["operations"]
            and value["tool_calls"] == value["tool_authenticated"] == 0
            and not value["decisions"]
            and not value["approvals"],
            "fault_tool_dispatch",
        )
        worker.validate_fault_delivery(records, value["operations"])
    authority = value["authority"]
    require(
        authority["model_runs"] == authority["tool_runs"] == 1
        and authority["model_tokens"] > 0
        and authority["tool_tokens"] > 0
        and authority["tool_active_runs"] == authority["tool_active_tokens"] == 0,
        "tool_authority_not_revoked",
    )
    if not normal:
        require(authority["model_active_tokens"] == 0, "model_authority_not_revoked")
    proofs = [v for v in records if v["kind"] == "proof"]
    require(
        proofs
        and all(
            v["complete"] is True and v["withheld"] is False and v["reserved_before_return"] == 1
            for v in proofs
        ),
        "full_stop_proof_before_release_missing",
    )
    require(
        run["cleanup_state"] == "confirmed"
        and value["reservations"] == 0
        and value["claims"] == value["vms"] == 0,
        "worker_cleanup_incomplete",
    )
    result.update(
        {
            "run_state": run["state"],
            "model_requests": wanted,
            "unknown_requests": usage["uncertain_requests"],
            "cutoff_reason": usage["cutoff_reason"],
            "model_token_revoked": authority["model_active_tokens"] == 0,
            "tool_authority_revoked": True,
            "tool_operations": len(value["operations"]),
            "authenticated_upstream_hops": value["tool_authenticated"],
            "public_approvals_applied": len(value["approvals"]),
            "capacity_retained_until_full_proof": True,
            "cleanup_confirmed": True,
            "normal_worker_lifecycle": True,
            "passed": True,
        }
    )
    return result
