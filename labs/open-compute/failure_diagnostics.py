#!/usr/bin/env python3
"""Strict, bounded failure facts. Never publish exception text or runtime output."""
import argparse
import copy
import json
import math
import os
from pathlib import Path
import re
import stat
import subprocess

INPUT_LIMIT = 128 * 1024
OUTPUT_LIMIT = 8192
PROFILES = {
    "restart": "open-compute-evidence", "restore": "open-compute-restore-evidence",
    "resources": "open-compute-resource-evidence", "storage": "open-compute-storage-evidence",
    "crash": "open-compute-crash-evidence", "retry": "open-compute-retry-evidence",
    "trial": "open-compute-trial-evidence",
}
PHASES = frozenset(("unknown", "preflight", "artifact", "pin", "bootstrap", "deployment",
    "durable_wait", "resume", "cleanup", "complete", "evidence", "cold_locked",
    "cold_baseline", "cold_after_writes", "cold_after_completion", "source_removed",
    "restored_startup", "restored_readback", "checkpoint_crash", "crash_readback",
    "first_idle", "first_read_probe", "second_idle", "second_read_probe", "case",
    "init", "first_owner", "second_owner", "third_owner", "destroy"))
CATEGORIES = frozenset(("unknown", "ownership", "identity", "schema", "observer", "deadline",
    "bootstrap", "runtime", "protocol", "io", "interrupted", "signal", "survivor",
    "evidence", "pin", "workload", "deployment", "lock", "type", "metadata", "limit",
    "busy", "dirty", "conflict", "not_found", "shutdown"))
OBSERVATIONS = frozenset(("unknown", "parent_missing", "parent_zombie", "parent_reused",
    "child_missing", "child_reused", "child_reparented", "start_order"))
SLOTS = frozenset(("original", "cleanup", "evidence"))
KEYS = frozenset(("schema_version", "profile", "source_commit", "result", "phase",
    "exit_code", "report_written", "evidence", "failures"))


class DiagnosticError(Exception):
    """Fixed public refusal; do not expose the underlying exception."""


def require(condition):
    if not condition:
        raise DiagnosticError("invalid_diagnostic")


def phase(value):
    return value if type(value) is str and value in PHASES else "unknown"


def source(value):
    return value if type(value) is str and re.fullmatch(r"[a-f0-9]{40}", value) else None


def blank(profile, commit=None, evidence="missing"):
    require(profile in PROFILES)
    return dict(schema_version=1, profile=profile, source_commit=source(commit),
        result="unknown", phase="unknown", exit_code=None, report_written=False,
        evidence=evidence, failures={key: None for key in SLOTS})


def project(value):
    require(type(value) is dict and set(value) == KEYS)
    require(type(value["schema_version"]) is int and value["schema_version"] == 1)
    require(type(value["profile"]) is str and value["profile"] in PROFILES)
    require(value["source_commit"] is None or source(value["source_commit"]) == value["source_commit"])
    require(type(value["result"]) is str and value["result"] in ("passed", "failed", "unknown"))
    require(type(value["phase"]) is str and value["phase"] in PHASES)
    code = value["exit_code"]
    require(code is None or type(code) is int and -255 <= code <= 255)
    require(type(value["report_written"]) is bool)
    require(type(value["evidence"]) is str and value["evidence"] in ("record", "report", "missing", "invalid"))
    failures = value["failures"]
    require(type(failures) is dict and set(failures) == SLOTS)
    for item in failures.values():
        if item is None:
            continue
        require(type(item) is dict and set(item) == {"phase", "category", "observation"})
        require(type(item["phase"]) is str and item["phase"] in PHASES)
        require(type(item["category"]) is str and item["category"] in CATEGORIES)
        observation = item["observation"]
        require(observation is None or type(observation) is str and observation in OBSERVATIONS)
    require(not (value["result"] == "passed" and (any(failures.values()) or code not in (None, 0))))
    result = {key: copy.deepcopy(value[key]) for key in KEYS}
    require(len(json.dumps(result, sort_keys=True, allow_nan=False).encode()) <= OUTPUT_LIMIT)
    return result


def failure(error, at_phase):
    """Recognize exact fixed reasons only; never copy error text into evidence."""
    observation = getattr(error, "observation_reason", None)
    observation = observation if type(observation) is str and observation in OBSERVATIONS else None
    reason = getattr(error, "reason", None)
    if type(reason) is not str or reason not in CATEGORIES:
        try:
            reason = str(error)
        except Exception:
            reason = "unknown"
    if type(reason) is not str or reason not in CATEGORIES:
        reason = {"ProcessObservationError": "observer", "TimeoutExpired": "deadline",
                  "PermissionError": "io", "FileNotFoundError": "io"}.get(type(error).__name__, "unknown")
    return dict(phase=phase(at_phase), category=reason, observation=observation)


class Recorder:
    def __init__(self, profile, commit=None):
        self.value = blank(profile, commit, "record")

    def capture(self, slot, at_phase, error):
        require(slot in SLOTS)
        if self.value["failures"][slot] is None:
            self.value["failures"][slot] = failure(error, at_phase)

    def observe(self, slot, observation):
        item = self.value["failures"].get(slot)
        if item is not None and type(observation) is str and observation in OBSERVATIONS:
            item["observation"] = observation

    def finish(self, report, exit_code):
        value = copy.deepcopy(self.value)
        value.update(result=report.get("result") if report.get("result") in ("passed", "failed") else "unknown",
                     phase=phase(report.get("phase")), exit_code=exit_code,
                     report_written=report.get("evidence_file_written") is True)
        return project(value)


def from_report(value, profile, commit=None):
    require(type(value) is dict)
    result = blank(profile, commit, "report")
    result["result"] = value.get("result") if value.get("result") in ("passed", "failed") else "unknown"
    result["phase"] = phase(value.get("phase"))
    result["report_written"] = value.get("evidence_file_written") is True
    for field, slot in (("error", "original"), ("cleanup_error", "cleanup"), ("evidence_write_error", "evidence")):
        if value.get(field) is not None:
            # Input normal reports may contain arbitrary diagnostics. Only this fixed
            # reason is selected; no raw string or recursive object is serialized.
            reason = value[field] if type(value[field]) is str and value[field] in CATEGORIES else "unknown"
            result["failures"][slot] = dict(phase=result["phase"], category=reason, observation=None)
    return project(result)


def _pairs(values):
    result = {}
    for key, value in values:
        require(key not in result)
        result[key] = value
    return result


def _finite_float(text):
    value = float(text)
    require(math.isfinite(value))
    return value


def read_json(path):
    try:
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            info = os.fstat(directory)
            require(info.st_uid == os.geteuid() and not info.st_mode & 0o022)
            fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        finally:
            os.close(directory)
        try:
            before = os.fstat(fd)
            require(stat.S_ISREG(before.st_mode) and before.st_uid == os.geteuid()
                    and before.st_nlink == 1 and not before.st_mode & 0o022
                    and before.st_size <= INPUT_LIMIT)
            data = bytearray()
            while len(data) <= INPUT_LIMIT:
                chunk = os.read(fd, min(4096, INPUT_LIMIT + 1 - len(data)))
                if not chunk:
                    break
                data.extend(chunk)
            after = os.fstat(fd)
            require(len(data) <= INPUT_LIMIT and len(data) == before.st_size
                    and (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                    == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns))
        finally:
            os.close(fd)
        return json.loads(data, object_pairs_hook=_pairs,
                          parse_constant=lambda _: require(False), parse_float=_finite_float)
    except FileNotFoundError:
        raise
    except (OSError, ValueError, TypeError, DiagnosticError, RecursionError):
        raise DiagnosticError("invalid_diagnostic") from None


def publish(path, value):
    encoded = (json.dumps(project(value), indent=2, sort_keys=True, allow_nan=False) + "\n").encode()
    require(len(encoded) <= OUTPUT_LIMIT)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(directory)
        require(info.st_uid == os.geteuid() and not info.st_mode & 0o022)
        fd = os.open(path.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        with os.fdopen(fd, "wb") as output:
            output.write(encoded)
            output.flush()
            os.fsync(output.fileno())
    finally:
        os.close(directory)


def write_record(directory, recorder, report, exit_code):
    """Best-effort sidecar only. Never alter an existing runtime/report outcome."""
    try:
        publish(directory / "failure-diagnostics.json", recorder.finish(report, exit_code))
        return True
    except (OSError, DiagnosticError, ValueError, TypeError):
        return False


def current_commit():
    try:
        value = subprocess.check_output(["git", "rev-parse", "HEAD"],
            cwd=Path(__file__).resolve().parent, stderr=subprocess.DEVNULL,
            timeout=5, text=True).strip()
        return source(value)
    except (OSError, subprocess.SubprocessError):
        return None


def collect(directory, profile):
    commit = current_commit()
    record = directory / PROFILES[profile] / "failure-diagnostics.json"
    try:
        value = project(read_json(record))
        require(value["profile"] == profile and value["source_commit"] in (None, commit))
        value["source_commit"] = commit
        return value
    except FileNotFoundError:
        pass
    except DiagnosticError:
        return blank(profile, commit, evidence="invalid")
    try:
        return from_report(read_json(directory / PROFILES[profile] / "report.json"), profile, commit)
    except FileNotFoundError:
        return blank(profile, commit)
    except DiagnosticError:
        return blank(profile, commit, evidence="invalid")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("ci",))
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--profiles", required=True, nargs="+", choices=tuple(PROFILES))
    args = parser.parse_args(argv)
    try:
        require(len(args.profiles) == len(set(args.profiles)))
        output = args.directory / "open-compute-diagnostics"
        output.mkdir(mode=0o700, exist_ok=True)
        for name in args.profiles:
            publish(output / (name + ".json"), collect(args.directory, name))
    except (OSError, DiagnosticError, ValueError, TypeError):
        print("diagnostic_publication_failed")
        return 1
    print("diagnostic_projection_written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
