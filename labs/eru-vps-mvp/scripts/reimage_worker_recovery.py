"""Coordinate read-only recovery across the single-worker reimage stages."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import uuid

from labops import atomic_json, digest
import reimage_worker_install as install
import reimage_worker_generation as generation


WORKER_ALIASES = ("ckc-disposable-02", "ckc-disposable-03", "ckc-disposable-04")

STAGES = (
    ("worker-install", "provider-reimage-worker-install", "installed-awaiting-registration"),
    ("core-access", "provider-reimage-worker-access", "access-ready-awaiting-registration"),
    ("worker-registration", "provider-reimage-worker-registration", "registered-awaiting-smoke"),
    ("worker-smoke", "provider-reimage-worker-smoke", "smoked-awaiting-resume"),
    ("worker-resume", "provider-reimage-worker-resume", "resumed-awaiting-generation-commit"),
    ("worker-generation", "provider-reimage-worker-generation", "complete"),
)


def _now():
    return datetime.now(timezone.utc).isoformat()


def _read_json(path, label):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError(label + " is missing or unsafe")
    try:
        raw = path.read_bytes()
        value = json.loads(raw)
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(label + " is not valid JSON") from exc
    if not isinstance(value, dict):
        raise ValueError(label + " is malformed")
    return value, raw


def _load_bootstrap(operator, plan_id, plan_hash):
    plan = install._bootstrap(operator, plan_id, plan_hash)
    target = plan.get("target")
    if (not isinstance(target, dict) or target.get("alias") not in
            WORKER_ALIASES
            or target.get("node") not in ("worker-2", "worker-3", "worker-4")):
        raise ValueError("worker recovery is outside the reviewed worker scope")
    return plan


def _envelope(path, operation, label):
    value, raw = _read_json(path, label)
    plan = value.get("plan")
    if (not isinstance(plan, dict) or digest(plan) != value.get("sha256")
            or plan.get("id") != Path(path).stem
            or plan.get("operation") != operation):
        raise ValueError(label + " hash, identity or operation is invalid")
    return plan, value["sha256"], raw


def _latest_plan(operator, directory, operation, link_key, link_value):
    root = operator.root / directory
    if root.is_symlink():
        raise ValueError(directory + " directory is unsafe")
    if not root.exists():
        return None
    if not root.is_dir():
        raise ValueError(directory + " directory is unsafe")
    matches = []
    for path in root.glob("*.json"):
        plan, plan_hash, raw = _envelope(path, operation, operation + " plan")
        if plan.get(link_key) == link_value:
            matches.append((plan.get("created_at", ""), plan["id"], plan, plan_hash, raw))
    if not matches:
        return None
    _created, _plan_id, plan, plan_hash, raw = max(matches, key=lambda row: (row[0], row[1]))
    return plan, plan_hash, raw


def _journal(operator, run_id, operation, plan_hash, target):
    path = operator.root / "runs" / (run_id + ".json")
    if path.is_symlink():
        raise ValueError("worker recovery stage journal is unsafe")
    if not path.exists():
        return None
    journal, raw = _read_json(path, "worker recovery stage journal")
    if (journal.get("id") != run_id or journal.get("operation") != operation
            or journal.get("plan_hash") != plan_hash
            or journal.get("target") != target.get("node")
            or journal.get("target_alias") != target.get("alias")):
        raise ValueError("worker recovery stage journal does not match its plan")
    return journal, raw


def _stage_record(name, plan_ref, journal_ref, status):
    return {"stage": name, "plan": plan_ref, "journal": journal_ref, "status": status}


def _target_matches_stage(stage_plan, target):
    stage_target = stage_plan.get("target")
    if not isinstance(stage_target, dict):
        return False
    if any(stage_target.get(key) != target.get(key) for key in ("alias", "node")):
        return False
    for key in ("machine_id", "boot_id"):
        if key in stage_target and stage_target.get(key) != target.get(key):
            return False
    return True


def _journal_ref(result):
    journal, raw = result
    return {"id": journal["id"], "sha256": hashlib.sha256(raw).hexdigest()}


def _worker_scope(target, *, peers=False):
    hosts = ["ckc-disposable-01", target["alias"]]
    if peers:
        hosts.extend(alias for alias in WORKER_ALIASES if alias != target["alias"])
    return hosts


def _reconcile_action(record, target):
    journal = record["journal"]
    stage = record["stage"]
    if stage == "worker-generation":
        host_scope = ["B-local-private-files"]
    elif stage == "core-access":
        host_scope = ["ckc-disposable-01"]
    else:
        host_scope = _worker_scope(target, peers=stage in ("worker-smoke", "worker-resume"))
    return {
        "kind": "reconcile",
        "stage": record["stage"],
        "run_id": journal["id"],
        "host_scope": host_scope,
        "command": "python3 scripts/labctl.py recover-reimage-worker-chain --plan RECOVERY_PLAN_ID --sha256 RECOVERY_PLAN_SHA256",
    }


def _stage_command(kind, stage, command, host_scope):
    return {"kind": kind, "stage": stage, "host_scope": host_scope, "command": command}


def _collect(operator, bootstrap_plan_id, bootstrap_hash, canary_run=None):
    from labctl import identifier
    bootstrap = _load_bootstrap(operator, bootstrap_plan_id, bootstrap_hash)
    target = {"alias": bootstrap["target"]["alias"], "node": bootstrap["target"]["node"]}
    bootstrap_ref = {"id": bootstrap["id"], "sha256": bootstrap_hash}
    records = []

    def stop(record, action):
        records.append(record)
        return {
            "bootstrap_plan": bootstrap_ref,
            "target": target,
            "chain": records,
            "chain_sha256": digest(records),
            "current_stage": record["stage"],
            "next_action": action,
            "complete": action["kind"] == "complete",
        }

    # Install has no separate plan: the immutable bootstrap plan is its gate.
    run_id = bootstrap["id"]
    install_result = _journal(operator, run_id, STAGES[0][1], bootstrap_hash, target)
    install_journal = install_result[0] if install_result else None
    install_record = _stage_record(
        "worker-install", bootstrap_ref,
        ({"id": run_id, "sha256": hashlib.sha256(install_result[1]).hexdigest(),
          "status": install_journal.get("status"), "stage": install_journal.get("stage")}
         if install_journal else None),
        install_journal.get("status") if install_journal else "not-started")
    if not install_journal:
        command = ("python3 scripts/labctl.py install-reimage-worker --plan " + bootstrap["id"]
                   + " --sha256 " + bootstrap_hash)
        return stop(install_record, _stage_command(
            "execute", "worker-install", command, ["ckc-disposable-01", target["alias"]]))
    if install_journal.get("status") != STAGES[0][2]:
        return stop(install_record, _reconcile_action(install_record, target))
    records.append(install_record)

    access_candidate = _latest_plan(
        operator, "reimage-worker-access-plans", STAGES[1][1], "bootstrap_plan", bootstrap_ref)
    if not access_candidate:
        command = ("python3 scripts/labctl.py plan-reimage-worker-access --plan " + bootstrap["id"]
                   + " --sha256 " + bootstrap_hash)
        return {
            "bootstrap_plan": bootstrap_ref, "target": target, "chain": records,
            "chain_sha256": digest(records), "current_stage": "core-access",
            "next_action": _stage_command("plan", "core-access", command,
                                           _worker_scope(target)),
            "complete": False,
        }
    access_plan, access_hash, _access_raw = access_candidate
    if (not _target_matches_stage(access_plan, bootstrap["target"])
            or access_plan.get("install_journal") != _journal_ref(install_result)):
        raise ValueError("core access plan targets another worker")
    access_run_id = access_plan["id"] + "-access"
    access_result = _journal(operator, access_run_id, STAGES[1][1], access_hash, target)
    access_journal = access_result[0] if access_result else None
    access_ref = {"id": access_plan["id"], "sha256": access_hash}
    access_record = _stage_record(
        "core-access", access_ref,
        ({"id": access_run_id, "sha256": hashlib.sha256(access_result[1]).hexdigest(),
          "status": access_journal.get("status"), "stage": access_journal.get("stage")}
         if access_journal else None),
        access_journal.get("status") if access_journal else "not-started")
    if not access_journal:
        command = ("python3 scripts/labctl.py prepare-reimage-worker-access --plan " + access_plan["id"]
                   + " --sha256 " + access_hash)
        return stop(access_record, _stage_command(
            "execute", "core-access", command, ["ckc-disposable-01"]))
    if access_journal.get("status") != STAGES[1][2]:
        return stop(access_record, _reconcile_action(access_record, target))
    records.append(access_record)

    register_run_id = bootstrap["id"] + "-register"
    register_result = _journal(operator, register_run_id, STAGES[2][1], bootstrap_hash, target)
    register_journal = register_result[0] if register_result else None
    if (register_journal is not None
            and register_journal.get("access_proof") != access_journal.get("access_proof")):
        raise ValueError("worker registration is not linked to the current core access proof")
    register_record = _stage_record(
        "worker-registration", bootstrap_ref,
        ({"id": register_run_id, "sha256": hashlib.sha256(register_result[1]).hexdigest(),
          "status": register_journal.get("status"), "stage": register_journal.get("stage")}
         if register_journal else None),
        register_journal.get("status") if register_journal else "not-started")
    if not register_journal:
        command = ("python3 scripts/labctl.py register-reimage-worker --plan " + bootstrap["id"]
                   + " --sha256 " + bootstrap_hash)
        return stop(register_record, _stage_command(
            "execute", "worker-registration", command,
            ["ckc-disposable-01", target["alias"]]))
    if register_journal.get("status") != STAGES[2][2]:
        return stop(register_record, _reconcile_action(register_record, target))
    records.append(register_record)

    smoke_candidate = _latest_plan(
        operator, "reimage-worker-smoke-plans", STAGES[3][1], "bootstrap_plan", bootstrap_ref)
    if not smoke_candidate:
        if canary_run is None:
            action = _stage_command("input-required", "worker-smoke", None,
                                    _worker_scope(target, peers=True))
            action["required_input"] = "an existing run-owned peer canary run ID"
        else:
            canary_run = identifier(canary_run)
            command = ("python3 scripts/labctl.py plan-reimage-worker-smoke --plan " + bootstrap["id"]
                       + " --sha256 " + bootstrap_hash + " --canary-run " + canary_run)
            action = _stage_command("plan", "worker-smoke", command,
                                    _worker_scope(target, peers=True))
        return {
            "bootstrap_plan": bootstrap_ref, "target": target, "chain": records,
            "chain_sha256": digest(records), "current_stage": "worker-smoke",
            "next_action": action, "complete": False,
        }
    smoke_plan, smoke_hash, _smoke_raw = smoke_candidate
    if (smoke_plan.get("target", {}).get("node") != target["node"]
            or not _target_matches_stage(smoke_plan, bootstrap["target"])
            or smoke_plan.get("registration_run") != _journal_ref(register_result)):
        raise ValueError("worker smoke plan is not linked to the current registration")
    smoke_run_id = smoke_plan["id"]
    smoke_result = _journal(operator, smoke_run_id, STAGES[3][1], smoke_hash, target)
    smoke_journal = smoke_result[0] if smoke_result else None
    smoke_ref = {"id": smoke_plan["id"], "sha256": smoke_hash}
    smoke_record = _stage_record(
        "worker-smoke", smoke_ref,
        ({"id": smoke_run_id, "sha256": hashlib.sha256(smoke_result[1]).hexdigest(),
          "status": smoke_journal.get("status"), "stage": smoke_journal.get("stage")}
         if smoke_journal else None),
        smoke_journal.get("status") if smoke_journal else "not-started")
    if not smoke_journal:
        command = "python3 scripts/labctl.py smoke-reimage-worker --plan " + smoke_plan["id"] + " --sha256 " + smoke_hash
        return stop(smoke_record, _stage_command(
            "execute", "worker-smoke", command,
            _worker_scope(target, peers=True)))
    if smoke_journal.get("status") != STAGES[3][2]:
        return stop(smoke_record, _reconcile_action(smoke_record, target))
    records.append(smoke_record)

    resume_candidate = _latest_plan(
        operator, "reimage-worker-resume-plans", STAGES[4][1], "smoke_plan", smoke_ref)
    if not resume_candidate:
        command = ("python3 scripts/labctl.py plan-reimage-worker-resume --plan " + smoke_plan["id"]
                   + " --sha256 " + smoke_hash)
        return {
            "bootstrap_plan": bootstrap_ref, "target": target, "chain": records,
            "chain_sha256": digest(records), "current_stage": "worker-resume",
            "next_action": _stage_command("plan", "worker-resume", command,
                                           _worker_scope(target, peers=True)),
            "complete": False,
        }
    resume_plan, resume_hash, _resume_raw = resume_candidate
    if (resume_plan.get("target", {}).get("node") != target["node"]
            or not _target_matches_stage(resume_plan, bootstrap["target"])
            or resume_plan.get("smoke_plan") != smoke_ref
            or resume_plan.get("smoke_journal") != _journal_ref(smoke_result)):
        raise ValueError("worker resume plan is not linked to the current smoke stage")
    resume_run_id = resume_plan["id"]
    resume_result = _journal(operator, resume_run_id, STAGES[4][1], resume_hash, target)
    resume_journal = resume_result[0] if resume_result else None
    resume_ref = {"id": resume_plan["id"], "sha256": resume_hash}
    resume_record = _stage_record(
        "worker-resume", resume_ref,
        ({"id": resume_run_id, "sha256": hashlib.sha256(resume_result[1]).hexdigest(),
          "status": resume_journal.get("status"), "stage": resume_journal.get("stage")}
         if resume_result else None),
        resume_journal.get("status") if resume_journal else "not-started")
    if not resume_journal:
        command = "python3 scripts/labctl.py resume-reimage-worker --plan " + resume_plan["id"] + " --sha256 " + resume_hash
        return stop(resume_record, _stage_command(
            "execute", "worker-resume", command,
            _worker_scope(target, peers=True)))
    if resume_journal.get("status") != STAGES[4][2]:
        return stop(resume_record, _reconcile_action(resume_record, target))
    records.append(resume_record)

    generation_candidate = _latest_plan(
        operator, "reimage-worker-generation-plans", STAGES[5][1], "resume_plan", resume_ref)
    if not generation_candidate:
        command = ("python3 scripts/labctl.py plan-reimage-worker-generation --plan " + resume_plan["id"]
                   + " --sha256 " + resume_hash)
        return {
            "bootstrap_plan": bootstrap_ref, "target": target, "chain": records,
            "chain_sha256": digest(records), "current_stage": "worker-generation",
            "next_action": _stage_command("plan", "worker-generation", command,
                                           _worker_scope(target, peers=True)),
            "complete": False,
        }
    generation_plan, generation_hash, _generation_raw = generation_candidate
    if (generation_plan.get("target", {}).get("node") != target["node"]
            or not _target_matches_stage(generation_plan, bootstrap["target"])
            or generation_plan.get("resume_plan") != resume_ref
            or generation_plan.get("resume_proof_sha256") != digest(
                generation._resume_proof(resume_journal))):
        raise ValueError("worker generation plan is not linked to the current resume stage")
    generation_run_id = generation_plan["id"] + "-generation"
    generation_result = _journal(operator, generation_run_id, STAGES[5][1], generation_hash, target)
    generation_journal = generation_result[0] if generation_result else None
    generation_ref = {"id": generation_plan["id"], "sha256": generation_hash}
    generation_record = _stage_record(
        "worker-generation", generation_ref,
        ({"id": generation_run_id, "sha256": hashlib.sha256(generation_result[1]).hexdigest(),
          "status": generation_journal.get("status"), "stage": generation_journal.get("stage")}
         if generation_result else None),
        generation_journal.get("status") if generation_journal else "not-started")
    if not generation_journal:
        command = ("python3 scripts/labctl.py commit-reimage-worker-generation --plan "
                   + generation_plan["id"] + " --sha256 " + generation_hash)
        return stop(generation_record, _stage_command(
            "execute", "worker-generation", command, ["B-local-private-files"]))
    generation_is_complete = generation_journal.get("status") == STAGES[5][2]
    if generation_is_complete:
        try:
            generation_is_complete = generation._classify(operator, generation_plan)[0] == "complete"
        except (OSError, ValueError, KeyError, TypeError):
            generation_is_complete = False
    if not generation_is_complete:
        return stop(generation_record, _reconcile_action(generation_record, target))
    records.append(generation_record)
    return {
        "bootstrap_plan": bootstrap_ref, "target": target, "chain": records,
        "chain_sha256": digest(records), "current_stage": "complete",
        "next_action": {"kind": "complete", "stage": "worker-generation", "command": None},
        "complete": True,
    }


def plan_reimage_worker_recovery(operator, bootstrap_plan_id, bootstrap_hash, canary_run=None):
    """Bind one chain snapshot and select its first safe action; never mutates a host."""
    from labctl import identifier

    operator.events = []
    operator.journal_path = None
    operator.journal = None
    bootstrap_plan_id = identifier(bootstrap_plan_id)
    if canary_run is not None:
        canary_run = identifier(canary_run)
    snapshot = _collect(operator, bootstrap_plan_id, bootstrap_hash, canary_run)
    plan_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    plan = {
        "schema": 1,
        "id": plan_id,
        "created_at": _now(),
        "operation": "provider-reimage-worker-chain-recovery",
        "bootstrap_plan": snapshot["bootstrap_plan"],
        "target": snapshot["target"],
        "chain": snapshot["chain"],
        "chain_sha256": snapshot["chain_sha256"],
        "current_stage": snapshot["current_stage"],
        "next_action": snapshot["next_action"],
        "complete": snapshot["complete"],
        "executable": snapshot["next_action"]["kind"] == "reconcile",
        "blockers": [],
        "mutation_hosts": [],
    }
    path = operator.root / "reimage-worker-recovery-plans" / (plan_id + ".json")
    if path.exists() or path.is_symlink():
        raise ValueError("worker recovery plan already exists; do not overwrite it")
    envelope = {"plan": plan, "sha256": digest(plan)}
    atomic_json(path, envelope)
    atomic_json(operator.root / "observations" / (plan_id + "-worker-recovery-plan.json"), operator.events)
    return envelope


def _load_plan(operator, plan_id, expected_hash):
    from labctl import identifier

    plan_id = identifier(plan_id)
    envelope, _raw = _read_json(operator.root / "reimage-worker-recovery-plans" / (plan_id + ".json"),
                                "worker recovery plan")
    plan = envelope.get("plan")
    if (not isinstance(plan, dict) or digest(plan) != envelope.get("sha256")
            or expected_hash != envelope.get("sha256") or plan.get("id") != plan_id
            or plan.get("operation") != "provider-reimage-worker-chain-recovery"
            or plan.get("executable") is not True or plan.get("blockers") != []
            or plan.get("mutation_hosts") != []
            or plan.get("next_action", {}).get("kind") != "reconcile"):
        raise ValueError("worker recovery plan hash or stage contract is invalid")
    return plan


def recover_reimage_worker_chain(operator, plan_id, expected_hash):
    """Run only the selected stage's existing read-only reconciler exactly once."""
    from labctl import identifier

    plan_id = identifier(plan_id)
    plan = _load_plan(operator, plan_id, expected_hash)
    run_id = identifier(plan_id + "-recovery")
    path = operator.root / "runs" / (run_id + ".json")
    if path.exists() or path.is_symlink():
        raise ValueError("worker recovery already has a journal; reconcile it and create a fresh plan")
    latest = _collect(operator, plan["bootstrap_plan"]["id"],
                      plan["bootstrap_plan"]["sha256"],
                      plan.get("next_action", {}).get("canary_run"))
    if (latest.get("chain_sha256") != plan.get("chain_sha256")
            or latest.get("current_stage") != plan.get("current_stage")
            or latest.get("next_action") != plan.get("next_action")):
        raise ValueError("worker stage chain changed after recovery planning")
    action = plan["next_action"]
    stage_record = next((row for row in plan["chain"] if row["stage"] == action["stage"]), None)
    if not isinstance(stage_record, dict) or not isinstance(stage_record.get("journal"), dict):
        raise ValueError("recovery plan lacks its exact failed stage journal")
    journal = {
        "id": run_id, "operation": plan["operation"], "plan_id": plan_id,
        "plan_hash": expected_hash, "bootstrap_plan": plan["bootstrap_plan"],
        "target": plan["target"]["node"], "target_alias": plan["target"]["alias"],
        "stage_run_id": action["run_id"], "stage": action["stage"],
        "status": "running", "started_at": _now(), "remote_mutation_performed": False,
        "events": [],
    }
    atomic_json(path, journal)
    operator.journal_path, operator.journal = path, journal
    operator.events = []
    operator.stage("reconciling-" + action["stage"])
    try:
        result = operator.reconcile(action["run_id"])
        rec = result.get("reconciliation", {})
        if (result.get("id") != action["run_id"]
                or rec.get("remote_mutation_performed") is not False
                or rec.get("node_up_replayed") is True
                or (action["stage"] == "worker-resume"
                    and rec.get("node_up_replayed") is not False)):
            raise ValueError("stage reconciler did not preserve the read-only recovery contract")
        operator.journal_path, operator.journal = path, journal
        operator.events = []
        operator.journal.update(
            status="reconciled", finished_at=_now(), remote_mutation_performed=False,
            stage_reconciliation={
                "run_id": result.get("id", action["run_id"]),
                "status": result.get("status"), "stage": result.get("stage"),
                "summary_sha256": digest(rec),
                "node_up_replayed": rec.get("node_up_replayed"),
                "remote_mutation_performed": rec.get("remote_mutation_performed"),
                "read_only_contract_verified": True,
            })
        operator.save_journal()
        return operator.journal
    except BaseException as exc:
        operator.journal_path, operator.journal = path, journal
        operator.events = []
        operator.journal.update(status="failed", failed_at=operator.journal.get("stage"),
                                error=type(exc).__name__, finished_at=_now(),
                                remote_mutation_performed=False)
        operator.save_journal()
        raise


def reconcile_reimage_worker_chain(operator, run_id, journal=None):
    """Read the chain-recovery journal locally; do not invoke another stage."""
    from labctl import identifier

    run_id = identifier(run_id)
    path = operator.root / "runs" / (run_id + ".json")
    if path.is_symlink() or not path.is_file():
        raise ValueError("worker chain recovery journal is missing or unsafe")
    journal = journal if journal is not None else _read_json(path, "worker chain recovery journal")[0]
    if journal.get("operation") != "provider-reimage-worker-chain-recovery" or journal.get("id") != run_id:
        raise ValueError("journal is not a worker chain recovery")
    plan_id = journal.get("plan_id")
    if run_id != str(plan_id) + "-recovery":
        raise ValueError("worker recovery journal ID differs from its plan")
    _load_plan(operator, plan_id, journal.get("plan_hash"))
    journal["reconciled_at"] = _now()
    atomic_json(path, journal)
    return journal
