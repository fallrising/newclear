#!/usr/bin/env python3
"""Bounded offline planner and owned synthetic lifecycle. No remote executor."""
import argparse
import binascii
from contextlib import contextmanager
import fcntl
import hashlib
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import uuid

RESEARCH_COMMIT = "9959fe2e5cd466614dc20ef7b710befaaf1d746a"
MAX_BYTES = 1024 * 1024
MAX_OPERATIONS = 1024
LANE = {"lane": "local-fixture", "remote_execution_supported": False}
HEX = re.compile(r"[0-9a-f]{64}\Z")
TOKEN = re.compile(r"[a-z][a-z0-9-]{0,47}\Z")
REFERENCE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}\Z")
HOST_KEYS = {"role", "ssh_alias", "machine_identity_sha256", "tailnet_ipv4", "data_root",
             "available_memory_mib", "available_disk_mib", "approved_ports", "occupied_ports"}
LOCK_KEYS = {"schema_version", "research_commit", "platform", "redis_image",
             "mithril_binary_sha256", "mithril_provenance", "builder_image", "rust_toolchain",
             "native_verification"}


class LabError(Exception):
    """Only fixed public-safe codes cross the CLI boundary."""


def require(condition, code="invalid-input"):
    if not condition:
        raise LabError(code)


def shape(value, keys):
    require(type(value) is dict and set(value) == set(keys))


def canonical(value):
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
                          allow_nan=False).encode("utf-8")
    except (ValueError, TypeError, RecursionError):
        raise LabError("invalid-input") from None


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def decode(raw):
    require(len(raw) <= MAX_BYTES, "input-too-large")
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "duplicate-key")
            result[key] = value
        return result
    def bad_constant(_):
        raise LabError("invalid-json")
    def finite_float(raw_value):
        value = float(raw_value)
        require(math.isfinite(value), "invalid-json")
        return value
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs,
                          parse_constant=bad_constant, parse_float=finite_float)
    except (ValueError, UnicodeError, RecursionError):
        raise LabError("invalid-json") from None


@contextmanager
def directory(path):
    """Walk every component with dirfds; never follow symlinks."""
    path = Path(os.path.abspath(path))
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            nextfd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = nextfd
        yield fd
    finally:
        os.close(fd)


def file_stat(fd, private=False):
    info = os.fstat(fd)
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "unsafe-file")
    require(info.st_size <= MAX_BYTES, "input-too-large")
    if private:
        require(info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o600, "unsafe-file")
    return info


def read_at(dirfd, name, private=False):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=dirfd)
    try:
        file_stat(fd, private)
        with os.fdopen(fd, "rb", closefd=False) as stream:
            return decode(stream.read(MAX_BYTES + 1))
    finally:
        os.close(fd)


def load_json(path):
    try:
        path = Path(path)
        with directory(path.parent) as dirfd:
            return read_at(dirfd, path.name)
    except OSError:
        raise LabError("unsafe-or-unreadable-input") from None


def integer(value, minimum, maximum):
    require(type(value) is int and minimum <= value <= maximum)


def reference(value):
    require(type(value) is str and REFERENCE.fullmatch(value) is not None)


def unresolved(value, reason, reasons):
    if value == "UNRESOLVED":
        reasons.append(reason)
        return True
    return False


def ports(value):
    require(type(value) is list and len(value) <= 256)
    for port in value:
        integer(port, 1, 65535)
    require(len(set(value)) == len(value))
    return sorted(value)


def validate_inputs(inventory, lock):
    shape(inventory, {"schema_version", "run_id", "access_policy_revision", "hosts"})
    shape(lock, LOCK_KEYS)
    integer(inventory["schema_version"], 1, 1)
    integer(lock["schema_version"], 1, 1)
    run = inventory["run_id"]
    require(type(run) is str and TOKEN.fullmatch(run) is not None)
    require(type(inventory["hosts"]) is list and len(inventory["hosts"]) == 4)
    reasons, hosts = [], []
    if not unresolved(inventory["access_policy_revision"], "access-policy-unresolved", reasons):
        reference(inventory["access_policy_revision"])
    seen = {field: set() for field in ["role", "ssh_alias", "machine_identity_sha256", "tailnet_ipv4"]}
    for host in inventory["hosts"]:
        shape(host, HOST_KEYS)
        host = dict(host)
        role = host["role"]
        require(type(role) is str and role in {"H1", "H2", "H3", "H4"})
        require(role not in seen["role"])
        seen["role"].add(role)
        for field in ["ssh_alias", "machine_identity_sha256", "tailnet_ipv4"]:
            value = host[field]
            if unresolved(value, role + ":" + field + "-unresolved", reasons):
                continue
            require(type(value) is str)
            if field == "ssh_alias":
                require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]{0,62}", value) is not None)
            elif field == "machine_identity_sha256":
                require(HEX.fullmatch(value) is not None)
            else:
                try:
                    address = ipaddress.IPv4Address(value)
                    require(address in ipaddress.IPv4Network("100.64.0.0/10") and str(address) == value)
                except ValueError:
                    raise LabError("invalid-input") from None
            require(value not in seen[field])
            seen[field].add(value)
        root = host["data_root"]
        if not unresolved(root, role + ":data-root-unresolved", reasons):
            require(type(root) is str and len(root) <= 256)
            require(re.fullmatch(r"/home/[a-z][a-z0-9_-]{0,31}(?:/[A-Za-z0-9_-]+)+", root) is not None)
            require(root.split("/")[2] != "root" and root.split("/")[-1] == run)
        for field, floor in [("available_memory_mib", 2048 if role == "H4" else 4096),
                             ("available_disk_mib", 10240)]:
            if not unresolved(host[field], role + ":" + field + "-unresolved", reasons):
                integer(host[field], 0, 2 ** 40)
                if host[field] < floor:
                    reasons.append(role + ":" + field + "-below-floor")
        wanted = [17979] if role == "H4" else [17001, 17002, 27001, 27002]
        if not unresolved(host["approved_ports"], role + ":approved-ports-unresolved", reasons):
            host["approved_ports"] = ports(host["approved_ports"])
            require(host["approved_ports"] == wanted)
        if not unresolved(host["occupied_ports"], role + ":occupied-ports-unresolved", reasons):
            host["occupied_ports"] = ports(host["occupied_ports"])
            if set(wanted).intersection(host["occupied_ports"]):
                reasons.append(role + ":port-collision")
        hosts.append(host)
    for field, expected in [("research_commit", RESEARCH_COMMIT), ("platform", "linux/amd64"),
                            ("rust_toolchain", "1.98.0")]:
        if not unresolved(lock[field], field + "-unresolved", reasons):
            require(lock[field] == expected)
    for field in ["redis_image", "builder_image", "mithril_binary_sha256", "mithril_provenance", "native_verification"]:
        value = lock[field]
        if unresolved(value, field + "-unresolved", reasons):
            continue
        require(type(value) is str)
        if field == "redis_image":
            require(re.fullmatch(r"redis:7\.4\.[0-9]+@sha256:[0-9a-f]{64}", value) is not None)
        elif field == "builder_image":
            require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,190}@sha256:[0-9a-f]{64}", value) is not None)
        elif field == "mithril_binary_sha256":
            require(HEX.fullmatch(value) is not None)
        else:
            reference(value)
    inventory = dict(inventory, hosts=sorted(hosts, key=lambda h: h["role"]))
    return inventory, dict(lock), sorted(reasons)


def build_plan(inventory, lock):
    inventory, lock, reasons = validate_inputs(inventory, lock)
    topology = []
    ranges = [[0, 5460], [5461, 10922], [10923, 16383]]
    for i in range(1, 4):
        topology.append({"role": f"M{i}", "host": f"H{i}", "port": 17001, "bus_port": 27001,
                         "slots": ranges[i - 1], "replicates": None})
    for i, host in [(1, "H2"), (2, "H3"), (3, "H1")]:
        topology.append({"role": f"R{i}", "host": host, "port": 17002, "bus_port": 27002,
                         "slots": [], "replicates": f"M{i}"})
    topology.append({"role": "A", "host": "H4", "port": 17979, "bus_port": None,
                     "slots": [], "replicates": None})
    plan = {"schema_version": 1, **LANE, "inventory": inventory, "runtime_lock": lock,
            "run_id": inventory["run_id"], "executable": not reasons, "reasons": reasons,
            "topology": topology, "ownership_label": "mithril-fixture:" + inventory["run_id"],
            "caps": {"redis_memory_mib": 1024, "redis_maxmemory_mib": 256,
                     "proxy_memory_mib": 1024, "proxy_workers": 2, "maxclients": 256,
                     "query_buffer_mib": 4, "backend_conns": 1, "cache": False,
                     "replica_reads": False, "backend_sharding": "no"}}
    plan["plan_sha256"] = digest(plan)
    return plan


def validate_plan(plan, expected_digest):
    require(type(plan) is dict, "invalid-plan")
    require(type(expected_digest) is str and HEX.fullmatch(expected_digest) is not None, "invalid-digest")
    require(plan.get("plan_sha256") == expected_digest, "plan-digest-mismatch")
    require("inventory" in plan and "runtime_lock" in plan, "invalid-plan")
    derived = build_plan(plan["inventory"], plan["runtime_lock"])
    require(canonical(plan) == canonical(derived), "plan-semantic-mismatch")
    return derived


def atomic_write(dirfd, name, value):
    payload = canonical(value) + b"\n"
    require(len(payload) <= MAX_BYTES, "state-limit")
    original = None
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=dirfd)
        try:
            original = file_stat(fd, True)
        finally:
            os.close(fd)
    except FileNotFoundError:
        pass
    temporary = ".write-" + uuid.uuid4().hex
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=dirfd)
    try:
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(fd)
        if original is not None:
            current = os.stat(name, dir_fd=dirfd, follow_symlinks=False)
            require((current.st_dev, current.st_ino, current.st_nlink, current.st_mode) ==
                    (original.st_dev, original.st_ino, original.st_nlink, original.st_mode), "unsafe-file")
        else:
            require(name not in os.listdir(dirfd), "unsafe-file")
        os.rename(temporary, name, src_dir_fd=dirfd, dst_dir_fd=dirfd)
        os.fsync(dirfd)
    finally:
        os.close(fd)
        if temporary in os.listdir(dirfd):
            os.unlink(temporary, dir_fd=dirfd)


def outside_source(path):
    source = Path(__file__).resolve().parents[3]
    require(path != source and source not in path.parents, "state-inside-source")


@contextmanager
def owned_scope(path, allow_new):
    path = Path(path)
    require(path.is_absolute() and str(path) == os.path.normpath(str(path)), "unsafe-state-root")
    outside_source(path)
    with directory(path.parent) as parentfd:
        if allow_new:
            try:
                os.mkdir(path.name, 0o700, dir_fd=parentfd)
            except FileExistsError:
                pass
        dirfd = os.open(path.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parentfd)
        try:
            info = os.fstat(dirfd)
            require(info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o700, "unsafe-state-root")
            allowed = {".lock", "state.json", "backend.json"}
            names = set(os.listdir(dirfd))
            require(names <= allowed, "unknown-state")
            require(names or allow_new, "fixture-not-initialized")
            # A leftover lock without a complete binding cannot establish ownership.
            require(not names or {".lock", "state.json"} <= names, "unknown-state")
            flags = os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK
            if not names:
                flags |= os.O_CREAT | os.O_EXCL
            lockfd = os.open(".lock", flags, 0o600, dir_fd=dirfd)
            try:
                file_stat(lockfd, True)
                try:
                    fcntl.flock(lockfd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise LabError("state-locked") from None
                require(set(os.listdir(dirfd)) <= allowed, "unknown-state")
                current = os.stat(path.name, dir_fd=parentfd, follow_symlinks=False)
                require((info.st_dev, info.st_ino) == (current.st_dev, current.st_ino), "unsafe-state-root")
                yield dirfd, {"device": info.st_dev, "inode": info.st_ino}, not names
            finally:
                os.close(lockfd)
        finally:
            os.close(dirfd)


def initial_state(plan, binding):
    return {"schema_version": 1, **LANE, "run_id": plan["run_id"], "plan_sha256": plan["plan_sha256"],
            "root_binding": binding, "ownership_label": plan["ownership_label"],
            "node_ids": {n["role"]: uuid.uuid4().hex for n in plan["topology"]},
            "manifest": {}, "journal": [], "data": {"marker": uuid.uuid4().hex, "values": {}},
            "last_smoke": None}


def valid_uuid(value):
    require(type(value) is str and re.fullmatch(r"[0-9a-f]{32}", value) is not None, "invalid-state")


def resource(plan, state, role, instance_id):
    return {"id": instance_id, "label": plan["ownership_label"], "plan_sha256": plan["plan_sha256"],
            "node_id": state["node_ids"][role],
            "spec": next(n for n in plan["topology"] if n["role"] == role), "role": role}


def validate_state(state, plan, binding):
    shape(state, {"schema_version", "lane", "remote_execution_supported", "run_id", "plan_sha256",
                  "root_binding", "ownership_label", "node_ids", "manifest", "journal", "data", "last_smoke"})
    for key, value in {**LANE, "schema_version": 1, "run_id": plan["run_id"],
                       "plan_sha256": plan["plan_sha256"], "root_binding": binding,
                       "ownership_label": plan["ownership_label"]}.items():
        require(type(state[key]) is type(value) and state[key] == value, "state-binding-mismatch")
    shape(state["node_ids"], [n["role"] for n in plan["topology"]])
    for node in state["node_ids"].values():
        valid_uuid(node)
    require(len(set(state["node_ids"].values())) == 7, "invalid-state")
    shape(state["data"], {"marker", "values"})
    valid_uuid(state["data"]["marker"])
    require(type(state["data"]["values"]) is dict and len(state["data"]["values"]) <= 64, "invalid-state")
    for key, value in state["data"]["values"].items():
        require(type(key) is str and key.startswith(plan["run_id"] + ":") and len(key) <= 256, "invalid-state")
        shape(value, {"value", "expires"})
        require(type(value["value"]) is str and len(value["value"]) <= 1024, "invalid-state")
        integer(value["expires"], 0, 2 ** 63)
    require(type(state["manifest"]) is dict and len(state["manifest"]) <= 7, "invalid-state")
    roles = set()
    for rid, obj in state["manifest"].items():
        valid_uuid(rid)
        require(type(obj) is dict and type(obj.get("role")) is str and
                obj["role"] in state["node_ids"], "invalid-state")
        require(canonical(obj) == canonical(resource(plan, state, obj["role"], rid)), "invalid-state")
        require(obj["role"] not in roles, "invalid-state")
        roles.add(obj["role"])
    require(type(state["journal"]) is list and len(state["journal"]) <= MAX_OPERATIONS, "invalid-state")
    operations = set()
    latest_creates = {}
    known_resources = set()
    for op in state["journal"]:
        shape(op, {"operation_id", "action", "resource", "status"})
        valid_uuid(op["operation_id"])
        require(op["operation_id"] not in operations, "invalid-state")
        operations.add(op["operation_id"])
        require(type(op["action"]) is str and type(op["status"]) is str and
                op["action"] in {"create", "remove"} and
                op["status"] in {"intended", "completed", "abandoned"}, "invalid-state")
        obj = op["resource"]
        require(type(obj) is dict and type(obj.get("role")) is str and
                obj["role"] in state["node_ids"], "invalid-state")
        valid_uuid(obj.get("id"))
        require(canonical(obj) == canonical(resource(plan, state, obj["role"], obj["id"])), "invalid-state")
        if op["action"] == "create":
            require(obj["id"] not in known_resources, "invalid-state")
            known_resources.add(obj["id"])
            latest_creates[obj["role"]] = obj
        else:
            require(obj["id"] in known_resources, "invalid-state")
    require(sum(op["status"] == "intended" for op in state["journal"]) <= 1, "invalid-state")
    require(state["manifest"] == {obj["id"]: obj for obj in latest_creates.values()}, "invalid-state")
    if state["last_smoke"] is not None:
        expected_smoke = {**LANE, "result": "simulated-pass", "checks": {"nodes": 6, "masters": 3,
                          "slots": 16384, "cross_shard_keys": 3, "authorization_denials": 3},
                          "retained_marker": state["data"]["marker"]}
        require(canonical(state["last_smoke"]) == canonical(expected_smoke), "invalid-state")


def observation(backend, state):
    if backend is None:
        return "unknown"
    shape(backend, {"objects"})
    require(type(backend["objects"]) is dict and len(backend["objects"]) <= 64, "invalid-backend")
    for rid, obj in backend["objects"].items():
        if rid not in state["manifest"] or canonical(obj) != canonical(state["manifest"][rid]):
            return "foreign"
    latest = {op["resource"]["id"]: op for op in state["journal"]}
    for rid in state["manifest"]:
        op = latest[rid]
        if op["status"] == "completed":
            expected_present = op["action"] == "create"
            if (rid in backend["objects"]) != expected_present:
                return "unknown"
        elif op["status"] == "abandoned":
            expected_present = op["action"] == "remove"
            if (rid in backend["objects"]) != expected_present:
                return "unknown"
    return "owned"


def effect(dirfd, state, backend, action, obj, fault):
    require(len(state["journal"]) < MAX_OPERATIONS, "operation-limit")
    op = {"operation_id": uuid.uuid4().hex, "action": action, "resource": obj, "status": "intended"}
    state["journal"].append(op)
    atomic_write(dirfd, "state.json", state)
    if fault == "before-effect":
        raise LabError("injected-before-effect")
    if action == "create":
        require(obj["id"] not in backend["objects"], "foreign-state")
        backend["objects"][obj["id"]] = obj
    else:
        require(backend["objects"].get(obj["id"]) == obj, "foreign-state")
        del backend["objects"][obj["id"]]
    atomic_write(dirfd, "backend.json", backend)
    if fault == "lost-reply":
        raise LabError("injected-lost-reply")
    op["status"] = "completed"
    atomic_write(dirfd, "state.json", state)
    if fault == "after-ack":
        raise LabError("injected-after-ack")


class SyntheticStore:
    """Small test backend with scoped access, slot routing and controlled TTL clock."""
    def __init__(self, run_id, values, clock):
        self.prefix = run_id + ":"
        self.values = values
        self.clock = clock

    def execute(self, command, key, value=None, ttl=None, authorized=True):
        require(authorized and type(key) is str and key.startswith(self.prefix) and
                command in {"SET", "GET", "TTL", "DEL"}, "authorization-denied")
        if key in self.values and self.values[key]["expires"] <= self.clock():
            del self.values[key]
        if command == "SET":
            require(type(value) is str and len(value) <= 1024 and type(ttl) is int and 1 <= ttl <= 60)
            self.values[key] = {"value": value, "expires": self.clock() + ttl}
            return "OK"
        if command == "GET":
            return self.values.get(key, {}).get("value")
        if command == "TTL":
            return max(0, int(self.values[key]["expires"] - self.clock())) if key in self.values else -2
        return int(self.values.pop(key, None) is not None)

    @staticmethod
    def slot(key):
        return binascii.crc_hqx(key.encode("utf-8"), 0) % 16384


def smoke(state, plan, backend):
    require(len(backend["objects"]) == 7 and len(state["manifest"]) == 7, "fixture-not-running")
    require(set(obj["role"] for obj in backend["objects"].values()) == {n["role"] for n in plan["topology"]},
            "fixture-topology-mismatch")
    clock = [1000]
    store = SyntheticStore(plan["run_id"], state["data"]["values"], lambda: clock[0])
    selected = {}
    for i in range(10000):
        key = plan["run_id"] + ":synthetic-" + str(i)
        slot = store.slot(key)
        for master in [n for n in plan["topology"] if n["role"].startswith("M")]:
            if master["slots"][0] <= slot <= master["slots"][1]:
                selected.setdefault(master["role"], key)
        if len(selected) == 3:
            break
    require(len(selected) == 3, "synthetic-shard-selection-failed")
    for role, key in selected.items():
        require(store.execute("SET", key, role, 10) == "OK", "synthetic-smoke-failed")
        require(store.execute("GET", key) == role and store.execute("TTL", key) == 10, "synthetic-smoke-failed")
        require(store.execute("DEL", key) == 1 and store.execute("GET", key) is None, "synthetic-smoke-failed")
        store.execute("SET", key, role, 1)
        clock[0] += 2
        require(store.execute("GET", key) is None and store.execute("TTL", key) == -2, "synthetic-smoke-failed")
    denied = 0
    for command, key, authorized in [("GET", "foreign:key", True), ("CONFIG", plan["run_id"] + ":key", True),
                                      ("GET", plan["run_id"] + ":key", False)]:
        try:
            store.execute(command, key, authorized=authorized)
        except LabError:
            denied += 1
    require(denied == 3, "synthetic-authorization-failed")
    return {**LANE, "result": "simulated-pass", "checks": {"nodes": 6, "masters": 3, "slots": 16384,
            "cross_shard_keys": 3, "authorization_denials": denied}, "retained_marker": state["data"]["marker"]}


def fixture(plan, state_root, expected_digest, action, fault=None):
    plan = validate_plan(plan, expected_digest)
    require(plan["executable"], "draft-plan-refused")
    require(type(action) is str and action in {"up", "status", "smoke", "down", "reconcile", "report"}, "unsupported-action")
    state_root = Path(state_root)
    for host in plan["inventory"]["hosts"]:
        remote_root = Path(host["data_root"])
        require(state_root != remote_root and remote_root not in state_root.parents and
                state_root not in remote_root.parents, "remote-intent-state-root")
    require(fault in {None, "before-effect", "lost-reply", "after-ack"} and
            (fault is None or action in {"up", "down"}), "invalid-fault")
    try:
        with owned_scope(state_root, action == "up") as (dirfd, binding, new):
            if new:
                require(action == "up", "fixture-not-initialized")
                state = initial_state(plan, binding)
                atomic_write(dirfd, "state.json", state)
                atomic_write(dirfd, "backend.json", {"objects": {}})
            state = read_at(dirfd, "state.json", True)
            validate_state(state, plan, binding)
            try:
                backend = read_at(dirfd, "backend.json", True)
            except FileNotFoundError:
                backend = None
            observed = observation(backend, state)
            pending = [op for op in state["journal"] if op["status"] == "intended"]
            if action == "reconcile":
                if observed == "owned":
                    for op in pending:
                        present = op["resource"]["id"] in backend["objects"]
                        op["status"] = "completed" if present == (op["action"] == "create") else "abandoned"
                    if pending:
                        atomic_write(dirfd, "state.json", state)
            elif action in {"up", "down", "smoke"}:
                require(observed == "owned", observed + "-state")
                require(not pending, "reconcile-required")
                if action == "up":
                    for spec in plan["topology"]:
                        role = spec["role"]
                        existing = next((obj for obj in state["manifest"].values() if obj["role"] == role), None)
                        if existing is not None and existing["id"] in backend["objects"]:
                            continue
                        if existing is not None:
                            del state["manifest"][existing["id"]]
                        rid = uuid.uuid4().hex
                        obj = resource(plan, state, role, rid)
                        state["manifest"][rid] = obj
                        effect(dirfd, state, backend, "create", obj, fault)
                        fault = None
                elif action == "down":
                    for role in ["A", "R3", "R2", "R1", "M3", "M2", "M1"]:
                        obj = next((obj for obj in state["manifest"].values() if obj["role"] == role), None)
                        if obj is not None and obj["id"] in backend["objects"]:
                            effect(dirfd, state, backend, "remove", obj, fault)
                            fault = None
                else:
                    result = smoke(state, plan, backend)
                    state["last_smoke"] = result
                    atomic_write(dirfd, "state.json", state)
                    return result
            if action == "report":
                return {**LANE, "result": "simulated-report", "observation": observed,
                        "synthetic_resources": len(backend["objects"]) if backend else None,
                        "operations": len(state["journal"]), "uncertain_operations": len(pending),
                        "smoke": "simulated-pass" if state["last_smoke"] else "NO RESULT",
                        "remote_runtime": "UNEXECUTED"}
            return {**LANE, "result": "simulated-" + action, "observation": observed,
                    "run_id": state["run_id"], "plan_sha256": state["plan_sha256"],
                    "resources": list(backend["objects"].values()) if backend else [],
                    "journal": state["journal"], "retained_marker": state["data"]["marker"]}
    except OSError:
        raise LabError("unsafe-or-unreadable-state") from None


class Parser(argparse.ArgumentParser):
    def error(self, _message):
        raise LabError("invalid-arguments")

    def print_help(self, file=None):
        print(json.dumps({**LANE, "result": "help", "usage":
              "plan --inventory FILE --runtime-lock FILE; fixture ACTION --plan FILE --expected-digest SHA256 --state-root DIR",
              "actions": ["up", "status", "smoke", "down", "reconcile", "report"]}), file=file)


def main(argv=None):
    try:
        parser = Parser(description=__doc__)
        commands = parser.add_subparsers(dest="command", required=True, parser_class=Parser)
        planner = commands.add_parser("plan")
        planner.add_argument("--inventory", required=True)
        planner.add_argument("--runtime-lock", required=True)
        local = commands.add_parser("fixture")
        local.add_argument("action", choices=["up", "status", "smoke", "down", "reconcile", "report"])
        local.add_argument("--plan", required=True)
        local.add_argument("--expected-digest", required=True)
        local.add_argument("--state-root", required=True)
        local.add_argument("--fault", choices=["before-effect", "lost-reply", "after-ack"])
        args = parser.parse_args(argv)
        if args.command == "plan":
            result = build_plan(load_json(args.inventory), load_json(args.runtime_lock))
        else:
            result = fixture(load_json(args.plan), Path(args.state_root), args.expected_digest, args.action, args.fault)
        print(canonical(result).decode("ascii"))
        return 0
    except LabError as error:
        print(json.dumps({**LANE, "result": "error", "error": str(error)}))
        return 2


if __name__ == "__main__":
    sys.exit(main())
