"""Fail-closed staged evidence for governed execution and publication."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import re
import shlex
from types import MappingProxyType
from typing import Any, Mapping, Sequence

from .execution import CommandEvidence, ContractError, TaskContract, _glob_matches, _safe_relative, redact, validate_changed_paths
from .runner import WorktreeJob, WorktreeLifecycle

_RESULT_KEYS = frozenset({"task_id", "base_sha", "status", "summary", "changed_files", "commands_run", "acceptance", "tests", "risks", "open_questions", "usage"})
_COMMAND_KEYS = frozenset({"command", "exit_code", "output"})
_ACCEPTANCE_KEYS = frozenset({"criterion", "status", "evidence"})
_TEST_KEYS = frozenset({"passed", "failed"})
_USAGE_KEYS = frozenset({"provider", "model", "estimated_cost_usd", "elapsed_seconds"})
_PATH = re.compile(r"^[A-Za-z0-9._/@#-]+$")


def _exact_keys(value: object, keys: frozenset[str], label: str) -> Mapping[str, Any]:
    try:
        if not isinstance(value, Mapping) or set(value) != keys:
            raise ContractError(f"{label} shape is invalid")
        return value
    except (TypeError, AttributeError):
        raise ContractError(f"{label} shape is invalid") from None


def _clean_text(value: object, label: str, maximum: int = 20000) -> str:
    if (not isinstance(value, str) or not value or len(value) > maximum or redact(value) != value
            or any((ord(char) < 32 or 127 <= ord(char) <= 159) and char not in "\t\n" for char in value)):
        raise ContractError(f"{label} is invalid")
    return value


def _command_argv(command: object) -> tuple[str, ...]:
    if not isinstance(command, str):
        raise ContractError("command is invalid")
    try:
        argv = tuple(shlex.split(command, posix=True))
    except ValueError:
        raise ContractError("command text is malformed") from None
    if not argv or any(not item for item in argv):
        raise ContractError("command text is malformed")
    return argv


def _strings(value: object, label: str, *, unique: bool = False) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ContractError(f"{label} is invalid")
    if unique and len(value) != len(set(value)):
        raise ContractError(f"{label} is invalid")
    return list(value)


def _validate_command_evidence(value: object, label: str) -> CommandEvidence:
    if not isinstance(value, CommandEvidence):
        raise ContractError(f"{label} is invalid")
    if (not isinstance(value.command, tuple) or not value.command or any(not isinstance(item, str) or not item for item in value.command)
            or isinstance(value.exit_code, bool) or not isinstance(value.exit_code, int) or not 0 <= value.exit_code <= 255
            or not isinstance(value.output, str) or not isinstance(value.timed_out, bool) or not isinstance(value.truncated, bool)):
        raise ContractError(f"{label} is invalid")
    _clean_text(value.output, label)
    return value


def validate_result(raw: Mapping[str, object], contract: TaskContract, evidence: Sequence[CommandEvidence], adapter_evidence: CommandEvidence | None = None) -> dict[str, object]:
    """Validate result JSON and bind exact, successful observed evidence."""
    if not isinstance(contract, TaskContract) or isinstance(evidence, (str, bytes)):
        raise ContractError("result inputs are invalid")
    try:
        observed_commands = tuple(_validate_command_evidence(item, "command evidence") for item in evidence)
    except TypeError:
        raise ContractError("command evidence is invalid") from None
    adapter = _validate_command_evidence(adapter_evidence, "adapter invocation evidence")
    if adapter.exit_code or adapter.timed_out or adapter.truncated:
        raise ContractError("adapter invocation evidence is unsuccessful")
    if any(item is adapter for item in observed_commands):
        raise ContractError("adapter invocation evidence must be distinct")
    fields = _exact_keys(raw, _RESULT_KEYS, "result")
    if fields["task_id"] != contract.task_id or fields["base_sha"] != contract.base_sha or fields["status"] != "completed":
        raise ContractError("result identity or status is invalid")
    _clean_text(fields["summary"], "result summary", 10000)
    changed = _strings(fields["changed_files"], "result changed files", unique=True)
    for path in changed:
        if not _PATH.fullmatch(path) or redact(path) != path:
            raise ContractError("result changed files are invalid")
        _safe_relative(path)
    commands = fields["commands_run"]
    if not isinstance(commands, list) or len(commands) != len(observed_commands) or len(commands) != len(contract.required_commands):
        raise ContractError("result command evidence is incomplete")
    for submitted, observed, required in zip(commands, observed_commands, contract.required_commands):
        item = _exact_keys(submitted, _COMMAND_KEYS, "command evidence")
        command, output = _clean_text(item["command"], "command", 2000), _clean_text(item["output"], "command output")
        exit_code = item["exit_code"]
        if (command != required or _command_argv(command) != observed.command or isinstance(exit_code, bool)
                or not isinstance(exit_code, int) or exit_code != 0 or exit_code != observed.exit_code
                or output != observed.output or observed.timed_out or observed.truncated
                or "[TIMEOUT]" in output or "[TRUNCATED]" in output):
            raise ContractError("required command failed")
    acceptance = fields["acceptance"]
    if not isinstance(acceptance, list) or not acceptance:
        raise ContractError("acceptance evidence is invalid")
    for entry in acceptance:
        item = _exact_keys(entry, _ACCEPTANCE_KEYS, "acceptance")
        _clean_text(item["criterion"], "acceptance criterion")
        if item["status"] != "pass":
            raise ContractError("acceptance is not complete")
        _clean_text(item["evidence"], "acceptance evidence")
    tests = _exact_keys(fields["tests"], _TEST_KEYS, "tests")
    if any(isinstance(tests[key], bool) or not isinstance(tests[key], int) or tests[key] < 0 for key in _TEST_KEYS) or tests["failed"]:
        raise ContractError("test evidence is invalid")
    for name in ("risks", "open_questions"):
        for item in _strings(fields[name], f"{name} evidence", unique=True):
            _clean_text(item, f"{name} evidence")
    usage = _exact_keys(fields["usage"], _USAGE_KEYS, "usage")
    cost, elapsed = usage["estimated_cost_usd"], usage["elapsed_seconds"]
    if (usage["provider"] != contract.provider or isinstance(cost, bool) or not isinstance(cost, (int, float)) or not math.isfinite(cost) or cost < 0 or cost > contract.max_cost_usd or isinstance(elapsed, bool) or not isinstance(elapsed, int) or elapsed < 0 or elapsed > contract.max_seconds):
        raise ContractError("usage does not match the contract")
    _clean_text(usage["provider"], "usage provider", 128)
    _clean_text(usage["model"], "usage model", 128)
    return dict(fields)


def _freeze(value: object) -> object:
    if isinstance(value, Mapping):
        return MappingProxyType({key: _freeze(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(item) for item in value)
    return value


def _thaw(value: object) -> object:
    if isinstance(value, Mapping):
        return {key: _thaw(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_thaw(item) for item in value]
    return value


def _canonical(value: object) -> bytes:
    return json.dumps(_thaw(value), sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("ascii")


def _evidence_summary(value: CommandEvidence) -> dict[str, object]:
    """Convert already-validated frozen command evidence to canonical JSON data."""
    return {"command": list(value.command), "exit_code": value.exit_code, "output": value.output,
            "timed_out": value.timed_out, "truncated": value.truncated}


def _digest_payload(result: Mapping[str, object], changed: tuple[str, ...], commands: Sequence[CommandEvidence], adapter: CommandEvidence, lifecycle: WorktreeLifecycle) -> dict[str, object]:
    return {"result": result, "changed_files": changed, "commands": [_evidence_summary(item) for item in commands],
            "adapter": _evidence_summary(adapter), "lifecycle": {"repository": str(lifecycle.repository),
            "path": str(lifecycle.path), "base_sha": lifecycle.base_sha}}


def _active_lifecycle(job: object, contract: TaskContract) -> WorktreeLifecycle:
    if not isinstance(job, WorktreeJob):
        raise ContractError("worktree lifecycle is invalid")
    state = job.lifecycle
    if (not state.active or not state.registered or not state.at_base or state.base_sha != contract.base_sha or not state.path.is_dir() or state.path.is_symlink()):
        raise ContractError("worktree is not an active registered contract workspace")
    return state


@dataclass(frozen=True)
class StagedEvidence:
    contract: TaskContract
    result: Mapping[str, object]
    command_evidence: tuple[CommandEvidence, ...]
    adapter_evidence: CommandEvidence
    changed_files: tuple[str, ...]
    lifecycle: WorktreeLifecycle
    digest: str
    _job: WorktreeJob


@dataclass(frozen=True)
class OrchestrationEvidence:
    contract: TaskContract
    result: Mapping[str, object]
    command_evidence: tuple[CommandEvidence, ...]
    adapter_evidence: CommandEvidence
    changed_files: tuple[str, ...]
    lifecycle: WorktreeLifecycle
    result_digest: str

    @property
    def publishable(self) -> bool:
        return True


def stage_evidence(contract: TaskContract, result: Mapping[str, object], evidence: Sequence[CommandEvidence], adapter_evidence: CommandEvidence, job: WorktreeJob, *, forbidden_paths: Sequence[str] = ()) -> StagedEvidence:
    """Stage immutable evidence only while the exact disposable job is active."""
    state = _active_lifecycle(job, contract)
    changed = validate_changed_paths(state.path, contract.base_sha, contract.allowed_paths, forbidden_paths)
    checked = validate_result(result, contract, evidence, adapter_evidence)
    if tuple(checked["changed_files"]) != changed:
        raise ContractError("result changed paths do not match staged Git evidence")
    frozen, command_evidence = _freeze(checked), tuple(evidence)
    payload = _digest_payload(frozen, changed, command_evidence, adapter_evidence, state)
    digest = hashlib.sha256(_canonical(payload)).hexdigest()
    return StagedEvidence(contract, frozen, command_evidence, adapter_evidence, changed, state, digest, job)  # type: ignore[arg-type]


def finalize_evidence(staged: StagedEvidence, job: WorktreeJob) -> OrchestrationEvidence:
    """Finalize only after the same staged job was removed and unregistered."""
    if not isinstance(staged, StagedEvidence) or not isinstance(job, WorktreeJob) or job is not staged._job:
        raise ContractError("worktree lifecycle does not match staged evidence")
    state = job.lifecycle
    if state.instance_id is not staged.lifecycle.instance_id or state.active or state.registered or state.path.exists() or state.path.is_symlink():
        raise ContractError("worktree cleanup is not verified")
    payload = _digest_payload(staged.result, staged.changed_files, staged.command_evidence, staged.adapter_evidence, staged.lifecycle)
    if hashlib.sha256(_canonical(payload)).hexdigest() != staged.digest:
        raise ContractError("staged evidence was mutated")
    return OrchestrationEvidence(staged.contract, staged.result, staged.command_evidence, staged.adapter_evidence, staged.changed_files, staged.lifecycle, staged.digest)


def revalidate_evidence(evidence: OrchestrationEvidence) -> None:
    if not isinstance(evidence, OrchestrationEvidence) or not evidence.publishable:
        raise ContractError("orchestration is not publishable")
    checked = validate_result(_thaw(evidence.result), evidence.contract, evidence.command_evidence, evidence.adapter_evidence)
    payload = _digest_payload(evidence.result, evidence.changed_files, evidence.command_evidence, evidence.adapter_evidence, evidence.lifecycle)
    if (tuple(checked["changed_files"]) != evidence.changed_files or hashlib.sha256(_canonical(payload)).hexdigest() != evidence.result_digest or any(not any(_glob_matches(pattern, path) for pattern in evidence.contract.allowed_paths) for path in evidence.changed_files)):
        raise ContractError("orchestration evidence was mutated")
