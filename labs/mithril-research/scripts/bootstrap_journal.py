#!/usr/bin/env python3
"""Local once-only uncertain bootstrap intent; no effect or resolution interface."""
from contextlib import contextmanager
import copy
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import sys
import uuid

import bootstrap
import bundle
import labctl

MAX_STATE_BYTES = 65536
MAX_PLAN_BYTES = 1048576
FLAGS = {"lane": "offline-bootstrap-journal", "execution_supported": False, "live_ready": False,
         "live_runtime": "UNEXECUTED", "effect_dispatch_supported": False, "resolution_supported": False}
META_KEYS = {"schema_version", *FLAGS, "journal_id", "bootstrap_sha256", "run_id", "plan_sha256", "bundle_sha256",
             "ownership", "expected_node_ids", "source_origin", "root_binding", "lock_binding"}
INTENT_KEYS = {"schema_version", "journal_id", "bootstrap_sha256", "intent_id", "status", "phase_id", "action_index", "action"}
UUID = re.compile(r"[0-9a-f]{32}\Z")
require = labctl.require


def _path(raw):
    require(type(raw) is str and raw.startswith("/") and not raw.startswith("//")
            and "\x00" not in raw and raw != "/", "journal-path-refused")
    require(all(part not in {"", ".", ".."} for part in raw.split("/")[1:]), "journal-path-refused")
    require(raw == os.path.normpath(raw), "journal-path-refused")
    path = Path(raw)
    require(raw == str(path) and path.anchor == "/", "journal-path-refused")
    labctl.outside_source(path)
    return path


def _plan(original, expected_digest):
    plan = bootstrap.validate_bootstrap_plan(original, expected_digest)
    require(plan["classification"] == "pristine", "journal-pristine-required")
    return plan


def _state_path(raw, plan):
    path = _path(raw)
    for host in plan["source_manifest"]["source_plan"]["inventory"]["hosts"]:
        remote = Path(host["data_root"])
        require(path != remote and path not in remote.parents and remote not in path.parents, "journal-data-overlap")
    return path


def _identity(info):
    return {"device": info.st_dev, "inode": info.st_ino}


def _file_info(fd, limit, empty=False):
    info = os.fstat(fd)
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o600
            and info.st_nlink == 1 and 0 <= info.st_size <= limit and (not empty or info.st_size == 0),
            "journal-file-refused")
    return info


def _same_file(left, right):
    return all(getattr(left, key) == getattr(right, key) for key in
               ("st_dev", "st_ino", "st_mode", "st_uid", "st_nlink", "st_size"))


def _entry(dirfd, name, info):
    current = os.stat(name, dir_fd=dirfd, follow_symlinks=False)
    require(_same_file(info, current), "journal-file-replaced")


def _guard(scope, names):
    bundle._private_directory(scope["parentfd"])
    root = bundle._private_directory(scope["rootfd"])
    require(_identity(root) == _identity(scope["root_info"]), "journal-root-replaced")
    current = os.stat(scope["path"].name, dir_fd=scope["parentfd"], follow_symlinks=False)
    require(stat.S_ISDIR(current.st_mode) and current.st_uid == os.getuid()
            and stat.S_IMODE(current.st_mode) == 0o700 and _identity(current) == _identity(root),
            "journal-root-replaced")
    lock = _file_info(scope["lockfd"], 0, True)
    require(_same_file(lock, scope["lock_info"]), "journal-lock-replaced")
    _entry(scope["rootfd"], ".lock", lock)
    require(set(os.listdir(scope["rootfd"])) == set(names), "journal-namespace-refused")
    for name, info in scope["files"].items():
        _entry(scope["rootfd"], name, info)


@contextmanager
def _scope(path, initialize=False):
    with labctl.directory(path.parent) as parentfd:
        bundle._private_directory(parentfd)
        if initialize:
            os.mkdir(path.name, 0o700, dir_fd=parentfd)
        rootfd = os.open(path.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parentfd)
        lockfd = None
        try:
            root_info = bundle._private_directory(rootfd)
            current = os.stat(path.name, dir_fd=parentfd, follow_symlinks=False)
            require(_identity(root_info) == _identity(current) and stat.S_ISDIR(current.st_mode), "journal-root-replaced")
            if initialize:
                os.fsync(parentfd)
            flags = os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK
            if initialize:
                flags |= os.O_CREAT | os.O_EXCL
            lockfd = os.open(".lock", flags, 0o600, dir_fd=rootfd)
            lock_info = _file_info(lockfd, 0, True)
            scope = {"path": path, "parentfd": parentfd, "rootfd": rootfd, "lockfd": lockfd,
                     "root_info": root_info, "lock_info": lock_info, "files": {}}
            names = set(os.listdir(rootfd))
            if initialize:
                require(names == {".lock"}, "journal-namespace-refused")
            else:
                require(names in ({".lock", "journal.json"}, {".lock", "journal.json", "intent.json"}),
                        "journal-namespace-refused")
            _guard(scope, names)
            try:
                fcntl.flock(lockfd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise labctl.LabError("journal-locked") from None
            _guard(scope, names)
            if initialize:
                os.fsync(lockfd)
                _guard(scope, names)
            yield scope
        finally:
            if lockfd is not None:
                os.close(lockfd)
            os.close(rootfd)


def _read_json(dirfd, name, limit, *, canonical=False):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=dirfd)
    try:
        info = _file_info(fd, limit)
        _entry(dirfd, name, info)
        raw = bytearray()
        while len(raw) <= limit:
            chunk = os.read(fd, min(65536, limit + 1 - len(raw)))
            if not chunk:
                break
            raw.extend(chunk)
        require(len(raw) <= limit and len(raw) == info.st_size, "journal-size-changed")
        require(_same_file(info, _file_info(fd, limit)), "journal-size-changed")
        _entry(dirfd, name, info)
        value = labctl.decode(bytes(raw))
        if canonical:
            require(bytes(raw) == labctl.canonical(value) + b"\n", "journal-noncanonical-state")
        return value, info
    finally:
        os.close(fd)


def _metadata(plan, scope, journal_id):
    require(type(journal_id) is str and UUID.fullmatch(journal_id), "journal-id-refused")
    return {"schema_version": 1, **FLAGS, "journal_id": journal_id, "bootstrap_sha256": plan["bootstrap_sha256"],
            "run_id": plan["ownership"]["run_id"], "plan_sha256": plan["ownership"]["plan_sha256"],
            "bundle_sha256": plan["ownership"]["bundle_sha256"], "ownership": copy.deepcopy(plan["ownership"]),
            "expected_node_ids": copy.deepcopy(plan["expected_node_ids"]), "source_origin": plan["observations"]["origin"],
            "root_binding": _identity(scope["root_info"]), "lock_binding": _identity(scope["lock_info"])}


def _action(plan, phase_id, action_index):
    require(type(phase_id) is str and type(action_index) is int, "journal-action-refused")
    phase = next((phase for phase in plan["phases"] if phase["phase_id"] == phase_id), None)
    require(phase is not None and 0 <= action_index < len(phase["actions"]), "journal-action-refused")
    return copy.deepcopy(phase["actions"][action_index])


def _intent(plan, metadata, intent_id, phase_id, action_index):
    require(type(intent_id) is str and UUID.fullmatch(intent_id), "journal-intent-id-refused")
    return {"schema_version": 1, "journal_id": metadata["journal_id"], "bootstrap_sha256": metadata["bootstrap_sha256"],
            "intent_id": intent_id, "status": "uncertain", "phase_id": phase_id, "action_index": action_index,
            "action": _action(plan, phase_id, action_index)}


def _load_state(scope, plan):
    names = set(os.listdir(scope["rootfd"]))
    require(names in ({".lock", "journal.json"}, {".lock", "journal.json", "intent.json"}), "journal-namespace-refused")
    _guard(scope, names)
    metadata, info = _read_json(scope["rootfd"], "journal.json", MAX_STATE_BYTES, canonical=True)
    if "journal.json" in scope["files"]:
        require(_same_file(info, scope["files"]["journal.json"]), "journal-metadata-replaced")
    scope["files"]["journal.json"] = info
    labctl.shape(metadata, META_KEYS)
    expected = _metadata(plan, scope, metadata["journal_id"])
    require(labctl.canonical(metadata) == labctl.canonical(expected), "journal-binding-refused")
    intent = None
    if "intent.json" in names:
        intent, info = _read_json(scope["rootfd"], "intent.json", MAX_STATE_BYTES, canonical=True)
        if "intent.json" in scope["files"]:
            require(_same_file(info, scope["files"]["intent.json"]), "journal-intent-replaced")
        scope["files"]["intent.json"] = info
        labctl.shape(intent, INTENT_KEYS)
        expected = _intent(plan, metadata, intent["intent_id"], intent["phase_id"], intent["action_index"])
        require(labctl.canonical(intent) == labctl.canonical(expected), "journal-intent-refused")
    _guard(scope, names)
    return {"schema_version": 1, **FLAGS, "journal_state": "no-intent" if intent is None else "uncertain",
            "metadata": copy.deepcopy(metadata), "intent": copy.deepcopy(intent)}


def _commit(scope, pending, final, value, names):
    """Retain every artifact on failure; no unlink, overwrite or cleanup path."""
    raw = labctl.canonical(value) + b"\n"
    require(len(raw) <= MAX_STATE_BYTES, "journal-state-size-limit")
    _guard(scope, names)
    require(pending not in names and final not in names, "journal-destination-present")
    fd = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_NONBLOCK,
                 0o600, dir_fd=scope["rootfd"])
    try:
        _file_info(fd, MAX_STATE_BYTES, True)
        with os.fdopen(fd, "wb", buffering=0, closefd=False) as stream:
            offset = 0
            while offset < len(raw):
                count = stream.write(raw[offset:])
                require(type(count) is int and 0 < count <= len(raw) - offset, "journal-write-refused")
                offset += count
            stream.flush()
            os.fsync(fd)
        info = _file_info(fd, MAX_STATE_BYTES)
        require(info.st_size == len(raw), "journal-write-refused")
        os.fsync(scope["rootfd"])
        _guard(scope, set(names) | {pending})
        _entry(scope["rootfd"], pending, info)
        require(_same_file(info, _file_info(fd, MAX_STATE_BYTES)), "journal-pending-replaced")
        os.rename(pending, final, src_dir_fd=scope["rootfd"], dst_dir_fd=scope["rootfd"])
        os.fsync(scope["rootfd"])
        scope["files"][final] = info
        _guard(scope, set(names) | {final})
        _entry(scope["rootfd"], final, _file_info(fd, MAX_STATE_BYTES))
    finally:
        os.close(fd)


def initialize_journal(plan, expected_bootstrap_digest, state_root):
    try:
        plan = _plan(plan, expected_bootstrap_digest)
        path = _state_path(state_root, plan)
        with _scope(path, True) as scope:
            metadata = _metadata(plan, scope, uuid.uuid4().hex)
            _commit(scope, ".initialize.pending", "journal.json", metadata, {".lock"})
            os.fsync(scope["parentfd"])
            return _load_state(scope, plan)
    except (OSError, ValueError, TypeError, RecursionError, OverflowError):
        raise labctl.LabError("bootstrap-journal-refused") from None


def journal_status(plan, expected_bootstrap_digest, state_root):
    try:
        plan = _plan(plan, expected_bootstrap_digest)
        with _scope(_state_path(state_root, plan)) as scope:
            return _load_state(scope, plan)
    except (OSError, ValueError, TypeError, RecursionError, OverflowError):
        raise labctl.LabError("bootstrap-journal-refused") from None


def record_intent(plan, expected_bootstrap_digest, state_root, phase_id, action_index):
    try:
        plan = _plan(plan, expected_bootstrap_digest)
        _action(plan, phase_id, action_index)
        with _scope(_state_path(state_root, plan)) as scope:
            state = _load_state(scope, plan)
            require(state["intent"] is None, "journal-permanently-uncertain")
            intent = _intent(plan, state["metadata"], uuid.uuid4().hex, phase_id, action_index)
            _commit(scope, ".intent.pending", "intent.json", intent, {".lock", "journal.json"})
            return _load_state(scope, plan)
    except (OSError, ValueError, TypeError, RecursionError, OverflowError):
        raise labctl.LabError("bootstrap-journal-refused") from None


def _load_plan(raw):
    path = _path(raw)
    with labctl.directory(path.parent) as dirfd:
        bundle._private_directory(dirfd)
        return _read_json(dirfd, path.name, MAX_PLAN_BYTES)[0]


class Parser(labctl.Parser):
    def print_help(self, file=None):
        print(labctl.canonical({**FLAGS, "result": "help", "actions": ["init", "status", "record-intent"]}).decode("ascii"), file=file)


def main(argv=None):
    try:
        parser = Parser(description=__doc__, allow_abbrev=False)
        commands = parser.add_subparsers(dest="command", required=True, parser_class=Parser)
        for action in ("init", "status", "record-intent"):
            command = commands.add_parser(action, allow_abbrev=False)
            for argument in ("plan", "expected-bootstrap-digest", "state-root"):
                command.add_argument("--" + argument, required=True)
            if action == "record-intent":
                command.add_argument("--phase-id", required=True)
                command.add_argument("--action-index", required=True)
        args = parser.parse_args(argv)
        original = _load_plan(args.plan)
        if args.command == "init":
            result = initialize_journal(original, args.expected_bootstrap_digest, args.state_root)
        elif args.command == "status":
            result = journal_status(original, args.expected_bootstrap_digest, args.state_root)
        else:
            require(re.fullmatch(r"0|[1-9][0-9]{0,9}", args.action_index) is not None, "journal-index-refused")
            result = record_intent(original, args.expected_bootstrap_digest, args.state_root, args.phase_id, int(args.action_index))
        print(labctl.canonical({**FLAGS, "result": args.command, "journal_state": result["journal_state"],
                                "intent_count": int(result["intent"] is not None)}).decode("ascii"))
        return 0
    except (labctl.LabError, OSError, ValueError, TypeError, RecursionError, OverflowError, KeyboardInterrupt):
        print(json.dumps({**FLAGS, "result": "error", "error": "bootstrap-journal-refused"}, sort_keys=True))
        return 2


if __name__ == "__main__":
    sys.exit(main())
