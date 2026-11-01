#!/usr/bin/env python3
"""Read-only six-node Redis acquisition. Complete observations grant no authority."""
import copy
import json
import os
from pathlib import Path
import shlex
import sys
import uuid

import bootstrap
import bundle
import collector_helper as helper
import labctl
import ssh_executor

ROLES = ("M1", "M2", "M3", "R1", "R2", "R3")
MAX_COLLECTION_BYTES = 2097152
REMOTE_COMMAND = "python3 -I -c " + shlex.quote(Path(helper.__file__).read_text(encoding="utf-8"))
FLAGS = {"lane": "redis-collection", "phase_execution_supported": False,
         "live_ready": False, "live_runtime": "UNEXECUTED"}
COLLECTION_KEYS = {"schema_version", *FLAGS, "origin", "collection_id", "run_id", "plan_sha256",
                   "bundle_sha256", "expected_node_ids", "status", "nodes"}
RESPONSE_KEYS = helper.REQUEST_KEYS - {"credential"} | {"origin", "status", "record"}
require = labctl.require


def _bounded(value, limit):
    require(len(labctl.canonical(value)) <= limit, "collector-size-limit")


def _inputs(manifest, expected_bundle_digest, ownership, expected_node_ids):
    for value in (manifest, ownership, expected_node_ids):
        _bounded(value, labctl.MAX_BYTES)
    manifest = bundle.validate_manifest(manifest, expected_bundle_digest)
    ownership = ssh_executor.validate_ownership(manifest, ownership)
    require(len(ownership["targets"]) == 6 and {t["role"] for t in ownership["targets"]} == set(ROLES),
            "collector-six-targets-required")
    require(manifest["runtime_spec"]["mithril_image"] != "UNRESOLVED", "collector-draft-refused")
    labctl.shape(expected_node_ids, ROLES)
    require(all(type(value) is str and helper.NODE_ID.fullmatch(value) for value in expected_node_ids.values()),
            "collector-node-map-refused")
    require(len(set(expected_node_ids.values())) == 6, "collector-node-map-refused")
    ids = copy.deepcopy(expected_node_ids)
    hosts = {host["role"]: host for host in manifest["source_plan"]["inventory"]["hosts"]}
    targets = {target["role"]: target for target in ownership["targets"]}
    expected = {}
    for node in manifest["source_plan"]["topology"]:
        role = node["role"]
        if role in ROLES:
            expected[role] = {"role": role, "container_id": targets[role]["container_id"], "node_id": ids[role],
                              "ipv4": hosts[node["host"]]["tailnet_ipv4"], "port": node["port"], "bus_port": node["bus_port"]}
    return manifest, ownership, ids, hosts, targets, expected


def _record(record, manifest, role, hosts, targets, expected):
    labctl.shape(record, helper.RECORD_KEYS)
    host = targets[role]["host"]
    binding = {**targets[role], "machine_identity_sha256": hosts[host]["machine_identity_sha256"],
               "labels": bundle.labels(manifest, role), "container_state": "running"}
    for key, value in binding.items():
        require(type(record[key]) is type(value) and labctl.canonical(record[key]) == labctl.canonical(value),
                "collector-record-binding")
    try:
        helper.validate_process(record["process"])
    except helper.ProtocolError:
        raise labctl.LabError("collector-process-refused") from None
    rows = bootstrap.parse_cluster_nodes(record["cluster_nodes"])
    bootstrap.parse_cluster_info(record["cluster_info"])
    bootstrap.parse_info_keyspace(record["info_keyspace"])
    require([row["node_id"] for row in rows if "myself" in row["flags"]] == [expected[role]["node_id"]],
            "collector-self-binding")
    by_id = {node["node_id"]: node for node in expected.values()}
    for row in rows:
        require(row["node_id"] in by_id, "collector-foreign-node")
        require(all(row[key] == by_id[row["node_id"]][key] for key in ("ipv4", "port", "bus_port")),
                "collector-endpoint-binding")
    # Collection completeness deliberately does not classify topology, health,
    # cross-view agreement or phase admissibility.
    return copy.deepcopy(record)


def _response(req, response, origin):
    try:
        helper.canonical(response)
        helper.shape(response, RESPONSE_KEYS)
        nonsecret = {key: value for key, value in req.items() if key != "credential"}
        echo = {key: response[key] for key in nonsecret}
        helper.require(helper.canonical(echo) == helper.canonical(nonsecret))
        helper.require(type(response["origin"]) is str and response["origin"] == origin)
        helper.require(type(response["status"]) is str and response["status"] in {"complete", "unknown"})
        helper.require(response["record"] is None if response["status"] == "unknown" else type(response["record"]) is dict)
    except helper.ProtocolError:
        raise labctl.LabError("collector-response-refused") from None
    return response


class Transport:
    """Only a Python test seam can substitute the fixed subprocess runner."""
    def __init__(self, config, *, _runner=None):
        self.config = copy.deepcopy(config)
        # Validate shared configuration before any read attempt is dispatched.
        self._argv("collector-config-validation")
        self.origin = "mock-ssh" if _runner is not None else "ssh"
        self._runner = _runner if _runner is not None else helper.bounded_run

    def _argv(self, alias):
        argv = ssh_executor.ssh_argv(self.config, alias)
        try:
            for key in ("ssh_config", "known_hosts"):
                path = Path(self.config[key])
                labctl.outside_source(path)
                with labctl.directory(path.parent) as parentfd:
                    bundle._private_directory(parentfd)
        except OSError:
            raise labctl.LabError("collector-mapping-refused") from None
        argv[-1] = REMOTE_COMMAND
        return argv

    def send(self, request, alias):
        try:
            helper.validate_request(request)
            argv = self._argv(alias)
            raw = self._runner(argv, helper.canonical(request, helper.MAX_REQUEST_BYTES),
                               self.config["deadline_seconds"], helper.MAX_RESPONSE_BYTES)
            return _response(request, helper.decode(raw), self.origin)
        except (helper.ProtocolError, OSError, ValueError, TypeError, RecursionError):
            raise labctl.LabError("collector-transport-unknown") from None


def collect(manifest, expected_bundle_digest, ownership, expected_node_ids, credentials, transport, *, execute_approved=False):
    manifest, ownership, ids, hosts, targets, expected = _inputs(manifest, expected_bundle_digest, ownership, expected_node_ids)
    _bounded(credentials, bundle.MAX_CREDENTIAL_BYTES)
    credentials = bundle.validate_credentials(credentials)
    require(execute_approved is True, "collector-execute-approved-required")
    origin = getattr(transport, "origin", None)
    require(type(origin) is str and origin in {"ssh", "mock-ssh"} and callable(getattr(transport, "send", None)),
            "collector-origin-refused")
    result = {"schema_version": 1, **FLAGS, "origin": origin, "collection_id": uuid.uuid4().hex,
              "run_id": ownership["run_id"], "plan_sha256": ownership["plan_sha256"],
              "bundle_sha256": ownership["bundle_sha256"], "expected_node_ids": ids, "status": "partial", "nodes": []}
    for role in ROLES:
        host = targets[role]["host"]
        req = {"schema_version": 1, "operation_id": uuid.uuid4().hex, "collection_id": result["collection_id"],
               "operation": "collect-redis", "run_id": ownership["run_id"], "plan_sha256": ownership["plan_sha256"],
               "bundle_sha256": ownership["bundle_sha256"], "host": host,
               "machine_identity_sha256": hosts[host]["machine_identity_sha256"], "target": copy.deepcopy(expected[role]),
               "credential": credentials["backend_operator"]}
        try:
            helper.validate_request(req)
        except helper.ProtocolError:
            raise labctl.LabError("collector-request-refused") from None
        entry = {"target": copy.deepcopy(targets[role]), "status": "unknown", "record": None}
        try:
            response = _response(req, transport.send(req, hosts[host]["ssh_alias"]), origin)
            if response["status"] == "complete":
                record = _record(response["record"], manifest, role, hosts, targets, expected)
                entry.update(status="complete", record=record)
        except (labctl.LabError, helper.ProtocolError, OSError, ValueError, TypeError, RecursionError):
            # No retry and no absent/health/cancellation inference. Other exact
            # read targets are still attempted once. Interrupts propagate.
            pass
        result["nodes"].append(entry)
    result["status"] = "complete" if all(entry["status"] == "complete" for entry in result["nodes"]) else "partial"
    return validate_collection(manifest, expected_bundle_digest, ownership, ids, result)


def validate_collection(manifest, expected_bundle_digest, ownership, expected_node_ids, collection):
    """Pure validation of original bindings and raw records, with detached output."""
    manifest, ownership, ids, hosts, targets, expected = _inputs(manifest, expected_bundle_digest, ownership, expected_node_ids)
    _bounded(collection, MAX_COLLECTION_BYTES)
    labctl.shape(collection, COLLECTION_KEYS)
    constants = {"schema_version": 1, **FLAGS, "run_id": ownership["run_id"],
                 "plan_sha256": ownership["plan_sha256"], "bundle_sha256": ownership["bundle_sha256"], "expected_node_ids": ids}
    for key, value in constants.items():
        require(type(collection[key]) is type(value) and labctl.canonical(collection[key]) == labctl.canonical(value),
                "collector-binding-refused")
    require(type(collection["origin"]) is str and collection["origin"] in {"ssh", "mock-ssh"}, "collector-origin-refused")
    require(type(collection["collection_id"]) is str and helper.OPID.fullmatch(collection["collection_id"]),
            "collector-id-refused")
    require(type(collection["nodes"]) is list and len(collection["nodes"]) == 6, "collector-incomplete-set")
    for role, entry in zip(ROLES, collection["nodes"]):
        labctl.shape(entry, {"target", "status", "record"})
        require(labctl.canonical(entry["target"]) == labctl.canonical(targets[role]), "collector-target-binding")
        require(type(entry["status"]) is str and entry["status"] in {"complete", "unknown"}, "collector-status-refused")
        if entry["status"] == "complete":
            _record(entry["record"], manifest, role, hosts, targets, expected)
        else:
            require(entry["record"] is None, "collector-partial-record-refused")
    status = "complete" if all(entry["status"] == "complete" for entry in collection["nodes"]) else "partial"
    require(type(collection["status"]) is str and collection["status"] == status, "collector-status-refused")
    return copy.deepcopy(collection)


def _summary(collection):
    complete = sum(entry["status"] == "complete" for entry in collection["nodes"])
    return {**FLAGS, "origin": collection["origin"], "status": collection["status"],
            "complete_nodes": complete, "unknown_nodes": 6 - complete}


def write_collection(manifest, expected_bundle_digest, ownership, expected_node_ids, collection, output_path):
    collection = validate_collection(manifest, expected_bundle_digest, ownership, expected_node_ids, collection)
    payload = labctl.canonical(collection).decode("ascii") + "\n"
    require(len(payload) <= MAX_COLLECTION_BYTES, "collector-size-limit")
    require(isinstance(output_path, (str, Path)) and "\x00" not in str(output_path), "collector-output-refused")
    path = bundle._output_path(output_path, manifest["source_plan"])
    try:
        with labctl.directory(path.parent) as parentfd:
            bundle._private_directory(parentfd)
            os.mkdir(path.name, 0o700, dir_fd=parentfd)
            rootfd = os.open(path.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parentfd)
            try:
                info = bundle._private_directory(rootfd)
                current = os.stat(path.name, dir_fd=parentfd, follow_symlinks=False)
                require((info.st_dev, info.st_ino) == (current.st_dev, current.st_ino), "collector-output-replaced")
                # bundle's file writer has the old 1MiB cap; collection owns its
                # separate cap and writes its fixed filename without changing it.
                _save_collection(rootfd, payload)
                os.fsync(rootfd)
                os.fsync(parentfd)
            finally:
                os.close(rootfd)
    except OSError:
        raise labctl.LabError("collector-output-refused") from None
    return _summary(collection)


def _save_collection(rootfd, payload):
    """Exclusive fixed output with the independent 2MiB collection limit."""
    raw = payload.encode("ascii")
    require(len(raw) <= MAX_COLLECTION_BYTES, "collector-size-limit")
    fd = os.open("collection.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=rootfd)
    try:
        info = os.fstat(fd)
        require(stat_is_private_empty(info), "collector-output-refused")
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(fd)
    finally:
        os.close(fd)


def stat_is_private_empty(info):
    import stat
    return (stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1
            and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size == 0)


def _load_private(path, *, credential=False):
    require(type(path) is str, "collector-input-refused")
    parsed = Path(path)
    require(parsed.is_absolute() and ".." not in parsed.parts and str(parsed) == os.path.normpath(str(parsed)),
            "collector-input-refused")
    labctl.outside_source(parsed)
    try:
        with labctl.directory(parsed.parent) as parentfd:
            bundle._private_directory(parentfd)
        return bundle.load_credentials(parsed) if credential else bootstrap._load_private(parsed)
    except OSError:
        raise labctl.LabError("collector-input-refused") from None


class Parser(labctl.Parser):
    def print_help(self, file=None):
        print(labctl.canonical({**FLAGS, "result": "help", "actions": ["collect"]}).decode("ascii"), file=file)


def main(argv=None):
    try:
        parser = Parser(description=__doc__, allow_abbrev=False)
        commands = parser.add_subparsers(dest="action", required=True, parser_class=Parser)
        command = commands.add_parser("collect", allow_abbrev=False)
        for key in ("manifest", "expected-bundle-digest", "ownership", "node-ids", "credentials", "transport-config", "output"):
            command.add_argument("--" + key, required=True)
        command.add_argument("--execute-approved", action="store_true")
        args = parser.parse_args(argv)
        require(args.execute_approved, "collector-execute-approved-required")
        manifest, ownership, ids, credentials, config = (
            _load_private(args.manifest), _load_private(args.ownership), _load_private(args.node_ids),
            _load_private(args.credentials, credential=True), _load_private(args.transport_config))
        # Validate the complete shared input set before transport construction.
        _inputs(manifest, args.expected_bundle_digest, ownership, ids)
        collection = collect(manifest, args.expected_bundle_digest, ownership, ids, credentials,
                             Transport(config), execute_approved=True)
        summary = write_collection(manifest, args.expected_bundle_digest, ownership, ids, collection, args.output)
        print(labctl.canonical(summary).decode("ascii"))
        return 0 if collection["status"] == "complete" else 2
    except (labctl.LabError, helper.ProtocolError, OSError, ValueError, TypeError, RecursionError, KeyboardInterrupt):
        print(json.dumps({**FLAGS, "result": "error", "error": "collector-refused"}, sort_keys=True))
        return 2


if __name__ == "__main__":
    sys.exit(main())
