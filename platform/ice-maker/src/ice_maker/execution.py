"""Fail-closed local policy primitives for one bounded agent command."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import selectors
import signal
import subprocess
import time
from typing import Any, Mapping, Sequence

from .sdd import parse_front_matter


class ContractError(ValueError):
    """An untrusted contract or workspace state failed a mandatory gate."""


@dataclass(frozen=True)
class TaskContract:
    task_id: str
    base_sha: str
    spec_sha256: str
    identity: str
    provider: str
    data_class: str
    allowed_paths: tuple[str, ...]
    max_seconds: int
    max_cost_usd: float
    required_commands: tuple[str, ...]


@dataclass(frozen=True)
class ExecutionLimits:
    seconds: int
    output_bytes: int


@dataclass(frozen=True)
class CommandEvidence:
    command: tuple[str, ...]
    exit_code: int
    output: str
    timed_out: bool
    truncated: bool


_TASK_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$")
_SHA = re.compile(r"^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$")
_REPO = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
_ROLE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{1,63}$")
_PATH = re.compile(r"^[A-Za-z0-9._/@#*?{}-]+$")
_REDACT_PATTERNS = (
    re.compile(r"(?i)(?:authorization:\s*bearer\s+|bearer\s+)[A-Za-z0-9._~+/-]{8,}"),
    re.compile(r"(?i)\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s'\"]+"),
    re.compile(
        r"-----BEGIN (?:[A-Z ]*?)PRIVATE KEY-----[\s\S]*?"
        r"(?:-----END (?:[A-Z ]*?)PRIVATE KEY-----|$)"
    ),
)
_REQUIRED = frozenset({
    "task_id", "repo", "base_sha", "spec_path", "task_path", "role", "allowed_paths",
    "network_policy", "max_seconds", "max_cost_usd", "required_commands",
})


def _safe_relative(value: object, *, pattern: bool = False, allow_git: bool = False) -> str:
    if not isinstance(value, str) or not value or len(value) > 512 or not _PATH.fullmatch(value):
        raise ContractError("invalid relative path")
    if value.startswith("/") or "//" in value or "\\" in value or "\x00" in value:
        raise ContractError("invalid relative path")
    parts = value.split("/")
    if any(part in {"", ".", ".."} for part in parts) or (not allow_git and ".git" in parts):
        raise ContractError("invalid relative path")
    if not pattern and any(character in value for character in "*?{}"):
        raise ContractError("invalid relative path")
    if pattern and (value.count("{") != value.count("}") or "{}" in value):
        raise ContractError("malformed path glob")
    return value


def _git(root: Path, *args: str) -> bytes:
    completed = subprocess.run(["git", *args], cwd=root, stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False)
    if completed.returncode:
        raise ContractError("immutable base commit is unavailable")
    return completed.stdout


def _load_json(path: Path) -> Mapping[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise ContractError("policy is unreadable") from exc
    if not isinstance(value, Mapping):
        raise ContractError("policy is malformed")
    return value


def _protected_paths(root: Path, spec: Path) -> tuple[str, ...]:
    policy = _load_json(root / "orchestration/policies/protected-paths.json")
    configured = policy.get("paths")
    if not isinstance(configured, list) or not all(isinstance(item, str) for item in configured):
        raise ContractError("protected-path policy is malformed")
    try:
        fields = parse_front_matter(spec.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        raise ContractError("spec is unreadable") from exc
    forbidden = fields.get("forbidden_paths")
    if not isinstance(forbidden, list) or not all(isinstance(item, str) for item in forbidden):
        raise ContractError("spec forbidden paths are malformed")
    return tuple([".git/**", *configured, *forbidden])


def _glob_matches(pattern: str, path: str) -> bool:
    """Match slash-delimited globs with ``**`` spanning path components."""
    expression = re.escape(pattern).replace(r"\*\*", ".*").replace(r"\*", "[^/]*").replace(r"\?", "[^/]")
    for group in re.findall(r"\\\{([^{}]+)\\\}", expression):
        expression = expression.replace(r"\{" + group + r"\}", "(" + "|".join(map(re.escape, group.split(","))) + ")")
    return re.fullmatch(expression, path) is not None


def _overlaps(pattern: str, protected: str) -> bool:
    sample = protected.replace("**", "sentinel").replace("*", "sentinel").replace("?", "x")
    if _glob_matches(pattern, sample) or _glob_matches(protected, pattern):
        return True
    pattern_prefix = re.split(r"[*?{]", pattern, maxsplit=1)[0]
    protected_prefix = re.split(r"[*?{]", protected, maxsplit=1)[0]
    if not pattern_prefix or not protected_prefix:
        return True
    return pattern_prefix.startswith(protected_prefix) or protected_prefix.startswith(pattern_prefix)


def validate_task_contract(
    raw: Mapping[str, object], root: Path, provider_policy: Path, *, provider: str
) -> TaskContract:
    """Validate the immutable local contract without invoking a provider or command."""
    if not isinstance(raw, Mapping) or set(raw) != _REQUIRED:
        raise ContractError("contract fields do not match the frozen schema")
    task_id, repo, base_sha, role = (raw[name] for name in ("task_id", "repo", "base_sha", "role"))
    if not isinstance(task_id, str) or not _TASK_ID.fullmatch(task_id) or not isinstance(repo, str) or not _REPO.fullmatch(repo):
        raise ContractError("invalid task identity")
    if not isinstance(base_sha, str) or not _SHA.fullmatch(base_sha) or not isinstance(role, str) or not _ROLE.fullmatch(role):
        raise ContractError("invalid task identity")
    root = root.resolve(strict=True)
    spec_path = root / _safe_relative(raw["spec_path"])
    task_path = root / _safe_relative(raw["task_path"])
    for path in (spec_path, task_path):
        if path.is_symlink() or not path.is_file() or root not in path.resolve().parents:
            raise ContractError("governed file must be a regular in-repository file")
    allowed = raw["allowed_paths"]
    if (
        not isinstance(allowed, list)
        or not allowed
        or not all(isinstance(item, str) for item in allowed)
        or len(set(allowed)) != len(allowed)
    ):
        raise ContractError("invalid allowed paths")
    allowed_paths = tuple(_safe_relative(item, pattern=True) for item in allowed)
    for pattern in allowed_paths:
        if "[" in pattern or "]" in pattern:
            raise ContractError("malformed path glob")
    for protected in _protected_paths(root, spec_path):
        for pattern in allowed_paths:
            if _overlaps(pattern, protected):
                raise ContractError("allowed path overlaps a protected or forbidden path")
    if raw["network_policy"] != "deny-by-default":
        raise ContractError("network policy is not deny-by-default")
    seconds, cost = raw["max_seconds"], raw["max_cost_usd"]
    if isinstance(seconds, bool) or not isinstance(seconds, int) or not 1 <= seconds <= 86400:
        raise ContractError("invalid time budget")
    if isinstance(cost, bool) or not isinstance(cost, (int, float)) or not 0 < cost <= 10000:
        raise ContractError("invalid cost budget")
    commands = raw["required_commands"]
    if (
        not isinstance(commands, list)
        or not commands
        or not all(isinstance(item, str) and item.strip() and len(item) <= 1000 for item in commands)
        or len(set(commands)) != len(commands)
    ):
        raise ContractError("invalid required commands")
    if any(re.search(r"(?:[;&|`]|\$\(|\n|\r)", item) for item in commands):
        raise ContractError("shell-like command ambiguity")
    try:
        spec_fields = parse_front_matter(spec_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        raise ContractError("spec is unreadable") from exc
    data_class = spec_fields.get("data_class")
    spec_budget = spec_fields.get("budget_usd")
    if (
        isinstance(spec_budget, bool)
        or not isinstance(spec_budget, (int, float))
        or spec_budget < 0
        or cost > spec_budget
    ):
        raise ContractError("cost budget exceeds the approved specification")
    policy = _load_json(provider_policy)
    providers = policy.get("providers")
    known_classes = policy.get("data_classes")
    if (
        policy.get("default") != "deny"
        or not isinstance(provider, str)
        or not isinstance(data_class, str)
        or not isinstance(known_classes, list)
        or not all(isinstance(item, str) for item in known_classes)
        or data_class not in known_classes
        or not isinstance(providers, Mapping)
    ):
        raise ContractError("provider policy denies this task")
    entry = providers.get(provider)
    allowed_classes = entry.get("allowed_data_classes") if isinstance(entry, Mapping) else None
    blocked_classes = entry.get("blocked_data_classes") if isinstance(entry, Mapping) else None
    if (
        not isinstance(allowed_classes, list)
        or not all(isinstance(item, str) for item in allowed_classes)
        or not isinstance(blocked_classes, list)
        or not all(isinstance(item, str) for item in blocked_classes)
        or data_class not in allowed_classes
        or data_class in blocked_classes
    ):
        raise ContractError("provider policy denies this task")
    resolved = _git(root, "rev-parse", "--verify", base_sha + "^{commit}").decode("ascii").strip()
    current_head = _git(root, "rev-parse", "--verify", "HEAD^{commit}").decode("ascii").strip()
    if resolved.lower() != base_sha.lower() or current_head.lower() != base_sha.lower():
        raise ContractError("base commit is stale")
    spec_hash = hashlib.sha256(spec_path.read_bytes()).hexdigest()
    return TaskContract(task_id, base_sha.lower(), spec_hash, f"{task_id}:{base_sha.lower()}:{spec_hash}", provider,
                        data_class, allowed_paths, seconds, float(cost), tuple(commands))


def redact(text: str, secrets: Sequence[str] = ()) -> str:
    """Remove supplied and recognizable secret forms before evidence is retained."""
    value = text
    for secret in sorted({item for item in secrets if item}, key=len, reverse=True):
        value = value.replace(secret, "[REDACTED]")
    for pattern in _REDACT_PATTERNS:
        value = pattern.sub("[REDACTED]", value)
    return value


def execute_argv(argv: Sequence[str], limits: ExecutionLimits, secrets: Sequence[str] = ()) -> CommandEvidence:
    """Run one argv command with an explicit environment and bounded evidence."""
    if isinstance(argv, (str, bytes)) or not argv or not all(isinstance(item, str) and item for item in argv):
        raise ContractError("command must be a non-empty argv array")
    if limits.seconds < 1 or limits.output_bytes < 1:
        raise ContractError("execution limits must be positive")
    try:
        process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   text=False, shell=False, start_new_session=True,
                                   env={"PATH": os.defpath, "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"})
    except OSError:
        raise ContractError("command could not start") from None
    assert process.stdout is not None
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    captured = bytearray()
    secret_lookahead = max((len(item.encode("utf-8")) for item in secrets if item), default=0)
    raw_limit = limits.output_bytes + max(65536, secret_lookahead)
    deadline = time.monotonic() + limits.seconds
    timed_out = truncated = False
    while selector.get_map():
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            timed_out = True
            break
        events = selector.select(remaining)
        if not events:
            continue
        remaining_capacity = raw_limit + 1 - len(captured)
        if remaining_capacity <= 0:
            truncated = True
            break
        chunk = os.read(process.stdout.fileno(), min(4096, remaining_capacity))
        if not chunk:
            selector.unregister(process.stdout)
            continue
        captured.extend(chunk)
        if len(captured) > limits.output_bytes:
            truncated = True
        if len(captured) > raw_limit:
            break
    if timed_out or truncated:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.wait()
    process.stdout.close()
    selector.close()
    redacted = redact(bytes(captured).decode("utf-8", errors="replace"), secrets)
    redacted_bytes = redacted.encode("utf-8")
    if len(redacted_bytes) > limits.output_bytes:
        truncated = True
        redacted_bytes = redacted_bytes[:limits.output_bytes]
    output = redacted_bytes.decode("utf-8", errors="ignore")
    if truncated:
        output += "\n[TRUNCATED]"
    if timed_out:
        output += "\n[TIMEOUT]"
    exit_code = 124 if timed_out else (125 if truncated else process.returncode)
    return CommandEvidence(tuple(redact(item, secrets) for item in argv), exit_code,
                           output or "[no output]", timed_out, truncated)


def _changed_names(root: Path, base_sha: str) -> tuple[str, ...]:
    raw = _git(root, "diff", "--no-renames", "--name-only", "-z", base_sha, "--") + _git(root, "ls-files", "--others", "--exclude-standard", "-z")
    try:
        names = tuple(item.decode("utf-8") for item in raw.split(b"\0") if item)
    except UnicodeDecodeError as exc:
        raise ContractError("changed path is not valid UTF-8") from exc
    return tuple(sorted(set(names)))


def validate_changed_paths(root: Path, base_sha: str, allowed_paths: Sequence[str], forbidden_paths: Sequence[str]) -> tuple[str, ...]:
    """Return changed paths only when every changed item is contained and allowlisted."""
    root = root.resolve(strict=True)
    if not _SHA.fullmatch(base_sha):
        raise ContractError("invalid base commit")
    _git(root, "rev-parse", "--verify", base_sha + "^{commit}")
    allowed = tuple(_safe_relative(item, pattern=True) for item in allowed_paths)
    forbidden = tuple(_safe_relative(item, pattern=True, allow_git=True) for item in (".git/**", *forbidden_paths))
    names = _changed_names(root, base_sha)
    for name in names:
        _safe_relative(name)
        candidate = root / PurePosixPath(name)
        if candidate.exists() or candidate.is_symlink():
            if candidate.is_dir() or candidate.is_symlink() or root not in candidate.resolve().parents:
                raise ContractError("changed path escapes the worktree")
        if any(_glob_matches(pattern, name) for pattern in forbidden):
            raise ContractError("changed path is forbidden")
        if not any(_glob_matches(pattern, name) for pattern in allowed):
            raise ContractError("changed path is outside the allowlist")
    return names
