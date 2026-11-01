#!/usr/bin/env python3
"""Private offline Redis bootstrap proposals. No collection or execution interface."""
import copy
import ipaddress
import json
import os
from pathlib import Path
import re
import sys

import bundle
import labctl
import ssh_executor

ROLES = ("M1", "M2", "M3", "R1", "R2", "R3")
NODE_ID = re.compile(r"[0-9a-f]{40}\Z")
OFFLINE = {"lane": "offline-bootstrap", "execution_supported": False,
           "live_ready": False, "live_runtime": "UNEXECUTED"}
OBSERVATION_KEYS = {"schema_version", "lane", "origin", "snapshot_id", "run_id",
                    "plan_sha256", "bundle_sha256", "nodes"}
RECORD_KEYS = {"host", "role", "container_id", "machine_identity_sha256", "labels",
               "container_state", "cluster_nodes", "cluster_info", "info_keyspace"}
INFO_REQUIRED = {"cluster_state", "cluster_slots_assigned", "cluster_slots_ok",
                 "cluster_slots_pfail", "cluster_slots_fail", "cluster_known_nodes",
                 "cluster_size", "cluster_current_epoch", "cluster_my_epoch"}
MESSAGE_TYPES = "ping|pong|meet|fail|publish|auth-req|auth-ack|update|mfstart|module|publishshard"
INFO_OPTIONAL = re.compile(r"cluster_stats_messages_(?:" + MESSAGE_TYPES + r")_(?:sent|received)\Z")
COMMON_BEFORE = ["fresh-authenticated-direct-observations", "exact-session-approval-and-phase-admission",
                 "durable-intent-and-uncertainty-fence", "bound-runtime-config-network-and-storage",
                 "quiescent-clients-and-per-effect-identity-recheck"]
BARRIERS = ["pristine-isolated-empty-zero-epochs", "isolated-empty-assigned-epochs",
            "six-connected-empty-masters-epoch-six", "exact-slots-with-empty-prospective-replicas",
            "exact-converged-topology-snapshot"]
UNMET = ["authenticated-live-collection-and-freshness", "exact-session-approval-and-admission",
         "phase-aware-live-validation", "durable-journal-and-uncertainty-fencing",
         "runtime-artifact-config-filesystem-network-verification", "replication-link-health-and-lag",
         "persistence-and-proxy-smoke"]
PLAN_KEYS = {"schema_version", *OFFLINE, "source_manifest", "ownership", "expected_node_ids",
             "observations", "classification", "phases", "unmet_requirements", "bootstrap_sha256"}
require = labctl.require


def _bounded(value):
    require(len(labctl.canonical(value)) <= labctl.MAX_BYTES, "bootstrap-size-limit")


def _lines(raw, limit):
    require(type(raw) is str and 0 < len(raw) <= limit, "invalid-response")
    require(all(c in "\r\n" or 32 <= ord(c) <= 126 for c in raw), "invalid-response")
    require(raw.endswith("\n") and "\r" not in raw.replace("\r\n", ""), "incomplete-response")
    return raw.replace("\r\n", "\n").split("\n")[:-1]


def _uint(raw, maximum=2 ** 64 - 1):
    require(type(raw) is str and re.fullmatch(r"[0-9]{1,20}", raw) is not None, "invalid-response-integer")
    number = int(raw)
    require(number <= maximum, "invalid-response-integer")
    return number


def parse_cluster_nodes(raw):
    """Parse the bounded IPv4/no-announce-hostname profile; refuse migration."""
    lines = _lines(raw, 64 * 1024)
    require(1 <= len(lines) <= 6 and all(lines), "invalid-cluster-nodes")
    result, ids, endpoints = [], set(), set()
    for line in lines:
        fields = line.split(" ")
        require(8 <= len(fields) <= 8 + 16384 and all(fields), "invalid-cluster-nodes")
        nid, address, flags_raw, parent, ping, pong, epoch, link = fields[:8]
        require(NODE_ID.fullmatch(nid) is not None and nid not in ids, "invalid-node-id")
        ids.add(nid)
        address_match = re.fullmatch(r"([0-9.]+):([0-9]+)@([0-9]+),?", address)
        require(address_match is not None, "invalid-node-endpoint")
        try:
            ipv4 = str(ipaddress.IPv4Address(address_match[1]))
        except ValueError:
            raise labctl.LabError("invalid-node-endpoint") from None
        require(ipv4 == address_match[1], "invalid-node-endpoint")
        port, bus = _uint(address_match[2], 65535), _uint(address_match[3], 65535)
        require(port > 0 and bus > 0 and (ipv4, port, bus) not in endpoints, "invalid-node-endpoint")
        endpoints.add((ipv4, port, bus))
        flags = flags_raw.split(",")
        require(len(flags) == len(set(flags)) and set(flags) <= {"master", "slave", "myself"}
                and (("master" in flags) != ("slave" in flags)), "unsafe-node-flags")
        require(parent == "-" or NODE_ID.fullmatch(parent) is not None, "invalid-node-parent")
        require(link == "connected", "unsafe-node-link")
        slots = set()
        for token in fields[8:]:
            match = re.fullmatch(r"([0-9]+)(?:-([0-9]+))?", token)
            require(match is not None, "unsafe-slot-token")
            start, end = _uint(match[1], 16383), _uint(match[2] or match[1], 16383)
            require(start <= end, "invalid-slot-range")
            assigned = set(range(start, end + 1))
            require(not slots.intersection(assigned), "duplicate-slot")
            slots.update(assigned)
        result.append({"node_id": nid, "ipv4": ipv4, "port": port, "bus_port": bus,
                       "flags": sorted(flags), "master_node_id": parent,
                       "ping": _uint(ping), "pong": _uint(pong), "epoch": _uint(epoch),
                       "slots": sorted(slots)})
    return sorted(result, key=lambda node: node["node_id"])


def parse_cluster_info(raw):
    lines = _lines(raw, 16 * 1024)
    require(1 <= len(lines) <= 64 and all(lines), "invalid-cluster-info")
    result = {}
    for line in lines:
        parts = line.split(":")
        require(len(parts) == 2, "invalid-cluster-info")
        key, value = parts
        require(key not in result and (key in INFO_REQUIRED or INFO_OPTIONAL.fullmatch(key)
                or key in {"cluster_stats_messages_sent", "cluster_stats_messages_received",
                           "total_cluster_links_buffer_limit_exceeded"}), "invalid-cluster-info")
        if key == "cluster_state":
            require(value in {"ok", "fail"}, "invalid-cluster-info")
            result[key] = value
        else:
            result[key] = _uint(value)
    require(INFO_REQUIRED <= result.keys(), "incomplete-cluster-info")
    return result


def parse_info_keyspace(raw):
    lines = [line for line in _lines(raw, 4 * 1024) if line]
    require(1 <= len(lines) <= 2 and lines[0] == "# Keyspace", "incomplete-keyspace")
    result = {"keys": 0, "expires": 0, "avg_ttl": 0, "subexpiry": 0}
    if len(lines) == 1:
        return result
    require(lines[1].startswith("db0:"), "invalid-keyspace")
    fields = {}
    for token in lines[1][4:].split(","):
        parts = token.split("=")
        require(len(parts) == 2 and parts[0] in result and parts[0] not in fields, "invalid-keyspace")
        fields[parts[0]] = _uint(parts[1])
    require({"keys", "expires", "avg_ttl"} <= fields.keys(), "incomplete-keyspace")
    result.update(fields)
    require(result["expires"] <= result["keys"], "invalid-keyspace")
    return result


def _expected(manifest, ownership, expected_node_ids):
    ownership = ssh_executor.validate_ownership(manifest, ownership)
    require(len(ownership["targets"]) == 6 and {t["role"] for t in ownership["targets"]} == set(ROLES),
            "six-redis-targets-required")
    require(manifest["runtime_spec"]["mithril_image"] != "UNRESOLVED", "draft-bundle-refused")
    labctl.shape(expected_node_ids, ROLES)
    for nid in expected_node_ids.values():
        require(type(nid) is str and NODE_ID.fullmatch(nid) is not None, "invalid-expected-node-ids")
    require(len(set(expected_node_ids.values())) == 6, "duplicate-expected-node-id")
    hosts = {host["role"]: host for host in manifest["source_plan"]["inventory"]["hosts"]}
    targets = {target["role"]: target for target in ownership["targets"]}
    nodes = {}
    for node in manifest["source_plan"]["topology"]:
        role = node["role"]
        if role in ROLES:
            nodes[role] = {**node, "ipv4": hosts[node["host"]]["tailnet_ipv4"],
                           "node_id": expected_node_ids[role], "container_id": targets[role]["container_id"]}
    return ownership, hosts, nodes


def _info_matches(info, state, known, size, assigned, current=None, my=None):
    expected = {"cluster_state": state, "cluster_known_nodes": known, "cluster_size": size,
                "cluster_slots_assigned": assigned, "cluster_slots_ok": assigned,
                "cluster_slots_pfail": 0, "cluster_slots_fail": 0}
    if current is not None:
        expected["cluster_current_epoch"] = current
    if my is not None:
        expected["cluster_my_epoch"] = my
    return all(info[k] == v for k, v in expected.items())


def _classify(views, expected):
    pristine = True
    for role, view in views.items():
        rows, info, keyspace = view["rows"], view["info"], view["keyspace"]
        pristine = pristine and len(rows) == 1 and rows[0]["node_id"] == expected[role]["node_id"]
        pristine = pristine and rows[0]["flags"] == ["master", "myself"] and rows[0]["master_node_id"] == "-"
        pristine = pristine and not rows[0]["slots"] and rows[0]["epoch"] == 0 and not any(keyspace.values())
        pristine = pristine and _info_matches(info, "fail", 1, 0, 0, 0, 0)
    if pristine:
        return "pristine"
    ids = {node["node_id"] for node in expected.values()}
    reference, current = None, None
    for role, view in views.items():
        rows = {row["node_id"]: row for row in view["rows"]}
        require(set(rows) == ids, "unsupported-topology")
        normalized = {nid: {k: v for k, v in row.items() if k not in {"flags", "ping", "pong"}}
                      | {"role": "master" if "master" in row["flags"] else "slave"} for nid, row in rows.items()}
        if reference is None:
            reference = normalized
        require(reference == normalized, "inconsistent-topology")
        epochs, assigned = [], set()
        for peer, node in expected.items():
            row = rows[node["node_id"]]
            replica = peer.startswith("R")
            require(("slave" if replica else "master") in row["flags"], "topology-role-drift")
            parent = expected[node["replicates"]]["node_id"] if replica else "-"
            require(row["master_node_id"] == parent, "topology-parent-drift")
            wanted_slots = [] if replica else list(range(node["slots"][0], node["slots"][1] + 1))
            require(row["slots"] == wanted_slots and not assigned.intersection(row["slots"]), "topology-slot-drift")
            assigned.update(row["slots"])
            if replica:
                require(node["host"] != expected[node["replicates"]]["host"] and
                        row["epoch"] == rows[parent]["epoch"], "topology-replica-drift")
            else:
                require(row["epoch"] > 0, "invalid-master-epoch")
                epochs.append(row["epoch"])
        require(len(set(epochs)) == 3 and len(assigned) == 16384, "unsupported-topology")
        info = view["info"]
        require(_info_matches(info, "ok", 6, 3, 16384, my=rows[expected[role]["node_id"]]["epoch"]),
                "inconsistent-cluster-info")
        if current is None:
            current = info["cluster_current_epoch"]
        require(current == info["cluster_current_epoch"] and current >= max(r["epoch"] for r in rows.values()),
                "inconsistent-cluster-epoch")
    return "already-converged"


def validate_observations(manifest, expected_bundle_digest, ownership, expected_node_ids, observations):
    """Pure validation of original assertions; returns detached internal views."""
    for value in (manifest, ownership, expected_node_ids, observations):
        _bounded(value)
    manifest = bundle.validate_manifest(manifest, expected_bundle_digest)
    ownership, hosts, expected = _expected(manifest, ownership, expected_node_ids)
    labctl.shape(observations, OBSERVATION_KEYS)
    labctl.integer(observations["schema_version"], 1, 1)
    require(observations["lane"] == "offline-snapshot" and type(observations["origin"]) is str and
            observations["origin"] in {"synthetic", "operator-supplied"}, "invalid-snapshot-origin")
    require(type(observations["snapshot_id"]) is str and re.fullmatch(r"[0-9a-f]{32}", observations["snapshot_id"]),
            "invalid-snapshot-id")
    for key, value in {"run_id": ownership["run_id"], "plan_sha256": ownership["plan_sha256"],
                       "bundle_sha256": ownership["bundle_sha256"]}.items():
        require(type(observations[key]) is str and observations[key] == value, "snapshot-binding")
    require(type(observations["nodes"]) is list and len(observations["nodes"]) == 6, "incomplete-snapshot")
    by_id, views = {node["node_id"]: node for node in expected.values()}, {}
    targets = {t["role"]: t for t in ownership["targets"]}
    for record in observations["nodes"]:
        labctl.shape(record, RECORD_KEYS)
        role = record["role"]
        require(type(role) is str and role in expected and role not in views, "invalid-snapshot-role")
        for key, value in targets[role].items():
            require(type(record[key]) is str and record[key] == value, "snapshot-target-binding")
        require(record["machine_identity_sha256"] == hosts[record["host"]]["machine_identity_sha256"] and
                labctl.canonical(record["labels"]) == labctl.canonical(bundle.labels(manifest, role)), "snapshot-identity-binding")
        require(record["container_state"] == "running", "snapshot-not-running")
        rows = parse_cluster_nodes(record["cluster_nodes"])
        myself = [r["node_id"] for r in rows if "myself" in r["flags"]]
        require(myself == [expected[role]["node_id"]], "snapshot-self-binding")
        for row in rows:
            require(row["node_id"] in by_id, "foreign-node")
            node = by_id[row["node_id"]]
            require(all(row[k] == node[k] for k in ("ipv4", "port", "bus_port")), "snapshot-endpoint-binding")
        views[role] = {"rows": rows, "info": parse_cluster_info(record["cluster_info"]),
                       "keyspace": parse_info_keyspace(record["info_keyspace"])}
    return {"classification": _classify(views, expected), "views": views}


def _phases(manifest, ownership, ids):
    _, _, nodes = _expected(manifest, ownership, ids)
    def target(role):
        return {k: nodes[role][k] for k in ("host", "role", "container_id", "node_id")}
    actions = [[{"kind": "set-config-epoch", "target": target(role), "epoch": i + 1}
                for i, role in enumerate(ROLES)],
               [{"kind": "meet", "target": target("M1"), "peer": {k: nodes[role][k]
                 for k in ("host", "role", "node_id", "ipv4", "port", "bus_port")}} for role in ROLES[1:]],
               [{"kind": "addslotsrange", "target": target(role), "slots": nodes[role]["slots"]} for role in ROLES[:3]],
               [{"kind": "replicate", "target": target(role), "master_node_id": ids["M" + role[1]]} for role in ROLES[3:]]]
    return [{"phase_id": phase, "actions": actions[i], "requires_before": COMMON_BEFORE + [BARRIERS[i]],
             "requires_after": [BARRIERS[i + 1]]} for i, phase in enumerate(
                 ("set-config-epochs", "meet", "assign-slots", "replicate"))]


def build_bootstrap_plan(manifest, expected_bundle_digest, ownership, expected_node_ids, observations):
    validated = validate_observations(manifest, expected_bundle_digest, ownership, expected_node_ids, observations)
    classification = validated["classification"]
    plan = copy.deepcopy({"schema_version": 1, **OFFLINE, "source_manifest": manifest, "ownership": ownership,
                          "expected_node_ids": expected_node_ids, "observations": observations,
                          "classification": classification, "phases": _phases(manifest, ownership, expected_node_ids)
                          if classification == "pristine" else [], "unmet_requirements": UNMET})
    plan["bootstrap_sha256"] = labctl.digest(plan)
    _bounded(plan)
    return plan


def validate_bootstrap_plan(plan, expected_bootstrap_digest):
    _bounded(plan)
    labctl.shape(plan, PLAN_KEYS)
    require(type(expected_bootstrap_digest) is str and labctl.HEX.fullmatch(expected_bootstrap_digest), "invalid-bootstrap-digest")
    require(plan["bootstrap_sha256"] == expected_bootstrap_digest, "bootstrap-digest-mismatch")
    manifest = plan["source_manifest"]
    require(type(manifest) is dict and "bundle_sha256" in manifest, "invalid-source-manifest")
    derived = build_bootstrap_plan(manifest, manifest["bundle_sha256"], plan["ownership"],
                                  plan["expected_node_ids"], plan["observations"])
    require(labctl.canonical(plan) == labctl.canonical(derived), "bootstrap-semantic-mismatch")
    return derived


def _summary(plan):
    return {**OFFLINE, "classification": plan["classification"], "phase_count": len(plan["phases"]),
            "action_count": sum(len(p["actions"]) for p in plan["phases"]), "bootstrap_sha256": plan["bootstrap_sha256"]}


def write_bootstrap_plan(plan, expected_bootstrap_digest, output_path):
    plan = validate_bootstrap_plan(plan, expected_bootstrap_digest)
    payload = labctl.canonical(plan).decode("ascii") + "\n"
    require(len(payload) <= labctl.MAX_BYTES, "bootstrap-size-limit")
    require(isinstance(output_path, (str, Path)) and "\x00" not in str(output_path), "unsafe-bootstrap-output")
    path = bundle._output_path(output_path, plan["source_manifest"]["source_plan"])
    try:
        with labctl.directory(path.parent) as parentfd:
            bundle._private_directory(parentfd)
            os.mkdir(path.name, 0o700, dir_fd=parentfd)
            rootfd = os.open(path.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parentfd)
            try:
                info = bundle._private_directory(rootfd)
                current = os.stat(path.name, dir_fd=parentfd, follow_symlinks=False)
                require((info.st_dev, info.st_ino) == (current.st_dev, current.st_ino), "output-path-replaced")
                bundle._save_file(rootfd, "bootstrap.json", payload)
                os.fsync(rootfd)
                os.fsync(parentfd)
            finally:
                os.close(rootfd)
    except OSError:
        raise labctl.LabError("unsafe-bootstrap-output") from None
    return _summary(plan)


def _load_private(path):
    path = Path(path)
    require(path.is_absolute() and ".." not in path.parts and str(path) == os.path.normpath(str(path)), "unsafe-input")
    labctl.outside_source(path)
    try:
        with labctl.directory(path.parent) as parentfd:
            bundle._private_directory(parentfd)
            return labctl.read_at(parentfd, path.name, True)
    except OSError:
        raise labctl.LabError("unsafe-private-input") from None


class Parser(labctl.Parser):
    def print_help(self, file=None):
        print(labctl.canonical({**OFFLINE, "result": "help", "actions": ["plan", "validate"]}).decode("ascii"), file=file)


def main(argv=None):
    try:
        parser = Parser(description=__doc__, allow_abbrev=False)
        commands = parser.add_subparsers(dest="action", required=True, parser_class=Parser)
        planner = commands.add_parser("plan", allow_abbrev=False)
        for argument in ("manifest", "expected-bundle-digest", "ownership", "node-ids", "observations", "output"):
            planner.add_argument("--" + argument, required=True)
        validator = commands.add_parser("validate", allow_abbrev=False)
        validator.add_argument("--plan", required=True)
        validator.add_argument("--expected-bootstrap-digest", required=True)
        args = parser.parse_args(argv)
        if args.action == "plan":
            plan = build_bootstrap_plan(_load_private(args.manifest), args.expected_bundle_digest,
                _load_private(args.ownership), _load_private(args.node_ids), _load_private(args.observations))
            result = write_bootstrap_plan(plan, plan["bootstrap_sha256"], args.output)
        else:
            result = _summary(validate_bootstrap_plan(_load_private(args.plan), args.expected_bootstrap_digest))
        print(labctl.canonical(result).decode("ascii"))
        return 0
    except (labctl.LabError, OSError, ValueError, TypeError, RecursionError, KeyboardInterrupt):
        print(json.dumps({**OFFLINE, "result": "error", "error": "bootstrap-refused"}, sort_keys=True))
        return 2


if __name__ == "__main__":
    sys.exit(main())
