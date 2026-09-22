"""Read-only reconciliation of the exact journaled sandbox and conversation.

Unknown upstream mutations remain quarantined. Even an absent claim is not
proof that the VMM, runtime directory and cgroup have disappeared.
"""

from agent_platform_m0.contracts import OPENHANDS_SHA, OPENHANDS_VERSION

from .domain import Problem

STOP_KEYS = {
    "original_vmm_process_gone",
    "vm_record_gone",
    "runtime_directory_gone",
    "cpu_scope_gone",
}


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
        removal = observe_sandbox(service, row)
        if removal:
            return {
                "phase": "stopped",
                "stop": removal,
                "result": operations.get("result", {}).get("result"),
            }
        if any(op["state"] != "completed" for op in operations.values()):
            raise Problem(409, "connector_operation_uncertain")
        if "release" in operations:
            raise Problem(409, "cleanup_unconfirmed")
        allocation = operations["allocate"]["result"]
        response = {"phase": "allocated", "allocation": allocation}
        if "prepare" not in operations:
            return response
        with service.relay(row) as http:
            info = http.expect("GET", "/server_info")
            conversation = http.expect("GET", "/api/conversations/" + row["run_id"])
        if info.get("build_git_sha") != OPENHANDS_SHA or info.get("version") != OPENHANDS_VERSION:
            raise Problem(409, "agent_version_mismatch")
        if conversation.get("id") != row["run_id"]:
            raise Problem(409, "recovery_conversation_mismatch")
        response.update(phase="prepared", prepared=operations["prepare"]["result"])
        if "prompt" in operations:
            if conversation["execution_status"] not in {"running", "finished"}:
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
