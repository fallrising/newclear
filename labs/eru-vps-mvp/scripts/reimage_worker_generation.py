"""Commit one verified worker replacement into the private inventory and generation."""
from datetime import datetime, timezone
import hashlib
import ipaddress
import json
from pathlib import Path
import uuid

from labops import atomic_json, digest
import reimage_worker_access as access
import reimage_worker_resume as resume
import reimage_worker_smoke as smoke


def _now():
    return datetime.now(timezone.utc).isoformat()


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _regular_json(path, label):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError(label + " is missing or unsafe")
    try:
        raw = path.read_bytes()
        value = json.loads(raw)
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(label + " is not valid JSON") from exc
    return value, raw


def _render_json(value):
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def _ipv4(value, label):
    try:
        address = ipaddress.ip_address(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(label + " is not an IPv4 address") from exc
    if address.version != 4:
        raise ValueError(label + " is not an IPv4 address")
    return str(address)


def _resume_proof(journal):
    keys = ("id", "operation", "plan_hash", "source_smoke_plan", "smoke_journal",
            "target", "target_alias", "status", "stage", "resume_attempted",
            "resume_outcome", "remote_mutation_attempted", "remote_mutation_performed",
            "available", "bypass", "post_resume")
    return {key: journal.get(key) for key in keys}


def _load_resume(operator, plan_id, plan_hash, *, observe):
    from labctl import identifier

    plan_id = identifier(plan_id)
    plan = resume._load_plan(operator, plan_id, plan_hash)
    journal_path = operator.root / "runs" / (plan_id + ".json")
    journal, _raw = _regular_json(journal_path, "worker resume journal")
    if (journal.get("id") != plan_id
            or journal.get("operation") != "provider-reimage-worker-resume"
            or journal.get("plan_hash") != plan_hash
            or journal.get("source_smoke_plan") != plan.get("smoke_plan")
            or journal.get("status") != "resumed-awaiting-generation-commit"
            or journal.get("stage") != "awaiting-generation-commit"
            or journal.get("target") != plan.get("target", {}).get("node")
            or journal.get("target_alias") != plan.get("target", {}).get("alias")
            or journal.get("resume_attempted") is not True
            or journal.get("resume_outcome") != "response-received"
            or journal.get("remote_mutation_attempted") is not True
            or journal.get("remote_mutation_performed") is not True
            or journal.get("available") is not True or journal.get("bypass") is not False
            or not isinstance(journal.get("post_resume"), dict)):
        raise ValueError("worker resume has not completed in the expected available state")
    if observe:
        reconciled = resume.reconcile_reimage_worker_resume(operator, plan_id, journal)
        report = reconciled.get("reconciliation", {})
        registration = report.get("target_registration", {})
        worker = report.get("worker", {})
        runtime_counts = worker.get("runtime_counts", {})
        if (report.get("error")
                or report.get("core_runtime", {}).get("active") is not True
                or report.get("core_runtime", {}).get("sha256_matches_safe_release") is not True
                or registration.get("present") is not True
                or registration.get("available") is not True
                or registration.get("bypass") is not False
                or registration.get("endpoint_matches_plan") is not True
                or report.get("cluster_scope_matches_plan") is not True
                or report.get("cluster_generation_matches_plan") is not True
                or worker.get("machine_id") != plan["target"]["machine_id"]
                or worker.get("boot_id") != plan["target"]["boot_id"]
                or worker.get("agent_active_state") != "active"
                or worker.get("agent_unit_state") != "enabled"
                or runtime_counts.get("containers") != 0
                or runtime_counts.get("tasks") != 0
                or report.get("service_state_matches_plan") is not True
                or report.get("core_health", {}).get("exit_code") != 0
                or report.get("canary_evidence", {}).get("sha256_matches_plan") is not True
                or report.get("smoke_evidence", {}).get("pass") is not True):
            raise ValueError("read-only resume reconciliation does not prove a healthy replacement")
        # Reconciliation records fresh read-only evidence in the source journal. Its
        # timestamps and SSH events vary, so bind the stable successful proof only.
        journal = reconciled
    return plan, journal


def _rewrite_inventory(operator, resume_plan, context):
    bootstrap, _source_plan, receipt, _observation, trusted = context[:5]
    target = resume_plan["target"]
    alias, node = target.get("alias"), target.get("node")
    new_ip = _ipv4(bootstrap.get("target", {}).get("tailscale_ipv4"),
                   "resumed worker address")
    if resume_plan.get("registration", {}).get("endpoint") != "containerd://ckc@" + new_ip + ":22":
        raise ValueError("resumed worker endpoint differs from the verified replacement address")
    path = operator.project / "private/deployment-plan.json"
    rows, _raw = _regular_json(path, "private deployment plan")
    if not isinstance(rows, list) or [row.get("alias") for row in rows] != [row["alias"] for row in operator.inventory]:
        raise ValueError("private deployment plan does not match the reviewed four-host topology")
    matches = [row for row in rows if row.get("alias") == alias]
    if len(matches) != 1:
        raise ValueError("private deployment plan lacks the exact replacement worker")
    worker = matches[0]
    expected = next((row for row in operator.inventory if row["alias"] == alias), None)
    if (expected is None or expected.get("role") != "worker"
            or worker.get("node") != node or worker.get("role") != "worker"
            or worker.get("ip") != expected["ip"]):
        raise ValueError("private worker identity or prior address changed")
    old_ip = _ipv4(worker["ip"], "prior worker address")
    other_ips = [_ipv4(row["ip"], "inventory address") for row in rows
                 if row.get("role") == "worker" and row.get("alias") != alias]
    if len(other_ips) != 2 or len(set(other_ips)) != 2 or new_ip in other_ips:
        raise ValueError("replacement address collides with another worker or topology is invalid")
    core_rows = [row for row in rows if row.get("role") == "core"]
    if len(core_rows) != 1 or core_rows[0].get("alias") != operator.core["alias"]:
        raise ValueError("private deployment plan does not have exactly one reviewed control plane")
    core_ip = _ipv4(core_rows[0].get("ip"), "control-plane address")
    for row in rows:
        if row.get("core_ip") != core_ip:
            raise ValueError("rendered deployment plan has a mismatched control-plane address")
    access_keys, fingerprints, key_check = access._trusted_keys(
        operator, bootstrap, receipt, trusted)
    proof = context[7].get("access_proof", {})
    if (proof.get("target_ip") != new_ip
            or proof.get("host_key_fingerprints") != fingerprints
            or proof.get("worker_ips") != [new_ip if ip == old_ip else ip
                                             for ip in [row["ip"] for row in operator.inventory[1:]]]):
        raise ValueError("verified core access proof does not match the replacement inventory")
    files = core_rows[0].get("files")
    if not isinstance(files, list):
        raise ValueError("rendered control-plane files are missing")
    known = [item for item in files if item.get("path") == "/etc/eru/known_hosts"]
    firewall = [item for item in files if item.get("path") == "/etc/eru/mvp-firewall.nft"]
    if len(known) != 1 or len(firewall) != 1:
        raise ValueError("rendered control-plane trust and firewall files are missing or duplicated")
    worker_ips = [_ipv4(row["ip"], "inventory worker address")
                  for row in operator.inventory if row["role"] == "worker"]
    old_known = known[0].get("content")
    old_firewall = firewall[0].get("content")
    if not isinstance(old_known, str) or not isinstance(old_firewall, str):
        raise ValueError("rendered control-plane access files are malformed")
    try:
        new_known = access._known_hosts_after(old_known.encode(), old_ip, new_ip,
                                               worker_ips, access_keys).decode()
    except (UnicodeDecodeError, ValueError) as exc:
        raise ValueError("rendered control-plane host trust cannot be safely updated") from exc
    if old_firewall.encode() != access._firewall_text(core_ip, worker_ips).encode():
        raise ValueError("rendered control-plane firewall differs from the reviewed ERU rules")
    new_worker_ips = [new_ip if ip == old_ip else ip for ip in worker_ips]
    worker["ip"] = new_ip
    known[0]["content"] = new_known
    firewall[0]["content"] = access._firewall_text(core_ip, new_worker_ips)
    return rows, {"alias": alias, "node": node, "old_ip": old_ip, "new_ip": new_ip,
                  "core_ip": core_ip, "worker_ips": new_worker_ips,
                  "trusted_host_key_file_sha256": key_check["file_sha256"],
                  "host_key_fingerprints": fingerprints}


def _plan_context(operator, resume_plan_id, resume_hash, *, observe):
    from labctl import code_inputs

    resume_plan, resume_journal = _load_resume(operator, resume_plan_id, resume_hash,
                                                observe=observe)
    smoke_plan = smoke._load_plan(operator, resume_plan["smoke_plan"]["id"],
                                  resume_plan["smoke_plan"]["sha256"])
    context = smoke._bootstrap_context(operator, smoke_plan["bootstrap_plan"]["id"],
                                       smoke_plan["bootstrap_plan"]["sha256"],
                                       require_registration=False)
    if context[0]["target"]["node"] != resume_plan["target"]["node"]:
        raise ValueError("replacement worker differs from the completed resume plan")
    deployment_path = operator.project / "private/deployment-plan.json"
    _deployment, deployment_raw = _regular_json(deployment_path, "private deployment plan")
    rows, target = _rewrite_inventory(operator, resume_plan, context)
    cluster_path = operator.root / "cluster.json"
    cluster, cluster_raw = _regular_json(cluster_path, "cluster generation")
    if cluster != resume_plan.get("cluster_binding"):
        raise ValueError("cluster generation changed after worker resume")
    cluster_after = dict(cluster)
    cluster_after["generation"] += 1
    after_bytes = _render_json(rows)
    return {
        "resume_plan": {"id": resume_plan["id"], "sha256": resume_hash},
        "resume_proof_sha256": digest(_resume_proof(resume_journal)),
        "bootstrap_plan": {"id": context[0]["id"],
                           "sha256": smoke_plan["bootstrap_plan"]["sha256"]},
        "cluster_before": cluster,
        "cluster_after": cluster_after,
        "cluster_before_sha256": _sha(cluster_raw),
        "cluster_after_sha256": _sha(_render_json(cluster_after)),
        "deployment_plan_before_sha256": _sha(deployment_raw),
        "deployment_plan_after_sha256": _sha(after_bytes),
        "target": target,
        "code_inputs_sha256": digest(code_inputs(operator.project)),
    }


def plan_reimage_worker_generation(operator, resume_plan_id, resume_hash):
    """Plan local-only private inventory and cluster-generation writes."""
    from labctl import identifier

    operator.events = []
    operator.journal_path = None
    operator.journal = None
    bound = _plan_context(operator, resume_plan_id, resume_hash, observe=True)
    plan_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    identifier(plan_id)
    plan = {
        "schema": 1,
        "id": plan_id,
        "created_at": _now(),
        "operation": "provider-reimage-worker-generation",
        **bound,
        "executable": True,
        "blockers": [],
        "mutation_hosts": [],
        "steps": [
            "Revalidate the successful worker resume, peer services, core access and unchanged generation",
            "Atomically replace only private/deployment-plan.json with the verified worker address and core access render",
            "Increment private/operations/cluster.json once; stop after the local commit",
            "Do not run another node up, smoke, cleanup, OS reimage or provider API operation",
        ],
    }
    path = operator.root / "reimage-worker-generation-plans" / (plan_id + ".json")
    if path.exists() or path.is_symlink():
        raise ValueError("worker generation plan already exists; do not overwrite it")
    envelope = {"plan": plan, "sha256": digest(plan)}
    atomic_json(path, envelope)
    atomic_json(operator.root / "observations" / (plan_id + "-worker-generation-plan.json"), operator.events)
    return envelope


def _load_plan(operator, plan_id, expected_hash):
    from labctl import identifier

    plan_id = identifier(plan_id)
    envelope, _raw = _regular_json(
        operator.root / "reimage-worker-generation-plans" / (plan_id + ".json"),
        "worker generation plan")
    plan = envelope.get("plan")
    if (not isinstance(plan, dict) or digest(plan) != envelope.get("sha256")
            or expected_hash != envelope.get("sha256") or plan.get("id") != plan_id
            or plan.get("operation") != "provider-reimage-worker-generation"
            or plan.get("executable") is not True or plan.get("blockers") != []
            or plan.get("mutation_hosts") != []):
        raise ValueError("worker generation plan hash or stage contract is invalid")
    return plan


def _local_state(operator):
    _deployment, deployment_raw = _regular_json(
        operator.project / "private/deployment-plan.json", "private deployment plan")
    cluster, cluster_raw = _regular_json(operator.root / "cluster.json", "cluster generation")
    return _sha(deployment_raw), _sha(cluster_raw), cluster


def _classify(operator, plan):
    deployment_hash, cluster_hash, cluster = _local_state(operator)
    before = (plan["deployment_plan_before_sha256"], plan["cluster_before_sha256"])
    after = (plan["deployment_plan_after_sha256"], plan["cluster_after_sha256"])
    actual = (deployment_hash, cluster_hash)
    if actual == after:
        return "complete", cluster
    if actual == before:
        return "not-started", cluster
    if actual == (after[0], before[1]):
        return "partial-inventory-committed", cluster
    return "drift", cluster


def _journal_path(operator, plan_id):
    return operator.root / "runs" / (plan_id + "-generation.json")


def commit_reimage_worker_generation(operator, plan_id, expected_hash):
    """Apply the two local private writes; exact partial state can resume after reconcile."""
    from labctl import code_inputs, identifier

    plan_id = identifier(plan_id)
    plan = _load_plan(operator, plan_id, expected_hash)
    run_id = plan_id + "-generation"
    identifier(run_id)
    path = _journal_path(operator, plan_id)
    if path.is_symlink():
        raise ValueError("worker generation journal is unsafe")
    resumed_ready_journal = None
    if path.exists():
        journal, _raw = _regular_json(path, "worker generation journal")
        if (journal.get("id") != run_id or journal.get("operation") != plan["operation"]
                or journal.get("plan_hash") != expected_hash):
            raise ValueError("worker generation journal does not match the plan")
        state, cluster = _classify(operator, plan)
        if journal.get("status") not in ("generation-commit-partial", "generation-commit-ready"):
            raise ValueError("worker generation operation already has a journal; reconcile it first")
        if state == "complete":
            journal.update(status="complete", stage="generation-committed", finished_at=_now())
            atomic_json(path, journal)
            return journal
        if state == "partial-inventory-committed":
            operator.events = []
            operator.journal_path = path
            operator.journal = journal
            operator.stage("committing-cluster-generation")
            atomic_json(operator.root / "cluster.json", plan["cluster_after"])
            operator.journal.update(status="complete", stage="generation-committed",
                                    committed_generation=plan["cluster_after"]["generation"],
                                    finished_at=_now())
            operator.save_journal()
            return operator.journal
        if state != "not-started" or journal.get("status") != "generation-commit-ready":
            raise ValueError("worker generation local files differ from the exact resumable state")
        resumed_ready_journal = journal

    if digest(code_inputs(operator.project)) != plan["code_inputs_sha256"]:
        raise ValueError("worker generation code inputs changed after planning")
    # Full remote and source-journal validation happens before either private write.
    fresh = _plan_context(operator, plan["resume_plan"]["id"],
                          plan["resume_plan"]["sha256"], observe=True)
    for key in ("resume_plan", "resume_proof_sha256", "bootstrap_plan", "cluster_before",
                "cluster_after", "cluster_before_sha256", "cluster_after_sha256",
                "deployment_plan_before_sha256", "deployment_plan_after_sha256", "target",
                "code_inputs_sha256"):
        if fresh.get(key) != plan.get(key):
            raise ValueError("worker generation binding changed after planning: " + key)
    deployment, current_raw = _regular_json(
        operator.project / "private/deployment-plan.json", "private deployment plan")
    if _sha(current_raw) != plan["deployment_plan_before_sha256"]:
        raise ValueError("private deployment plan changed after generation planning")
    # The source bootstrapping context is already fully validated above; its trusted
    # replacement key is derived again without copying it into a private plan or journal.
    resume_plan, _resume_journal = _load_resume(
        operator, plan["resume_plan"]["id"], plan["resume_plan"]["sha256"], observe=False)
    smoke_ref = resume_plan["smoke_plan"]
    smoke_plan = smoke._load_plan(operator, smoke_ref["id"], smoke_ref["sha256"])
    context = smoke._bootstrap_context(operator, smoke_plan["bootstrap_plan"]["id"],
                                       smoke_plan["bootstrap_plan"]["sha256"],
                                       require_registration=False)
    new_rows, _target = _rewrite_inventory(operator, resume_plan, context)
    deployment_after = _render_json(new_rows)
    if _sha(deployment_after) != plan["deployment_plan_after_sha256"]:
        raise ValueError("private deployment plan rendering differs from the reviewed generation plan")
    if plan["cluster_after"]["generation"] != plan["cluster_before"]["generation"] + 1:
        raise ValueError("worker generation plan does not increment the generation exactly once")
    journal = {
        "id": run_id, "operation": plan["operation"], "plan_id": plan_id,
        "plan_hash": expected_hash, "resume_plan": plan["resume_plan"],
        "target": plan["target"]["node"], "target_alias": plan["target"]["alias"],
        "status": "running", "stage": "preflight-complete", "started_at": _now(),
        "before": {"deployment_plan_sha256": plan["deployment_plan_before_sha256"],
                   "cluster_sha256": plan["cluster_before_sha256"]},
        "after": {"deployment_plan_sha256": plan["deployment_plan_after_sha256"],
                  "cluster_sha256": plan["cluster_after_sha256"]},
        "events": operator.events,
    }
    if resumed_ready_journal is not None:
        journal["recovered_after_reconcile"] = True
    atomic_json(path, journal)
    operator.journal_path, operator.journal = path, journal
    operator.stage("committing-private-deployment-plan")
    try:
        atomic_json(operator.project / "private/deployment-plan.json", new_rows)
        operator.stage("private-deployment-plan-committed")
        operator.stage("committing-cluster-generation")
        atomic_json(operator.root / "cluster.json", plan["cluster_after"])
        operator.journal.update(status="complete", stage="generation-committed",
                                committed_generation=plan["cluster_after"]["generation"],
                                finished_at=_now())
        operator.save_journal()
        return operator.journal
    except BaseException as exc:
        state, _cluster = _classify(operator, plan)
        operator.journal.update(status=("generation-commit-partial"
                                        if state == "partial-inventory-committed" else "failed"),
                                failed_at=operator.journal.get("stage"),
                                error=type(exc).__name__, finished_at=_now())
        operator.save_journal()
        raise


def reconcile_reimage_worker_generation(operator, run_id, journal=None):
    """Classify the private two-file commit without remote commands or file writes."""
    from labctl import identifier

    run_id = identifier(run_id)
    path = operator.root / "runs" / (run_id + ".json")
    if path.is_symlink() or not path.is_file():
        raise ValueError("worker generation journal is missing or unsafe")
    journal = journal if journal is not None else _regular_json(path, "worker generation journal")[0]
    if journal.get("operation") != "provider-reimage-worker-generation" or journal.get("id") != run_id:
        raise ValueError("journal is not a worker generation commit")
    plan_id = journal.get("plan_id")
    if run_id != str(plan_id) + "-generation":
        raise ValueError("worker generation journal ID differs from its plan")
    plan = _load_plan(operator, plan_id, journal.get("plan_hash"))
    state, cluster = _classify(operator, plan)
    if state == "complete":
        journal.update(status="complete", stage="generation-committed",
                       reconciliation={"state": state, "remote_mutation_performed": False,
                                       "generation": cluster["generation"]})
    elif state == "partial-inventory-committed":
        journal.update(status="generation-commit-partial", stage="private-deployment-plan-committed",
                       reconciliation={"state": state, "remote_mutation_performed": False,
                                       "next_step": "Explicitly re-run this exact commit plan to write only cluster generation."})
    elif state == "not-started":
        journal.update(status="generation-commit-ready", stage="preflight-complete",
                       reconciliation={"state": state, "remote_mutation_performed": False,
                                       "next_step": "Re-run this exact commit plan after reviewing read-only state."})
    else:
        journal.update(status="generation-commit-drift", stage="manual-review-required",
                       reconciliation={"state": state, "remote_mutation_performed": False,
                                       "next_step": "Do not replay; inspect the private files and create no new plan until reconciled."})
    journal["reconciled_at"] = _now()
    atomic_json(path, journal)
    return journal
