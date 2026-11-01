#!/usr/bin/env python3
"""Bounded one-shot SSH down tools; actual use requires separate session authority.

Private APIs return bound records; CLI emits only aggregate sanitized summaries.
An admission is an operator declaration, never authenticated authorization.
"""
import argparse
import copy
import os
from pathlib import Path
import re
import shlex
import sys
import uuid

import labctl
import ssh_helper as helper

REMOTE_COMMAND = "python3 -I -c " + shlex.quote(Path(helper.__file__).read_text(encoding="utf-8"))
ORDER = ["A", "R3", "R2", "R1", "M3", "M2", "M1"]
LIVE = {"lane": "ssh-tools", "live_runtime": "UNEXECUTED", "live_ready": False}
require = labctl.require
shape = labctl.shape


def validated_manifest(manifest, expected_digest):
    # This is the sole authority for bundle semantics; no fallback implementation.
    import bundle
    return bundle.validate_manifest(manifest, expected_digest)


def validate_ownership(manifest, ownership):
    shape(ownership, {"schema_version", "run_id", "plan_sha256", "bundle_sha256", "targets"})
    plan = manifest["source_plan"]
    expected = {"schema_version": 1, "run_id": plan["run_id"],
                "plan_sha256": plan["plan_sha256"], "bundle_sha256": manifest["bundle_sha256"]}
    for key, value in expected.items():
        require(type(ownership[key]) is type(value) and ownership[key] == value, "ownership-binding")
    require(type(ownership["targets"]) is list and 1 <= len(ownership["targets"]) <= 7, "ownership-targets")
    roles, ids = set(), set()
    for target in ownership["targets"]:
        shape(target, {"host", "role", "container_id"})
        role, host, rid = target["role"], target["host"], target["container_id"]
        require(type(role) is str and role in helper.ROLES and role not in roles, "ownership-targets")
        require(type(host) is str and host == helper.ROLES[role], "ownership-targets")
        require(type(rid) is str and helper.HEX.fullmatch(rid) and rid not in ids, "ownership-targets")
        roles.add(role)
        ids.add(rid)
    return copy.deepcopy(ownership)


def make_request(manifest, target, operation, operation_id=None):
    plan = manifest["source_plan"]
    host = next(h for h in plan["inventory"]["hosts"] if h["role"] == target["host"])
    req = {"schema_version": 1, "operation_id": operation_id or uuid.uuid4().hex,
           "operation": operation, "run_id": plan["run_id"], "plan_sha256": plan["plan_sha256"],
           "bundle_sha256": manifest["bundle_sha256"], "host": target["host"],
           "machine_identity_sha256": host["machine_identity_sha256"],
           "target": {"role": target["role"], "container_id": target["container_id"]}}
    try:
        return helper.validate_request(req)
    except helper.ProtocolError:
        raise labctl.LabError("invalid-request") from None


def private_file(path):
    require(type(path) is str, "unsafe-input")
    path = Path(path)
    require(path.is_absolute() and ".." not in path.parts and str(path) == os.path.normpath(str(path)), "unsafe-input")
    try:
        with labctl.directory(path.parent) as dirfd:
            fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=dirfd)
            try:
                labctl.file_stat(fd, True)
            finally:
                os.close(fd)
    except OSError:
        raise labctl.LabError("unsafe-input") from None
    return str(path)


def load_private(path):
    path = Path(private_file(str(path)))
    try:
        with labctl.directory(path.parent) as dirfd:
            return labctl.read_at(dirfd, path.name, True)
    except OSError:
        raise labctl.LabError("unsafe-input") from None


def validate_ssh_mapping(path):
    """Accept an explicit reduced mapping, never executable SSH config hooks."""
    allowed = {"host", "hostname", "user", "port", "identityfile", "certificatefile",
               "identitiesonly", "hostkeyalias", "hostkeyalgorithms", "pubkeyacceptedalgorithms",
               "requiredrsasize", "preferredauthentications"}
    try:
        path = Path(path)
        with labctl.directory(path.parent) as dirfd:
            fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=dirfd)
            try:
                labctl.file_stat(fd, True)
                raw = os.read(fd, helper.MAX_BYTES + 1)
            finally:
                os.close(fd)
        require(len(raw) <= helper.MAX_BYTES and
                all(byte in {9, 10} or 32 <= byte <= 126 for byte in raw), "invalid-ssh-mapping")
        for line in raw.decode("ascii").splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            match = re.fullmatch(r"\s*([A-Za-z][A-Za-z0-9]*)\s*(?:=\s*)?(.*)", line)
            require(match is not None and match[1].lower() in allowed, "invalid-ssh-mapping")
            values = shlex.split(match[2], comments=True, posix=True)
            require(values and (match[1].lower() == "host" or len(values) == 1), "invalid-ssh-mapping")
    except (OSError, ValueError, UnicodeError):
        raise labctl.LabError("invalid-ssh-mapping") from None


def ssh_argv(config, alias):
    shape(config, {"schema_version", "ssh_config", "known_hosts", "deadline_seconds"})
    require(type(config["schema_version"]) is int and config["schema_version"] == 1)
    require(type(config["deadline_seconds"]) is int and 1 <= config["deadline_seconds"] <= 60)
    require(type(alias) is str and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]{0,62}", alias), "invalid-alias")
    conf, known = private_file(config["ssh_config"]), private_file(config["known_hosts"])
    # OpenSSH expands tokens and splits known-hosts path lists independently
    # of the local argv boundary. Only literal unambiguous paths are accepted.
    require(all(re.fullmatch(r"/[A-Za-z0-9_./-]+", path) for path in (conf, known)), "unsafe-mapping-path")
    validate_ssh_mapping(conf)
    argv = ["/usr/bin/ssh", "-F", conf, "-T"]
    options = ["BatchMode=yes", "StrictHostKeyChecking=yes", "UserKnownHostsFile=" + known,
               "GlobalKnownHostsFile=/dev/null", "UpdateHostKeys=no", "VerifyHostKeyDNS=no",
               "KnownHostsCommand=none", "CanonicalizeHostname=no", "ForkAfterAuthentication=no",
               "ForwardAgent=no", "ForwardX11=no", "ForwardX11Trusted=no", "ClearAllForwardings=yes",
               "ExitOnForwardFailure=yes", "Tunnel=no", "RequestTTY=no", "ControlMaster=no",
               "ControlPath=none", "ControlPersist=no", "PermitLocalCommand=no", "RemoteCommand=none",
               "ProxyCommand=none", "ProxyJump=none", "IdentityAgent=none", "IdentitiesOnly=yes",
               "ConnectionAttempts=1", "ConnectTimeout=" + str(min(config["deadline_seconds"], 10)),
               "ServerAliveInterval=2", "ServerAliveCountMax=1", "SessionType=default", "StdinNull=no",
               "EscapeChar=none"]
    for option in options:
        argv.extend(["-o", option])
    return argv + ["--", alias, REMOTE_COMMAND]


def validate_response(req, response, origin):
    try:
        helper.shape(response, helper.REQUEST_KEYS | {"origin", "observation"})
        helper.validate_request({k: response[k] for k in helper.REQUEST_KEYS})
        helper.require(all(response[k] == v and type(response[k]) is type(v) for k, v in req.items()))
        helper.require(response["origin"] == origin)
        helper.require(type(response["observation"]) is str and
                       response["observation"] in {"running", "stopped", "absent", "foreign", "unknown"})
    except helper.ProtocolError:
        raise labctl.LabError("invalid-response") from None
    return response


class Transport:
    """The private test runner seam cannot be selected through CLI input."""
    def __init__(self, config, *, _runner=None):
        self.config = copy.deepcopy(config)
        self._runner = _runner or helper.bounded_run
        self.origin = "mock-ssh" if _runner is not None else "ssh"

    def send(self, req, alias):
        try:
            helper.validate_request(req)
            argv = ssh_argv(self.config, alias)
            raw = self._runner(argv, helper.canonical(req), self.config["deadline_seconds"], helper.MAX_BYTES)
            return validate_response(req, helper.decode(raw), self.origin)
        except (helper.ProtocolError, OSError):
            raise labctl.LabError("transport-uncertain") from None


def validate_admission(admission, ownership):
    shape(admission, {"schema_version", "purpose", "admission_id", "approval_reference",
                      "ownership", "actions", "clients_stopped"})
    require(type(admission["schema_version"]) is int and admission["schema_version"] == 1)
    require(admission["purpose"] == "down" and type(admission["purpose"]) is str, "down-admission-required")
    require(type(admission["admission_id"]) is str and helper.OPID.fullmatch(admission["admission_id"]), "invalid-admission")
    labctl.reference(admission["approval_reference"])
    require(admission["approval_reference"] != "UNRESOLVED", "invalid-admission")
    require(labctl.canonical(admission["ownership"]) == labctl.canonical(ownership), "admission-binding")
    require(admission["actions"] == ["stop", "remove"] and type(admission["actions"]) is list, "admission-actions")
    require(admission["clients_stopped"] is True, "clients-must-stop")
    return admission


def initial_state(ownership, binding, origin):
    return {"schema_version": 1, "lane": "ssh-owned-state", "origin": origin,
            "ownership": ownership, "root_binding": binding, "journal": []}


def validate_state(state, ownership, binding, origin, manifest):
    expected = initial_state(ownership, binding, origin)
    shape(state, expected)
    for key in expected:
        if key != "journal":
            require(labctl.canonical(state[key]) == labctl.canonical(expected[key]), "state-binding")
    journal = state["journal"]
    require(type(journal) is list and len(journal) <= labctl.MAX_OPERATIONS, "invalid-journal")
    ids, admissions = set(), {}
    uncertain = 0
    removed = set()
    for op in journal:
        shape(op, {"request", "status", "admission_id", "approval_reference"})
        require(type(op["status"]) is str and op["status"] in {"uncertain", "completed"}, "invalid-journal")
        req = op["request"]
        require(type(req) is dict and type(req.get("operation")) is str and req["operation"] in {"stop", "remove"}, "invalid-journal")
        target = next((t for t in ownership["targets"] if req.get("target") ==
                       {"role": t["role"], "container_id": t["container_id"]}), None)
        require(target is not None, "invalid-journal")
        derived = make_request(manifest, target, req["operation"], req.get("operation_id"))
        require(labctl.canonical(req) == labctl.canonical(derived) and req["operation_id"] not in ids, "invalid-journal")
        ids.add(req["operation_id"])
        require(type(op["admission_id"]) is str and helper.OPID.fullmatch(op["admission_id"]), "invalid-journal")
        labctl.reference(op["approval_reference"])
        require(op["approval_reference"] != "UNRESOLVED", "invalid-journal")
        require(op["admission_id"] not in admissions or admissions[op["admission_id"]] == op["approval_reference"], "invalid-journal")
        admissions[op["admission_id"]] = op["approval_reference"]
        rid = target["container_id"]
        require(rid not in removed, "invalid-journal")
        if op["status"] == "completed":
            if req["operation"] == "remove":
                removed.add(rid)
        uncertain += op["status"] == "uncertain"
    require(uncertain <= 1 and not any(op["status"] == "uncertain" for op in journal[:-1]), "invalid-journal")


def completed_removes(state):
    return {o["request"]["target"]["container_id"] for o in state["journal"]
            if o["status"] == "completed" and o["request"]["operation"] == "remove"}


def control(manifest, expected_bundle_digest, ownership, state_root, action, transport,
            *, admission=None, execute_approved=False):
    manifest = validated_manifest(manifest, expected_bundle_digest)
    ownership = validate_ownership(manifest, ownership)
    require(type(action) is str and action in {"down", "reconcile", "observe"}, "unsupported-action")
    require(getattr(transport, "origin", None) in {"ssh", "mock-ssh"}, "invalid-origin")
    if action == "down":
        require(execute_approved is True, "execute-approved-required")
        validate_admission(admission, ownership)
        require(manifest["runtime_spec"]["mithril_image"] != "UNRESOLVED", "draft-bundle-refused")
    elif transport.origin == "ssh":
        require(execute_approved is True, "execute-approved-required")
    state_root = Path(state_root)
    # Reject lexical traversal, source and all remote-intent ancestry before mkdir.
    require(".." not in state_root.parts, "unsafe-state-root")
    labctl.outside_source(state_root)
    for h in manifest["source_plan"]["inventory"]["hosts"]:
        remote = Path(h["data_root"])
        require(remote != state_root and remote not in state_root.parents and state_root not in remote.parents,
                "remote-intent-state-root")
    def send(target, operation, operation_id=None):
        req = make_request(manifest, target, operation, operation_id)
        host = next(h for h in manifest["source_plan"]["inventory"]["hosts"] if h["role"] == target["host"])
        return req, validate_response(req, transport.send(req, host["ssh_alias"]), transport.origin)
    try:
        with labctl.owned_scope(state_root, action in {"down", "observe"}) as (dirfd, binding, new):
            require(set(os.listdir(dirfd)) <= {"state.json", ".lock"}, "unknown-state")
            if new:
                labctl.atomic_write(dirfd, "state.json", initial_state(ownership, binding, transport.origin))
            state = labctl.read_at(dirfd, "state.json", True)
            validate_state(state, ownership, binding, transport.origin, manifest)
            pending = [op for op in state["journal"] if op["status"] == "uncertain"]
            if action == "down":
                require(not pending, "reconcile-required")
                for op in state["journal"]:
                    if op["admission_id"] == admission["admission_id"]:
                        require(op["approval_reference"] == admission["approval_reference"], "admission-reused")
            observations = {}
            for target in ownership["targets"]:
                try:
                    _, reply = send(target, "observe")
                    observations[target["container_id"]] = reply["observation"]
                except labctl.LabError:
                    observations[target["container_id"]] = "unknown"
            if action == "reconcile":
                changed = False
                for op in pending:
                    observed = observations[op["request"]["target"]["container_id"]]
                    terminal = "stopped" if op["request"]["operation"] == "stop" else "absent"
                    # Opposite observations cannot prove timed-out remote work
                    # has terminated. Keep its durable fence even under a new
                    # admission; only the matching terminal state resolves it.
                    if observed == terminal:
                        op["status"] = "completed"
                        changed = True
                if changed:
                    labctl.atomic_write(dirfd, "state.json", state)
            elif action == "down":
                removed = completed_removes(state)
                stopped = {o["request"]["target"]["container_id"] for o in state["journal"]
                           if o["status"] == "completed" and o["request"]["operation"] == "stop"}
                require(all((value == "absent" if rid in removed else
                             value == "stopped" if rid in stopped else value in {"running", "stopped"})
                            for rid, value in observations.items()), "unknown-or-foreign-state")
                ordered = sorted(ownership["targets"], key=lambda t: ORDER.index(t["role"]))
                for target in ordered:
                    rid = target["container_id"]
                    if rid in removed:
                        continue
                    actions = ["stop", "remove"] if observations[rid] == "running" else ["remove"]
                    for operation in actions:
                        require(len(state["journal"]) < labctl.MAX_OPERATIONS, "journal-limit")
                        req = make_request(manifest, target, operation)
                        op = {"request": req, "status": "uncertain", "admission_id": admission["admission_id"],
                              "approval_reference": admission["approval_reference"]}
                        state["journal"].append(op)
                        # Intent is durable before any possible effect; all interruptions fence.
                        labctl.atomic_write(dirfd, "state.json", state)
                        host = next(h for h in manifest["source_plan"]["inventory"]["hosts"] if h["role"] == target["host"])
                        try:
                            reply = validate_response(req, transport.send(req, host["ssh_alias"]), transport.origin)
                            expected = "stopped" if operation == "stop" else "absent"
                            require(reply["observation"] == expected, "effect-uncertain")
                        except (labctl.LabError, OSError):
                            raise labctl.LabError("effect-uncertain") from None
                        op["status"] = "completed"
                        labctl.atomic_write(dirfd, "state.json", state)
                        observations[rid] = expected
            return {**LIVE, "result": action, "origin": transport.origin,
                    "targets": len(ownership["targets"]), "operations": len(state["journal"]),
                    "uncertain_operations": sum(o["status"] == "uncertain" for o in state["journal"]),
                    "observations": {s: sum(v == s for v in observations.values())
                                     for s in ["running", "stopped", "absent", "foreign", "unknown"]}}
    except OSError:
        raise labctl.LabError("unsafe-state") from None


def purge_preview(manifest, expected_bundle_digest, ownership):
    manifest = validated_manifest(manifest, expected_bundle_digest)
    ownership = validate_ownership(manifest, ownership)
    hosts = {h["role"]: h for h in manifest["source_plan"]["inventory"]["hosts"]}
    candidates = [{**target, "machine_identity_sha256": hosts[target["host"]]["machine_identity_sha256"],
                   "data_path": hosts[target["host"]]["data_root"] + "/data/" + target["role"]}
                  for target in ownership["targets"] if target["role"] != "A"]
    preview = {"schema_version": 1, "lane": "purge-preview", "ownership": ownership,
               "candidates": candidates, "eligible": [], "apply_supported": False,
               "retained": ["config", "credentials", "ownership", "journal", "evidence", "state", "run-root"],
               "unmet_requirements": ["fresh-live-machine-identity", "realpath-device-inode-uid-gid",
                   "no-links-or-unexpected-mounts", "conclusive-owned-stopped-or-absent-containers",
                   "complete-cross-resource-references", "no-process-use", "independent-exact-preview-approval"],
               "live_runtime": "UNEXECUTED"}
    preview["preview_sha256"] = labctl.digest(preview)
    return preview


def validate_purge_approval(preview, expected_preview_digest, approval):
    require(type(expected_preview_digest) is str and labctl.HEX.fullmatch(expected_preview_digest), "invalid-preview")
    require(type(preview) is dict and preview.get("preview_sha256") == expected_preview_digest and
            labctl.digest({k: v for k, v in preview.items() if k != "preview_sha256"}) == expected_preview_digest,
            "invalid-preview")
    shape(approval, {"schema_version", "purpose", "approval_reference", "preview_sha256"})
    require(type(approval["schema_version"]) is int and approval["schema_version"] == 1)
    require(approval["purpose"] == "purge-preview" and approval["preview_sha256"] == expected_preview_digest,
            "independent-purge-approval-required")
    labctl.reference(approval["approval_reference"])
    require(approval["approval_reference"] != "UNRESOLVED", "invalid-approval")
    return {"approval_recorded": True, "authenticated_authority": False, "eligible": [], "apply_supported": False}


class Parser(labctl.Parser):
    def print_help(self, file=None):
        print(labctl.canonical({**LIVE, "result": "help", "actions": ["observe", "down", "reconcile", "purge-preview"],
              "requires": "private manifest/ownership/state and explicit execute-approved; down needs separate admission"}).decode(), file=file)


def main(argv=None):
    try:
        parser = Parser(description=__doc__)
        parser.add_argument("action", choices=["observe", "down", "reconcile", "purge-preview"])
        parser.add_argument("--manifest", required=True)
        parser.add_argument("--expected-bundle-digest", required=True)
        parser.add_argument("--ownership", required=True)
        parser.add_argument("--state-root")
        parser.add_argument("--transport-config")
        parser.add_argument("--admission")
        parser.add_argument("--execute-approved", action="store_true")
        args = parser.parse_args(argv)
        manifest, ownership = load_private(args.manifest), load_private(args.ownership)
        if args.action == "purge-preview":
            preview = purge_preview(manifest, args.expected_bundle_digest, ownership)
            result = {**LIVE, "result": "purge-preview", "candidate_count": len(preview["candidates"]),
                      "eligible_count": 0, "apply_supported": False,
                      "preview_sha256": preview["preview_sha256"], "unmet_requirements": preview["unmet_requirements"]}
        else:
            require(args.execute_approved and args.transport_config and args.state_root, "execute-approved-required")
            admission = load_private(args.admission) if args.admission else None
            result = control(manifest, args.expected_bundle_digest, ownership, args.state_root, args.action,
                             Transport(load_private(args.transport_config)), admission=admission,
                             execute_approved=args.execute_approved)
        print(labctl.canonical(result).decode())
        return 0
    except (labctl.LabError, helper.ProtocolError, OSError, ValueError, TypeError, KeyError, StopIteration, KeyboardInterrupt):
        print(labctl.canonical({**LIVE, "result": "error", "error": "request-refused"}).decode())
        return 2


if __name__ == "__main__":
    sys.exit(main())
