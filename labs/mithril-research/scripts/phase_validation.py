#!/usr/bin/env python3
"""Pure offline checks of supplied Redis phase predicates; no execution authority."""
import json
import os
from pathlib import Path
import stat
import sys

import bootstrap
import bundle
import collector
import collector_helper
import labctl

BARRIERS = tuple(bootstrap.BARRIERS)
ROLES = ("M1", "M2", "M3", "R1", "R2", "R3")
MAX_INPUT_BYTES = 1048576
MAX_COLLECTION_BYTES = 2097152
FLAGS = {"lane": "offline-phase-validation", "execution_supported": False,
         "phase_execution_supported": False, "live_ready": False,
         "live_runtime": "UNEXECUTED", "freshness_verified": False,
         "authenticated_authority": False}
require = labctl.require


def _views(collection):
    return {entry["target"]["role"]: {
        "rows": bootstrap.parse_cluster_nodes(entry["record"]["cluster_nodes"]),
        "info": bootstrap.parse_cluster_info(entry["record"]["cluster_info"]),
        "keyspace": bootstrap.parse_info_keyspace(entry["record"]["info_keyspace"])}
        for entry in collection["nodes"]}


def _empty(view):
    require(not any(view["keyspace"].values()), "phase-predicate-refused")


def _assigned_isolated(views, expected):
    for epoch, role in enumerate(ROLES, 1):
        view = views[role]
        rows = view["rows"]
        require(len(rows) == 1, "phase-predicate-refused")
        row = rows[0]
        require(row["node_id"] == expected[role]["node_id"] and row["flags"] == ["master", "myself"]
                and row["master_node_id"] == "-" and not row["slots"] and row["epoch"] == epoch,
                "phase-predicate-refused")
        _empty(view)
        require(bootstrap._info_matches(view["info"], "fail", 1, 0, 0, epoch, epoch), "phase-predicate-refused")


def _connected(views, expected, slotted):
    expected_ids = {node["node_id"] for node in expected.values()}
    reference = None
    for observer, view in views.items():
        rows = {row["node_id"]: row for row in view["rows"]}
        require(set(rows) == expected_ids, "phase-predicate-refused")
        normalized = {nid: {key: value for key, value in row.items() if key not in {"flags", "ping", "pong"}}
                      | {"role": "master" if "master" in row["flags"] else "slave"} for nid, row in rows.items()}
        if reference is None:
            reference = normalized
        require(reference == normalized, "phase-predicate-refused")
        assigned = set()
        for epoch, role in enumerate(ROLES, 1):
            row, node = rows[expected[role]["node_id"]], expected[role]
            wanted_slots = list(range(node["slots"][0], node["slots"][1] + 1)) if slotted and role.startswith("M") else []
            require("master" in row["flags"] and row["master_node_id"] == "-" and row["epoch"] == epoch
                    and row["slots"] == wanted_slots and not assigned.intersection(row["slots"]),
                    "phase-predicate-refused")
            assigned.update(row["slots"])
        require(len(assigned) == (16384 if slotted else 0), "phase-predicate-refused")
        _empty(view)
        require(bootstrap._info_matches(view["info"], "ok" if slotted else "fail", 6, 3 if slotted else 0,
                16384 if slotted else 0, 6, ROLES.index(observer) + 1), "phase-predicate-refused")


def validate_phase_snapshot(manifest, expected_bundle_digest, ownership, expected_node_ids, collection, barrier_id):
    """Validate original assertions and match exactly one requested offline predicate."""
    require(type(barrier_id) is str and barrier_id in BARRIERS, "phase-barrier-refused")
    original = collector.validate_collection(manifest, expected_bundle_digest, ownership, expected_node_ids, collection)
    require(original["status"] == "complete" and all(entry["status"] == "complete" and entry["record"] is not None
            for entry in original["nodes"]), "phase-complete-collection-required")
    _, _, expected = bootstrap._expected(manifest, ownership, expected_node_ids)
    views = _views(original)
    if barrier_id == BARRIERS[0]:
        require(bootstrap._classify(views, expected) == "pristine", "phase-predicate-refused")
    elif barrier_id == BARRIERS[1]:
        _assigned_isolated(views, expected)
    elif barrier_id in BARRIERS[2:4]:
        _connected(views, expected, barrier_id == BARRIERS[3])
    else:
        require(bootstrap._classify(views, expected) == "already-converged", "phase-predicate-refused")
    return {"schema_version": 1, **FLAGS, "result": "predicate-matched", "barrier_id": barrier_id,
            "origin": original["origin"], "collection_id": original["collection_id"],
            "collection_sha256": labctl.digest(original), "run_id": original["run_id"],
            "plan_sha256": original["plan_sha256"], "bundle_sha256": original["bundle_sha256"]}


def _load_private(raw_path, limit):
    """Read a bounded private regular file without the older 1MiB stat limit."""
    require(type(raw_path) is str and "\x00" not in raw_path, "phase-private-input-refused")
    path = Path(raw_path)
    require(path.is_absolute() and path.anchor == "/" and ".." not in path.parts
            and raw_path == str(path) == os.path.normpath(raw_path),
            "phase-private-input-refused")
    labctl.outside_source(path)
    try:
        with labctl.directory(path.parent) as parentfd:
            bundle._private_directory(parentfd)
            fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parentfd)
            try:
                info = os.fstat(fd)
                require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1
                        and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= limit,
                        "phase-private-input-refused")
                raw = bytearray()
                while len(raw) <= limit:
                    chunk = os.read(fd, min(65536, limit + 1 - len(raw)))
                    if not chunk:
                        break
                    raw.extend(chunk)
                require(len(raw) <= limit, "phase-input-size-limit")
                return collector_helper.decode(bytes(raw), limit)
            finally:
                os.close(fd)
    except (OSError, collector_helper.ProtocolError):
        raise labctl.LabError("phase-private-input-refused") from None


class Parser(labctl.Parser):
    def print_help(self, file=None):
        print(labctl.canonical({**FLAGS, "result": "help", "actions": ["validate"]}).decode("ascii"), file=file)


def main(argv=None):
    try:
        parser = Parser(description=__doc__, allow_abbrev=False)
        commands = parser.add_subparsers(dest="action", required=True, parser_class=Parser)
        validator = commands.add_parser("validate", allow_abbrev=False)
        for argument in ("manifest", "expected-bundle-digest", "ownership", "node-ids", "collection", "barrier"):
            validator.add_argument("--" + argument, required=True)
        args = parser.parse_args(argv)
        result = validate_phase_snapshot(_load_private(args.manifest, MAX_INPUT_BYTES), args.expected_bundle_digest,
            _load_private(args.ownership, MAX_INPUT_BYTES), _load_private(args.node_ids, MAX_INPUT_BYTES),
            _load_private(args.collection, MAX_COLLECTION_BYTES), args.barrier)
        summary = {key: result[key] for key in (*FLAGS, "result", "barrier_id", "origin")}
        print(labctl.canonical(summary).decode("ascii"))
        return 0
    except (labctl.LabError, OSError, ValueError, TypeError, RecursionError, KeyboardInterrupt):
        print(json.dumps({**FLAGS, "result": "error", "error": "phase-validation-refused"}, sort_keys=True))
        return 2


if __name__ == "__main__":
    sys.exit(main())
