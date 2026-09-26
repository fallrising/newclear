"""Register a verified replacement worker under the patched core and leave it fenced."""
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import time

from core_release import validation_record
from labops import atomic_json
import reimage_worker_install as install

SAFE_CORE_VALIDATION = "patches/core-v0.1.5-safe-node-add.validation.json"
RUNTIME_FACTS = r'''import hashlib,json,pathlib,subprocess
p=subprocess.run(["systemctl","show","eru-core.service","--property=MainPID,ActiveState,InvocationID,NRestarts"],
                 capture_output=True,text=True,timeout=15)
if p.returncode: raise RuntimeError("core runtime query failed")
r=dict(line.split("=",1) for line in p.stdout.splitlines())
pid=int(r.get("MainPID","0"))
r["sha256"]=hashlib.sha256(pathlib.Path("/proc",str(pid),"exe").read_bytes()).hexdigest() if pid>0 else None
print(json.dumps(r,sort_keys=True))
'''


def _now():
    return datetime.now(timezone.utc).isoformat()


def _strict_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate field in worker resource capacity")
        value[key] = item
    return value


def _resource_capacity(value):
    try:
        decoded = json.loads(value, object_pairs_hook=_strict_object) if isinstance(value, str) else value
        if not isinstance(decoded, dict):
            raise ValueError
        if any(not isinstance(plugin, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}", plugin)
               or not isinstance(params, dict) for plugin, params in decoded.items()):
            raise ValueError
        return json.dumps(decoded, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError("planned worker resource capacity is not a valid Eru resource map") from exc


def registration_argv(core_ip, registration):
    """Build CLI arguments from the plan's exact resource map and labels."""
    labels = registration.get("labels")
    if (not isinstance(labels, dict)
            or any(not isinstance(key, str) or not key or "=" in key or "\n" in key or "\r" in key
                   or not isinstance(value, str) or "\n" in value or "\r" in value
                   for key, value in labels.items())):
        raise ValueError("planned worker labels are malformed")
    capacity = _resource_capacity(registration.get("resource_capacity"))
    argv = ["sudo", "-n", "/usr/local/bin/eru-cli", "--eru", core_ip + ":5001",
            "node", "add", registration["podname"], "--nodename", registration["node"],
            "--endpoint", registration["endpoint"], "--extra-resources", capacity]
    for key, value in sorted(labels.items()):
        argv.extend(["--label", key + "=" + value])
    return argv


def _core_runtime(operator):
    raw = operator.command(operator.core["alias"], ["sudo", "-n", "python3", "-"], RUNTIME_FACTS)
    try:
        result = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as exc:
        raise ValueError("core runtime query returned invalid JSON") from exc
    required = {"MainPID", "ActiveState", "InvocationID", "NRestarts", "sha256"}
    if not isinstance(result, dict) or not required.issubset(result):
        raise ValueError("core runtime query has an incomplete schema")
    try:
        pid = int(result["MainPID"])
    except (TypeError, ValueError) as exc:
        raise ValueError("core runtime PID is invalid") from exc
    if result["ActiveState"] != "active" or pid <= 0 or not result["InvocationID"]:
        raise ValueError("core service is not active with a running process")
    checksum = result["sha256"]
    if not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
        raise ValueError("core runtime binary checksum is unavailable")
    return result


def _node_rows(operator, name):
    rows = operator.cli("node", "get", name)
    if isinstance(rows, dict):
        rows = [rows]
    if not isinstance(rows, list):
        raise ValueError("core node query returned an invalid result")
    return [row for row in rows if isinstance(row, dict) and row.get("name") == name]


def _json_value(value, label):
    try:
        result = json.loads(value) if isinstance(value, str) else value
    except (TypeError, json.JSONDecodeError) as exc:
        raise ValueError(label + " is invalid JSON") from exc
    return result


def _zero(value):
    if isinstance(value, dict):
        return all(_zero(item) for item in value.values())
    if isinstance(value, list):
        return all(_zero(item) for item in value)
    return isinstance(value, (int, float)) and value == 0


def _assert_fenced_node(row, registration, *, require_available):
    expected_capacity = _json_value(registration["resource_capacity"], "planned capacity")
    actual_capacity = _json_value(row.get("resource_capacity"), "reported capacity")
    actual_usage = _json_value(row.get("resource_usage", "{}"), "reported resource usage")
    if (row.get("name") != registration["node"] or row.get("podname") != registration["podname"]
            or row.get("endpoint") != registration["endpoint"] or row.get("labels") != registration["labels"]
            or actual_capacity != expected_capacity or not _zero(actual_usage)):
        raise ValueError("new worker registration differs from the reviewed identity, capacity or labels")
    if type(row.get("available")) is not bool or type(row.get("bypass")) is not bool:
        raise ValueError("new worker liveness or fence state is unreadable")
    if row["bypass"] is not True:
        raise ValueError("new worker registration is not fenced")
    if require_available and row["available"] is not True:
        raise ValueError("new worker agent is not available while fenced")


def _projection(row):
    return {key: row.get(key) for key in (
        "name", "podname", "endpoint", "labels", "resource_capacity", "resource_usage",
        "available", "bypass")}


def _assert_cluster(operator, source_plan, registration, *, target_present, require_available=False):
    from reimage_prepare import _cluster, _workload_projection
    current = _cluster(operator)
    before = source_plan["snapshot"]
    if sorted(row.get("name") for row in current["pods"]) != sorted(row.get("name") for row in before["pods"]):
        raise ValueError("pod membership changed during worker registration")
    if _workload_projection(current["workloads"]) != _workload_projection(before["workloads"]):
        raise ValueError("workload set changed during worker registration")
    name = registration["node"]
    target_rows = [row for row in current["nodes"] if row.get("name") == name]
    if len(target_rows) != (1 if target_present else 0):
        raise ValueError("target registration presence differs from the expected phase")
    expected_other = {row["name"]: _projection(row) for row in before["nodes"] if row.get("name") != name}
    actual_other = {row["name"]: _projection(row) for row in current["nodes"] if row.get("name") != name}
    if actual_other != expected_other:
        raise ValueError("unrelated worker registration changed")
    if target_present:
        _assert_fenced_node(target_rows[0], registration, require_available=require_available)
        if any(row.get("nodename") == name for row in current["workloads"]):
            raise ValueError("new worker unexpectedly has workloads")
    return current


def _install_journal(operator, plan, plan_hash):
    path = operator.root / "runs" / (plan["id"] + ".json")
    if path.is_symlink() or not path.is_file():
        raise ValueError("completed worker install journal is missing or unsafe")
    try:
        journal = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("worker install journal is invalid") from exc
    if (not isinstance(journal, dict) or journal.get("operation") != "provider-reimage-worker-install"
            or journal.get("id") != plan["id"] or journal.get("plan_hash") != plan_hash
            or journal.get("status") != "installed-awaiting-registration"
            or journal.get("agent_started") is not False or journal.get("node_registered") is not False
            or journal.get("remote_mutation_performed") is not True
            or journal.get("target") != plan["target"]["node"]
            or journal.get("target_alias") != plan["target"]["alias"]):
        raise ValueError("worker install has not completed in the expected stopped, unregistered state")
    return journal


def _validate_stage(operator, plan):
    gate = plan.get("worker_registration")
    if not isinstance(gate, dict) or gate.get("executable") is not True or gate.get("blockers") != []:
        raise ValueError("worker registration gate is missing or blocked")
    verified = validation_record(operator.project, SAFE_CORE_VALIDATION)
    if gate.get("core_release") != verified:
        raise ValueError("safe core release validation changed; create a new worker bootstrap plan")
    return verified


def register_reimage_worker(operator, bootstrap_plan_id, expected_hash, *, sleep=time.sleep,
                            attempts=90, interval=1):
    """Add a worker only under the verified core, start its agent and leave it fenced."""
    from labctl import identifier
    plan, source_plan, receipt, observation, trusted, prep = install._validated_context(
        operator, bootstrap_plan_id, expected_hash)
    release = _validate_stage(operator, plan)
    _install_journal(operator, plan, expected_hash)
    target = plan["target"]
    alias, name = target["alias"], target["node"]
    run_id = identifier(plan["id"] + "-register")
    run_path = operator.root / "runs" / (run_id + ".json")
    if run_path.exists() or run_path.is_symlink():
        raise ValueError("worker registration already has a journal; reconcile it and never replay")
    operator.events = []
    operator.journal_path = run_path
    operator.journal = {
        "id": run_id, "bootstrap_plan_id": plan["id"],
        "operation": "provider-reimage-worker-registration", "plan_hash": expected_hash,
        "source_reimage_plan": plan["source_reimage_plan"], "status": "running",
        "started_at": _now(), "target": name, "target_alias": alias,
        "core_release_id": release["release_id"], "core_artifact_sha256": release["artifact_sha256"],
        "events": [],
    }
    operator.stage("preflight")
    try:
        import reimage_worker_access as worker_access
        access_proof = worker_access.require_access_ready(operator, plan, expected_hash)
        operator.journal["access_proof"] = access_proof
        operator.save_journal()
        install._check_health(operator)
        install._cluster_unchanged(operator, source_plan)
        install._other_hosts_unchanged(operator, source_plan, alias)
        current = install._read_replacement(operator, alias, receipt, observation, trusted)
        audit = install._worker_audit(operator, plan, trusted)
        worker_facts = install._post_facts(operator, plan, trusted)
        if (current["machine_id"] != target["machine_id"] or current["boot_id"] != target["boot_id"]
                or audit.get("scope_verified") is not True or worker_facts["agent_active_state"] != "inactive"
                or worker_facts["agent_unit_state"] != "disabled"):
            raise ValueError("replacement worker is not the verified, installed and stopped target")
        before_runtime = _core_runtime(operator)
        if before_runtime["sha256"] != release["artifact_sha256"]:
            raise ValueError("running core binary is not the verified safe AddNode release")
        if _node_rows(operator, name):
            raise ValueError("target node already exists; reconcile its registration before continuing")
        install._check_health(operator)
        install._cluster_unchanged(operator, source_plan)
        install._other_hosts_unchanged(operator, source_plan, alias)
        if _core_runtime(operator) != before_runtime:
            raise ValueError("core process changed during registration preflight")
        if worker_access.require_access_ready(operator, plan, expected_hash,
                                              expected_proof=access_proof) != access_proof:
            raise ValueError("core worker access changed during registration preflight")
        registration = plan["registration"]
        argv = registration_argv(operator.core["ip"], registration)
        operator.journal.update(core_add_attempted=True, core_add_outcome="unknown")
        operator.save_journal()
        operator.stage("adding-fenced-node-" + name)
        operator.command(operator.core["alias"], argv, timeout=90, record_output=False)
        operator.journal["core_add_outcome"] = "response-received"
        operator.save_journal()

        rows = _node_rows(operator, name)
        if len(rows) != 1:
            raise ValueError("core did not report exactly one new worker registration")
        _assert_fenced_node(rows[0], registration, require_available=False)
        _assert_cluster(operator, source_plan, registration, target_present=True)
        operator.journal["node_registered"] = True
        operator.journal["fence_observed"] = True
        operator.save_journal()

        install._check_health(operator)
        _assert_cluster(operator, source_plan, registration, target_present=True)
        install._other_hosts_unchanged(operator, source_plan, alias)
        if _core_runtime(operator) != before_runtime:
            raise ValueError("verified core process changed before worker agent start")
        operator.stage("starting-agent-" + name)
        operator.journal["agent_start_attempted"] = True
        operator.save_journal()
        operator.command(alias, ["sudo", "-n", "systemctl", "enable", "--now", "eru-agent.service"],
                         timeout=90, ssh_options=install._ssh_options(operator, trusted))
        operator.journal["agent_started"] = True
        operator.save_journal()

        operator.stage("waiting-for-agent-while-fenced-" + name)
        ready = False
        for attempt in range(attempts):
            rows = _node_rows(operator, name)
            if len(rows) != 1:
                raise ValueError("core worker registration disappeared while waiting for its agent")
            row = rows[0]
            if row.get("bypass") is not True:
                raise ValueError("worker lost its scheduling fence before smoke testing")
            if type(row.get("available")) is not bool:
                raise ValueError("core worker availability is unreadable")
            if row["available"] is True:
                ready = True
                break
            if attempt + 1 < attempts:
                sleep(interval)
        if not ready:
            raise ValueError("worker agent did not become available while fenced")

        worker_facts = install._post_facts(
            operator, plan, trusted, expected_agent_active="active", expected_agent_unit="enabled")
        audit = install._worker_audit(operator, plan, trusted)
        if audit.get("scope_verified") is not True:
            raise ValueError("replacement worker ownership audit failed after agent start")
        _assert_cluster(operator, source_plan, registration, target_present=True, require_available=True)
        install._check_health(operator)
        install._other_hosts_unchanged(operator, source_plan, alias)
        if _core_runtime(operator) != before_runtime:
            raise ValueError("verified core process changed before fenced registration completed")
        operator.journal.update(
            status="registered-awaiting-smoke", agent_started=True, node_registered=True,
            available=True, bypass=True, core_runtime=before_runtime,
            post_registration={
                "machine_id": worker_facts["machine_id"], "boot_id": worker_facts["boot_id"],
                "tailscale_ipv4": worker_facts["tailscale_ipv4"],
                "services": worker_facts["services"], "runtime_counts": worker_facts["runtime_counts"],
                "agent_active_state": worker_facts["agent_active_state"],
                "agent_unit_state": worker_facts["agent_unit_state"],
            }, finished_at=_now())
        operator.stage("awaiting-smoke")
        return operator.journal
    except BaseException as exc:
        operator.journal.update(status="failed", failed_at=operator.journal["stage"],
                                error=str(exc), finished_at=_now())
        operator.save_journal()
        raise


def reconcile_worker_registration(operator, run_id, journal=None):
    """Read actual registration and worker state; never add, start, fence or resume."""
    from labctl import identifier
    run_id = identifier(run_id)
    path = operator.root / "runs" / (run_id + ".json")
    if path.is_symlink() or not path.is_file():
        raise ValueError("worker registration journal is missing or unsafe")
    journal = journal if journal is not None else json.loads(path.read_text())
    if journal.get("operation") != "provider-reimage-worker-registration":
        raise ValueError("journal is not a worker registration stage")
    operator.journal_path = path
    operator.journal = journal
    operator.events = list(journal.get("events", []))
    result = {"at": _now(), "policy": "Read-only registration reconciliation; no node add, service, fence or resume command is replayed.",
              "remote_mutation_performed": False}
    try:
        plan, source_plan, receipt, trusted = install._reconcile_context(operator, journal)
        release = _validate_stage(operator, plan)
        alias, name = plan["target"]["alias"], plan["target"]["node"]
        install._validate_alias_locally(operator, alias)
        runtime = _core_runtime(operator)
        rows = _node_rows(operator, name)
        target_row = rows[0] if len(rows) == 1 else None
        if target_row is not None:
            try:
                _assert_fenced_node(target_row, plan["registration"], require_available=False)
                result["target_matches_plan"] = True
            except BaseException as exc:
                result["target_matches_plan"] = False
                result["target_state_error"] = type(exc).__name__ + ": " + str(exc)
        result["core_runtime"] = {
            "active": runtime["ActiveState"] == "active",
            "sha256_matches_safe_release": runtime["sha256"] == release["artifact_sha256"],
            "invocation_id": runtime["InvocationID"],
        }
        result["target_registration"] = {
            "count": len(rows), "present": bool(rows),
            "bypass": target_row.get("bypass") if target_row else None,
            "available": target_row.get("available") if target_row else None,
        }
        try:
            _assert_cluster(operator, source_plan, plan["registration"],
                            target_present=target_row is not None,
                            require_available=False)
            result["cluster_scope_matches"] = True
        except BaseException as exc:
            result["cluster_scope_matches"] = False
            result["cluster_scope_error"] = type(exc).__name__ + ": " + str(exc)
        try:
            facts = install._post_facts(operator, plan, trusted,
                                        expected_agent_active=None, expected_agent_unit=None)
            result["worker"] = {
                "machine_id": facts["machine_id"], "boot_id": facts["boot_id"],
                "agent_active_state": facts["agent_active_state"],
                "agent_unit_state": facts["agent_unit_state"],
                "runtime_counts": facts["runtime_counts"],
            }
        except BaseException as exc:
            result["worker_error"] = type(exc).__name__ + ": " + str(exc)
        try:
            install._check_health(operator)
            result["core_health"] = "healthy"
        except BaseException as exc:
            result["core_health_error"] = type(exc).__name__ + ": " + str(exc)
    except BaseException as exc:
        result["error"] = type(exc).__name__ + ": " + str(exc)
    if journal.get("status") == "running":
        journal.update(status="interrupted", failed_at=journal.get("stage"), reconciled_at=_now())
    else:
        journal["reconciled_at"] = _now()
    journal["reconciliation"] = result
    journal["events"] = operator.events
    atomic_json(path, journal)
    return journal
