"""Reconciliation of the exact journaled sandbox and conversation.

Unknown upstream mutations remain quarantined. Even an absent claim is not
proof that the VMM, runtime directory and cgroup have disappeared. The only
supported decision for an allocate intent with no saved handle is the explicit
command below; it records the decision in the same journal and does not delete
the row, edit the fence, or lower generation.
"""

import json
from pathlib import Path
from uuid import UUID

from agent_platform_m0.contracts import OPENHANDS_SHA, OPENHANDS_VERSION

from .connector_journal import Journal
from .domain import Problem

STOP_KEYS = {
    "original_vmm_process_gone",
    "vm_record_gone",
    "runtime_directory_gone",
    "cpu_scope_gone",
}
UNCONFIRMED_ALLOCATION_DECISION = "unconfirmed_allocation_not_observed"


def unconfirmed_allocate_pending(row):
    operation = row.get("operations", {}).get("allocate")
    return bool(
        operation
        and operation.get("state") == "started"
        and not row.get("handle")
        and not row.get("observed")
    )


def blocks_new_admission(row, run_id):
    return unconfirmed_allocate_pending(row) and row.get("run_id") != str(run_id)


def unconfirmed_allocation_reconciled(row):
    operation = row.get("operations", {}).get("allocate") or {}
    result = operation.get("result") or {}
    return bool(
        operation.get("state") == "reconciled"
        and result.get("decision") == UNCONFIRMED_ALLOCATION_DECISION
        and result.get("generation") == row.get("generation")
        and not row.get("handle")
        and not row.get("observed")
        and set(row.get("operations", {})) == {"allocate"}
    )


def host_not_clear(config, host):
    if host.vms():
        return True
    claims = Path(config["sandbox_data_dir"]) / "claims.json"
    if claims.exists():
        try:
            parsed = json.loads(claims.read_text())
        except (OSError, json.JSONDecodeError):
            return True
        if parsed != {}:
            return True
    cgroup = getattr(host, "cgroup", None)
    if cgroup is not None and any(Path(cgroup).glob("vm-*.scope")):
        return True
    root_dir = (getattr(host, "config", None) or {}).get("root_dir")
    return bool(root_dir and any(Path(root_dir).glob("vm-*")))


def reconcile_unconfirmed_allocation(config, host, run_id):
    """Record one explicit decision. Caller must already hold no connector lock."""
    run_id = str(UUID(str(run_id)))
    state_dir = Path(config["state_dir"])
    fence_root = state_dir / "fences"
    if not state_dir.is_dir() or not fence_root.is_dir():
        raise Problem(409, "unconfirmed_allocation_fence_missing")
    try:
        journal = Journal(state_dir)
    except BlockingIOError:
        raise Problem(409, "connector_journal_busy") from None
    fences = None
    try:
        try:
            fences = Journal(fence_root)
        except BlockingIOError:
            raise Problem(409, "connector_journal_busy") from None
        with journal.locked(run_id):
            if host_not_clear(config, host):
                raise Problem(409, "unconfirmed_allocation_host_not_clear")
            row = journal.read(run_id)
            fence = fences.read(run_id)
            if row is None or fence is None:
                raise Problem(409, "unconfirmed_allocation_fence_missing")
            if unconfirmed_allocation_reconciled(row):
                if fence.get("generation") != row.get("generation"):
                    raise Problem(409, "unconfirmed_allocation_fence_mismatch")
                return row["operations"]["allocate"]["result"]
            if (
                not unconfirmed_allocate_pending(row)
                or set(row.get("operations", {})) != {"allocate"}
            ):
                raise Problem(409, "unconfirmed_allocation_not_reconcilable")
            if fence.get("generation") != row.get("generation"):
                raise Problem(409, "unconfirmed_allocation_fence_mismatch")
            result = {
                "decision": UNCONFIRMED_ALLOCATION_DECISION,
                "generation": row["generation"],
                "host_vm_count": 0,
                "sandbox_claim_count": 0,
            }
            row["operations"]["allocate"]["state"] = "reconciled"
            row["operations"]["allocate"]["result"] = result
            journal.write(row)
            return result
    finally:
        if fences is not None:
            fences.close()
        journal.close()


def stopped(value):
    proof = value.get("proof", {})
    return (
        value.get("observed_state") == "stopped"
        and set(proof) == STOP_KEYS
        and all(v is True for v in proof.values())
    )


def inspect(service, run_id, generation):
    with service.journal.locked(run_id):
        service.fences.require(run_id, generation)
        if not service.journal.read(run_id):
            return {"phase": "absent"}
        row = service.require(run_id, generation)
        operations = row["operations"]
        receipts = [
            op["result"]
            for key, op in operations.items()
            if key.startswith("approval:") and op["state"] == "completed"
        ]
        removal = observe_sandbox(service, row)
        if removal:
            return {
                "phase": "stopped",
                "approval_receipts": receipts,
                "stop": removal,
                "result": operations.get("result", {}).get("result"),
            }
        service.guard(row)
        if any(op["state"] != "completed" for op in operations.values()):
            raise Problem(409, "connector_operation_uncertain")
        if "release" in operations:
            raise Problem(409, "cleanup_unconfirmed")
        allocation = operations["allocate"]["result"]
        response = {"phase": "allocated", "allocation": allocation, "approval_receipts": receipts}
        if "prepare" not in operations:
            return response
        service.isolation(row, terminal="prompt" in operations)
        with service.relay(row) as http:
            info = http.expect("GET", "/server_info")
            conversation = service.conversation(row, http)
        if info.get("build_git_sha") != OPENHANDS_SHA or info.get("version") != OPENHANDS_VERSION:
            raise Problem(409, "agent_version_mismatch")
        if conversation.get("id") != row["run_id"]:
            raise Problem(409, "recovery_conversation_mismatch")
        response.update(phase="prepared", prepared=operations["prepare"]["result"])
        if "prompt" in operations:
            if conversation["execution_status"] not in {
                "running",
                "finished",
                "waiting_for_confirmation",
            }:
                raise Problem(409, "backend_stopped_without_completion")
            response["phase"] = "running"
        if "result" in operations:
            response.update(phase="result", result=operations["result"]["result"])
        return response


def observe_sandbox(service, row):
    observed = row.get("observed")
    handle = row.get("handle")
    if not handle or not observed:
        raise Problem(409, "allocation_ownership_uncertain")
    claims = service.client.sandboxes()
    proof = service.host.removal(observed)
    removal = {"observed_state": "stopped", "proof": proof}
    matching = [s for s in claims if s["id"] == handle["id"]]
    if stopped(removal) and not matching:
        return removal
    if (
        len(matching) != 1
        or matching[0].get("claim_ref") != row["claim_ref"]
        or matching[0].get("key")
        != {"template": row["input"]["template"], "net": "none", "size": "large"}
    ):
        raise Problem(409, "recovery_claim_mismatch")
    current = service.host.observe(handle["id"])
    for key in ("vm_id", "identity", "image_digest", "cpu", "memory_bytes", "run_dir", "scope"):
        # A live process may change scheduling state, but never PID/start ticks.
        if key == "identity":
            if any(current[key][k] != observed[key][k] for k in ("pid", "start_ticks")):
                raise Problem(409, "recovery_vm_identity_mismatch")
        elif current[key] != observed[key]:
            raise Problem(409, "recovery_vm_identity_mismatch")
    return None
