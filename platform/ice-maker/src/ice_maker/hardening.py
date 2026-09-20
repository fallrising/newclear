"""Strict hardening contracts and deterministic, secret-free local drills.

Everything here is pure or local-filesystem only: no network, shell, clock,
randomness, credential value, or external deletion. Real runner, identity
provider, proxy, and backup targets remain separately attested external gates.

Filesystem access never trusts a path twice. Every file is opened by walking
its components through pinned, no-follow descriptors, restore staging happens
relative to one pinned destination-parent descriptor, and publication uses the
Linux ``renameat2(RENAME_NOREPLACE)`` primitive so an existing destination can
never be replaced. Cleanup touches only entries this module created, by
descriptor, never by recursive path deletion.
"""

from __future__ import annotations

from collections.abc import Mapping
import ctypes
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
from urllib.parse import urlsplit

from .execution import ContractError
from .runner import _unsafe_path_syntax

_MAX_CONTRACT_BYTES = 65_536
_MAX_TTL_SECONDS = 900
_MAX_ALLOW_ENTRIES = 64
_MAX_CLAIMS = 16
_MAX_RESTORE_FILES = 256
_MAX_RESTORE_FILE_BYTES = 1_048_576
_MAX_RESTORE_TOTAL_BYTES = 16_777_216
_MAX_URL_LENGTH = 2_048
_MAX_CHARGES = 10_000
_MAX_CEILING_CENTS = 10**12
_MAX_LABEL = 128
_READ_CHUNK = 65_536

_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_HOSTNAME = re.compile(r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
_IP_LIKE = re.compile(r"^[0-9.]+$|^\[.*\]$|^[0-9a-f:]*:[0-9a-f:]*$")
_PATH_COMPONENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_CPUS = re.compile(r"^[0-9]{1,2}(?:\.[0-9]{1,2})?$")
_MEMORY = re.compile(r"^([0-9]{1,5})([mg])$")
_SECRET_LABEL = re.compile(r"(?i)(?:token|secret|password|passwd|credential|private[_-]?key|api[_-]?key)")
_SECRET_VALUE = re.compile(
    r"(?i)(?:bearer\s+[A-Za-z0-9._~+/-]{8,}|"
    r"(?:api[_-]?key|token|password|secret)\s*[:=]|"
    r"(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}))"
)
_SAFE_CLAIMS = frozenset({
    "repository", "repository_owner", "ref", "sha", "job_workflow_ref",
    "runner_environment", "environment", "workflow", "actor",
})

COMPROMISE_STEPS: tuple[str, ...] = ("detect", "revoke", "destroy", "rebuild", "canary")
ROTATION_STEPS: tuple[str, ...] = ("issue", "verify", "cutover", "revoke")

_DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
_FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC
_CREATE_FLAGS = os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC
_RENAME_NOREPLACE = 1


# --- pinned descriptors ---------------------------------------------------------

def _load_renameat2() -> object | None:
    """Bind glibc's renameat2 so publication can refuse to replace anything."""
    if sys.platform != "linux":
        return None
    try:
        function = ctypes.CDLL(None, use_errno=True).renameat2
    except (OSError, AttributeError):
        return None
    function.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
    function.restype = ctypes.c_int
    return function


_RENAMEAT2 = _load_renameat2()


def _rename_noreplace(parent_fd: int, staging_name: str, destination_name: str) -> None:
    """Atomically publish staging as destination, failing if destination exists."""
    if _RENAMEAT2 is None:
        raise ContractError("atomic no-replace rename is unavailable; refusing to publish")
    status = _RENAMEAT2(
        parent_fd, os.fsencode(staging_name), parent_fd, os.fsencode(destination_name), _RENAME_NOREPLACE,
    )
    if status != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))


def _open_pinned(path: Path, flags: int) -> int:
    """Open a path by walking each component with O_NOFOLLOW; nothing is trusted by name."""
    if _unsafe_path_syntax(path) or not path.parts:
        raise ContractError("hardening path is unsafe")
    parts = list(path.parts)
    start = parts.pop(0) if path.is_absolute() else "."
    if not parts:
        raise ContractError("hardening path is unsafe")
    try:
        fd = os.open(start, _DIR_FLAGS)
    except OSError as exc:
        raise ContractError("hardening path is unreachable") from exc
    try:
        for part in parts[:-1]:
            next_fd = os.open(part, _DIR_FLAGS, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        return os.open(parts[-1], flags | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
    except OSError as exc:
        raise ContractError("hardening path is missing, symlinked, or unreachable") from exc
    finally:
        os.close(fd)


def _read_regular(fd: int, max_bytes: int, label: str) -> bytes:
    """Read one already-open regular file completely, within a fixed bound."""
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode):
        raise ContractError(f"{label} is not a regular file")
    if info.st_size > max_bytes:
        raise ContractError(f"{label} exceeds the size bound")
    chunks: list[bytes] = []
    remaining = max_bytes + 1
    while remaining > 0:
        chunk = os.read(fd, min(remaining, _READ_CHUNK))
        if not chunk:
            break
        chunks.append(chunk)
        remaining -= len(chunk)
    data = b"".join(chunks)
    if len(data) != info.st_size:
        raise ContractError(f"{label} changed while it was being read")
    return data


def _exists_at(dir_fd: int, name: str) -> bool:
    try:
        os.stat(name, dir_fd=dir_fd, follow_symlinks=False)
    except FileNotFoundError:
        return False
    except OSError as exc:
        raise ContractError("restore destination parent is unreadable") from exc
    return True


# --- strict JSON ---------------------------------------------------------------

def _unique_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ContractError("hardening contract has a duplicate key")
        result[key] = value
    return result


def _reject_constant(name: str) -> object:
    raise ContractError("hardening contract has a non-finite number")


def load_strict_json(path: Path, *, max_bytes: int = _MAX_CONTRACT_BYTES) -> dict[str, object]:
    """Load one bounded JSON object through a pinned descriptor, refusing duplicates and odd numbers."""
    fd = _open_pinned(path, os.O_RDONLY)
    try:
        raw = _read_regular(fd, max_bytes, "hardening contract")
    except OSError as exc:
        raise ContractError("hardening contract is unreadable") from exc
    finally:
        os.close(fd)
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ContractError("hardening contract is not UTF-8") from exc
    if any(ord(character) < 32 and character not in "\n\r\t" for character in text):
        raise ContractError("hardening contract contains control characters")
    try:
        data = json.loads(text, object_pairs_hook=_unique_pairs, parse_constant=_reject_constant)
    except (json.JSONDecodeError, RecursionError) as exc:
        raise ContractError("hardening contract is malformed") from exc
    if not isinstance(data, dict):
        raise ContractError("hardening contract must be a JSON object")
    return data


def _object(value: object, keys: frozenset[str], label: str) -> dict[str, object]:
    if not isinstance(value, dict) or set(value) != keys:
        raise ContractError(f"{label} has unknown or missing fields")
    return value


def _bounded_int(value: object, low: int, high: int, label: str) -> int:
    if type(value) is not int or not low <= value <= high:
        raise ContractError(f"{label} is out of bounds")
    return value


def _flag(value: object, expected: bool, label: str) -> bool:
    if value is not expected:
        raise ContractError(f"{label} must be {str(expected).lower()}")
    return value


def _label(value: object, label: str, pattern: re.Pattern[str] = _SAFE_ID) -> str:
    if (
        type(value) is not str
        or len(value) > _MAX_LABEL
        or not pattern.fullmatch(value)
        or _SECRET_VALUE.search(value)
        or _SECRET_LABEL.search(value)
    ):
        raise ContractError(f"{label} is unsafe")
    return value


def _digest(payload: object) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# --- tracked contracts -----------------------------------------------------------

@dataclass(frozen=True, slots=True)
class ResourceLimits:
    cpus: str
    memory: str
    pids: int
    timeout_seconds: int

    def __post_init__(self) -> None:
        _validate_limits(self)


def _validate_limits(value: object) -> ResourceLimits:
    if type(value) is not ResourceLimits:
        raise ContractError("runner limits are invalid")
    try:
        cpus, memory, pids, timeout = value.cpus, value.memory, value.pids, value.timeout_seconds
    except AttributeError as exc:
        raise ContractError("runner limits are incomplete") from exc
    memory_match = _MEMORY.fullmatch(memory) if type(memory) is str else None
    if (
        type(cpus) is not str or not _CPUS.fullmatch(cpus) or not 0 < float(cpus) <= 8
        or memory_match is None
        or not 0 < int(memory_match.group(1)) * (1024 if memory_match.group(2) == "g" else 1) <= 8192
    ):
        raise ContractError("runner limits are unbounded")
    _bounded_int(pids, 1, 1024, "runner pids limit")
    _bounded_int(timeout, 1, 7200, "runner timeout")
    return value


@dataclass(frozen=True, slots=True)
class RunnerContract:
    lifecycle: str
    max_jobs_per_runner: int
    privileged: bool
    rootless: bool
    read_only_root: bool
    no_new_privileges: bool
    capabilities_dropped: str
    capabilities_added: tuple[str, ...]
    limits: ResourceLimits

    def __post_init__(self) -> None:
        _validate_runner(self)


def _validate_runner(value: object) -> RunnerContract:
    if type(value) is not RunnerContract:
        raise ContractError("runner contract is invalid")
    try:
        fields = (
            value.lifecycle, value.max_jobs_per_runner, value.privileged,
            value.rootless, value.read_only_root, value.no_new_privileges,
            value.capabilities_dropped, value.capabilities_added, value.limits,
        )
    except AttributeError as exc:
        raise ContractError("runner contract is incomplete") from exc
    if fields[0] != "ephemeral" or fields[6] != "ALL" or type(fields[7]) is not tuple or fields[7] != ():
        raise ContractError("runner contract does not enforce one-job rootless isolation")
    _bounded_int(fields[1], 1, 1, "runner job count")
    for actual, expected, label in (
        (fields[2], False, "runner privileged"),
        (fields[3], True, "runner rootless"),
        (fields[4], True, "runner read_only_root"),
        (fields[5], True, "runner no_new_privileges"),
    ):
        _flag(actual, expected, label)
    _validate_limits(fields[8])
    return value


_RUNNER_KEYS = frozenset({
    "version", "lifecycle", "max_jobs_per_runner", "privileged", "rootless",
    "read_only_root", "no_new_privileges", "capabilities", "limits",
})
_LIMIT_KEYS = frozenset({"cpus", "memory", "pids", "timeout_seconds"})


def load_runner_contract(path: Path) -> RunnerContract:
    """Accept only a one-job ephemeral rootless runner with bounded resources."""
    data = _object(load_strict_json(path), _RUNNER_KEYS, "runner contract")
    _bounded_int(data["version"], 1, 1, "runner contract version")
    if data["lifecycle"] != "ephemeral":
        raise ContractError("runner must be ephemeral")
    capabilities = _object(data["capabilities"], frozenset({"drop", "add"}), "runner capabilities")
    if capabilities["drop"] != "ALL" or capabilities["add"] != []:
        raise ContractError("runner must drop all capabilities and add none")
    limits = _object(data["limits"], _LIMIT_KEYS, "runner limits")
    cpus, memory = limits["cpus"], limits["memory"]
    memory_match = _MEMORY.fullmatch(memory) if type(memory) is str else None
    if (
        not isinstance(cpus, str) or not _CPUS.fullmatch(cpus) or not 0 < float(cpus) <= 8
        or memory_match is None
        or int(memory_match.group(1)) * (1024 if memory_match.group(2) == "g" else 1) > 8192
    ):
        raise ContractError("runner limits are unbounded")
    return RunnerContract(
        lifecycle="ephemeral",
        max_jobs_per_runner=_bounded_int(data["max_jobs_per_runner"], 1, 1, "runner job count"),
        privileged=_flag(data["privileged"], False, "runner privileged"),
        rootless=_flag(data["rootless"], True, "runner rootless"),
        read_only_root=_flag(data["read_only_root"], True, "runner read_only_root"),
        no_new_privileges=_flag(data["no_new_privileges"], True, "runner no_new_privileges"),
        capabilities_dropped="ALL",
        capabilities_added=(),
        limits=ResourceLimits(
            cpus, memory,
            _bounded_int(limits["pids"], 1, 1024, "runner pids limit"),
            _bounded_int(limits["timeout_seconds"], 1, 7200, "runner timeout"),
        ),
    )


@dataclass(frozen=True, slots=True)
class IdentityContract:
    method: str
    issuer: str
    audience: str
    max_ttl_seconds: int
    static_credentials: bool
    subject_claims: tuple[str, ...]

    def __post_init__(self) -> None:
        _validate_identity(self)


def _validate_identity(value: object) -> IdentityContract:
    if type(value) is not IdentityContract:
        raise ContractError("identity contract is invalid")
    try:
        method, issuer, audience, ttl, static, claims = (
            value.method, value.issuer, value.audience, value.max_ttl_seconds,
            value.static_credentials, value.subject_claims,
        )
    except AttributeError as exc:
        raise ContractError("identity contract is incomplete") from exc
    if method != "oidc" or type(issuer) is not str or len(issuer) > _MAX_URL_LENGTH or _SECRET_VALUE.search(issuer):
        raise ContractError("identity contract is unsafe")
    parts = urlsplit(issuer)
    if (
        parts.scheme != "https" or parts.username is not None or parts.password is not None
        or not parts.hostname or not _HOSTNAME.fullmatch(parts.hostname) or parts.query or parts.fragment
    ):
        raise ContractError("identity issuer must be a plain https origin")
    _label(audience, "identity audience")
    _bounded_int(ttl, 1, _MAX_TTL_SECONDS, "identity ttl")
    _flag(static, False, "identity static_credentials")
    if (
        type(claims) is not tuple or not claims or len(claims) > _MAX_CLAIMS
        or len(set(claims)) != len(claims) or not all(claim in _SAFE_CLAIMS for claim in claims)
    ):
        raise ContractError("identity subject claims must be a unique bounded tuple")
    return value


_IDENTITY_KEYS = frozenset({
    "version", "method", "issuer", "audience", "max_ttl_seconds",
    "static_credentials", "subject_claims",
})


def load_identity_contract(path: Path) -> IdentityContract:
    """Accept only metadata-only OIDC identity that lives at most fifteen minutes."""
    data = _object(load_strict_json(path), _IDENTITY_KEYS, "identity contract")
    _bounded_int(data["version"], 1, 1, "identity contract version")
    if data["method"] != "oidc":
        raise ContractError("identity method must be oidc")
    issuer = data["issuer"]
    if not isinstance(issuer, str) or len(issuer) > _MAX_URL_LENGTH or _SECRET_VALUE.search(issuer):
        raise ContractError("identity issuer is unsafe")
    parts = urlsplit(issuer)
    if (
        parts.scheme != "https" or parts.username is not None or parts.password is not None
        or not parts.hostname or not _HOSTNAME.fullmatch(parts.hostname) or parts.query or parts.fragment
    ):
        raise ContractError("identity issuer must be a plain https origin")
    claims = data["subject_claims"]
    if (
        not isinstance(claims, list) or not claims or len(claims) > _MAX_CLAIMS
        or len(set(claims)) != len(claims) or not all(claim in _SAFE_CLAIMS for claim in claims)
    ):
        raise ContractError("identity subject claims must be a unique set of metadata claims")
    return IdentityContract(
        method="oidc",
        issuer=issuer,
        audience=_label(data["audience"], "identity audience"),
        max_ttl_seconds=_bounded_int(data["max_ttl_seconds"], 1, _MAX_TTL_SECONDS, "identity ttl"),
        static_credentials=_flag(data["static_credentials"], False, "identity static_credentials"),
        subject_claims=tuple(claims),
    )


def _hostname(value: object) -> str:
    if type(value) is not str or _IP_LIKE.fullmatch(value) or not _HOSTNAME.fullmatch(value):
        raise ContractError("egress host must be an exact lowercase DNS name")
    return value


@dataclass(frozen=True, slots=True)
class EgressEntry:
    host: str
    scheme: str
    port: int

    def __post_init__(self) -> None:
        _validate_entry(self)


@dataclass(frozen=True, slots=True)
class EgressPolicy:
    default_action: str
    direct_egress: bool
    proxy: str
    allow: tuple[EgressEntry, ...]

    def __post_init__(self) -> None:
        _validate_policy(self)


@dataclass(frozen=True, slots=True)
class EgressDecision:
    allowed: bool
    host: str
    reason: str

    def __post_init__(self) -> None:
        if (
            type(self.allowed) is not bool or type(self.host) is not str
            or len(self.host) > 253 or any(ord(character) < 32 for character in self.host)
            or type(self.reason) is not str or not self.reason or len(self.reason) > _MAX_LABEL
        ):
            raise ContractError("egress decision is invalid")
        if self.allowed and self.reason != "request host is allowlisted via the named proxy":
            raise ContractError("allowed egress decision has an invalid reason")


def _validate_entry(entry: object) -> EgressEntry:
    if type(entry) is not EgressEntry:
        raise ContractError("egress allow entry is invalid")
    try:
        host, scheme, port = entry.host, entry.scheme, entry.port
    except AttributeError as exc:
        raise ContractError("egress allow entry is incomplete") from exc
    _hostname(host)
    if scheme != "https":
        raise ContractError("egress allow entry must be https")
    _bounded_int(port, 443, 443, "egress port")
    return entry


def _validate_policy(policy: object) -> EgressPolicy:
    """Revalidate every field so a hand-built or forged policy cannot widen egress."""
    if type(policy) is not EgressPolicy:
        raise ContractError("egress policy is invalid")
    try:
        default_action, direct, proxy, allow = (
            policy.default_action, policy.direct_egress, policy.proxy, policy.allow,
        )
    except AttributeError as exc:
        raise ContractError("egress policy is incomplete") from exc
    if default_action != "deny":
        raise ContractError("egress default action must be deny")
    _flag(direct, False, "egress direct_egress")
    _label(proxy, "egress proxy")
    if type(allow) is not tuple or not allow or len(allow) > _MAX_ALLOW_ENTRIES:
        raise ContractError("egress allowlist must be a bounded non-empty tuple")
    for entry in allow:
        _validate_entry(entry)
    if len({entry.host for entry in allow}) != len(allow):
        raise ContractError("egress allowlist has duplicate hosts")
    return policy


_EGRESS_KEYS = frozenset({"version", "default_action", "direct_egress", "proxy", "allow"})
_ENTRY_KEYS = frozenset({"host", "scheme", "port"})


def load_egress_policy(path: Path) -> EgressPolicy:
    """Accept only deny-by-default HTTPS allowlists enforced through a named proxy."""
    data = _object(load_strict_json(path), _EGRESS_KEYS, "egress policy")
    _bounded_int(data["version"], 1, 1, "egress policy version")
    if data["default_action"] != "deny":
        raise ContractError("egress default action must be deny")
    raw_allow = data["allow"]
    if not isinstance(raw_allow, list) or not raw_allow or len(raw_allow) > _MAX_ALLOW_ENTRIES:
        raise ContractError("egress allowlist must be a bounded non-empty list")
    entries = []
    for item in raw_allow:
        entry = _object(item, _ENTRY_KEYS, "egress allow entry")
        if entry["scheme"] != "https":
            raise ContractError("egress allow entry must be https")
        _bounded_int(entry["port"], 443, 443, "egress port")
        entries.append(EgressEntry(_hostname(entry["host"]), "https", 443))
    if len({entry.host for entry in entries}) != len(entries):
        raise ContractError("egress allowlist has duplicate hosts")
    return EgressPolicy(
        default_action="deny",
        direct_egress=_flag(data["direct_egress"], False, "egress direct_egress"),
        proxy=_label(data["proxy"], "egress proxy"),
        allow=tuple(entries),
    )


def evaluate_egress(policy: EgressPolicy, url: object, *, via: object) -> EgressDecision:
    """Decide one request deterministically; anything unlisted or ambiguous is denied."""
    policy = _validate_policy(policy)
    if via != policy.proxy:
        return EgressDecision(False, "", "request did not pass through the named proxy")
    if (
        not isinstance(url, str) or not url or len(url) > _MAX_URL_LENGTH
        or any(ord(character) < 33 or ord(character) == 127 for character in url)
    ):
        return EgressDecision(False, "", "request url is empty, overlong, or contains control characters")
    try:
        parts = urlsplit(url)
        hostname = parts.hostname
        port = parts.port
    except ValueError:
        return EgressDecision(False, "", "request url is ambiguous")
    if parts.scheme != "https":
        return EgressDecision(False, hostname or "", "request scheme is not https")
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        return EgressDecision(False, hostname or "", "request url carries userinfo")
    if not hostname:
        return EgressDecision(False, "", "request host is missing")
    if _IP_LIKE.fullmatch(hostname) or not _HOSTNAME.fullmatch(hostname):
        return EgressDecision(False, hostname, "request host is not an exact DNS name")
    if port not in (None, 443):
        return EgressDecision(False, hostname, "request port is not 443")
    if not any(entry.host == hostname for entry in policy.allow):
        return EgressDecision(False, hostname, "request host is not on the allowlist")
    return EgressDecision(True, hostname, "request host is allowlisted via the named proxy")


# --- backup/restore drill -------------------------------------------------------

@dataclass(frozen=True, slots=True)
class RestoreResult:
    destination: Path
    files: tuple[tuple[str, str], ...]
    total_bytes: int
    digest: str

    def __post_init__(self) -> None:
        if not isinstance(self.destination, Path) or _unsafe_path_syntax(self.destination) or type(self.files) is not tuple:
            raise ContractError("restore result is invalid")
        try:
            entries = _restore_entries(dict(self.files))
        except (TypeError, ValueError) as exc:
            raise ContractError("restore result entries are invalid") from exc
        if entries != self.files or _bounded_int(
            self.total_bytes, 0, _MAX_RESTORE_TOTAL_BYTES, "restore result size",
        ) != self.total_bytes or self.digest != _digest([list(entry) for entry in entries]):
            raise ContractError("restore result is inconsistent")


def _restore_entries(manifest: object) -> tuple[tuple[str, str], ...]:
    if not isinstance(manifest, Mapping) or not manifest or len(manifest) > _MAX_RESTORE_FILES:
        raise ContractError("restore manifest must be a bounded non-empty mapping")
    seen: set[str] = set()
    entries: list[tuple[str, str]] = []
    for name, digest in manifest.items():
        if (
            not isinstance(name, str) or not isinstance(digest, str) or not _SHA256.fullmatch(digest)
            or name.startswith("/") or "\\" in name
            or any(ord(character) < 32 for character in name)
        ):
            raise ContractError("restore manifest entry is unsafe")
        pure = PurePosixPath(name)
        if pure.is_absolute() or str(pure) != name or not all(_PATH_COMPONENT.fullmatch(part) and part not in (".", "..") for part in pure.parts):
            raise ContractError("restore manifest path escapes or is malformed")
        folded = name.casefold()
        prefixes = {"/".join(pure.parts[:index]).casefold() for index in range(1, len(pure.parts))}
        if folded in seen or prefixes & seen or any(other.startswith(folded + "/") for other in seen):
            raise ContractError("restore manifest paths collide")
        seen.add(folded)
        entries.append((name, digest))
    return tuple(sorted(entries))


def _read_entry(backup_fd: int, name: str, digest: str) -> bytes:
    """Open one manifest entry component by component under the pinned backup root."""
    parts = PurePosixPath(name).parts
    opened: list[int] = []
    try:
        dir_fd = backup_fd
        for part in parts[:-1]:
            dir_fd = os.open(part, _DIR_FLAGS, dir_fd=dir_fd)
            opened.append(dir_fd)
        fd = os.open(parts[-1], _FILE_FLAGS, dir_fd=dir_fd)
        opened.append(fd)
        data = _read_regular(fd, _MAX_RESTORE_FILE_BYTES, "backup entry")
    except OSError as exc:
        raise ContractError("backup entry is missing, symlinked, or not a regular file") from exc
    finally:
        for descriptor in opened:
            os.close(descriptor)
    if hashlib.sha256(data).hexdigest() != digest:
        raise ContractError("backup entry digest does not match the manifest")
    return data


def _load_verified(backup_fd: int, entries: tuple[tuple[str, str], ...]) -> tuple[list[tuple[str, bytes]], int]:
    contents: list[tuple[str, bytes]] = []
    total = 0
    for name, digest in entries:
        data = _read_entry(backup_fd, name, digest)
        total += len(data)
        if total > _MAX_RESTORE_TOTAL_BYTES:
            raise ContractError("restore exceeds the total size bound")
        contents.append((name, data))
    return contents, total


def _discard_staging(
    parent_fd: int,
    staging_name: str,
    created_files: list[tuple[int, str]],
    created_dirs: list[tuple[int, str, int]],
) -> None:
    """Remove only what this task created, by descriptor; never recurse by path."""
    for dir_fd, name in reversed(created_files):
        try:
            os.unlink(name, dir_fd=dir_fd)
        except OSError:
            pass
    for dir_fd, name, _ in reversed(created_dirs):
        try:
            os.rmdir(name, dir_fd=dir_fd)
        except OSError:
            pass
    try:
        os.rmdir(staging_name, dir_fd=parent_fd)
    except OSError:
        pass


def _stage_and_publish(
    parent_fd: int,
    staging_name: str,
    destination_name: str,
    contents: list[tuple[str, bytes]],
    digests: Mapping[str, str],
) -> None:
    created_files: list[tuple[int, str]] = []
    created_dirs: list[tuple[int, str, int]] = []
    staging_fd: int | None = None
    try:
        os.mkdir(staging_name, 0o700, dir_fd=parent_fd)
    except OSError as exc:
        raise ContractError("restore staging area could not be created") from exc
    try:
        staging_fd = os.open(staging_name, _DIR_FLAGS, dir_fd=parent_fd)
        directory_fds: dict[str, int] = {"": staging_fd}
        for name, data in contents:
            parts = PurePosixPath(name).parts
            key = ""
            current_fd = staging_fd
            for part in parts[:-1]:
                key = f"{key}/{part}" if key else part
                if key not in directory_fds:
                    os.mkdir(part, 0o700, dir_fd=current_fd)
                    child_fd = os.open(part, _DIR_FLAGS, dir_fd=current_fd)
                    created_dirs.append((current_fd, part, child_fd))
                    directory_fds[key] = child_fd
                current_fd = directory_fds[key]
            fd = os.open(parts[-1], _CREATE_FLAGS, 0o600, dir_fd=current_fd)
            created_files.append((current_fd, parts[-1]))
            try:
                view = memoryview(data)
                while len(view):
                    view = view[os.write(fd, view):]
                os.lseek(fd, 0, os.SEEK_SET)
                staged = _read_regular(fd, _MAX_RESTORE_FILE_BYTES, "staged entry")
            finally:
                os.close(fd)
            if hashlib.sha256(staged).hexdigest() != digests[name]:
                raise ContractError("restored bytes drifted from the manifest")
        _rename_noreplace(parent_fd, staging_name, destination_name)
    except (OSError, ContractError) as exc:
        _discard_staging(parent_fd, staging_name, created_files, created_dirs)
        if isinstance(exc, ContractError):
            raise
        raise ContractError("restore could not be published without replacing existing state") from exc
    finally:
        for _, _, child_fd in created_dirs:
            os.close(child_fd)
        if staging_fd is not None:
            os.close(staging_fd)


def restore_backup(backup_root: Path, destination: Path, manifest: Mapping[str, str]) -> RestoreResult:
    """Restore only when every byte verifies; publish atomically without replacing anything."""
    entries = _restore_entries(manifest)
    if _unsafe_path_syntax(backup_root) or _unsafe_path_syntax(destination):
        raise ContractError("restore roots are unsafe")
    destination_name = destination.name
    staging_name = destination_name + ".restore-staging"
    if not _PATH_COMPONENT.fullmatch(destination_name) or destination.parent == destination:
        raise ContractError("restore destination name is unsafe")
    backup_fd = _open_pinned(backup_root, os.O_RDONLY | os.O_DIRECTORY)
    try:
        contents, total = _load_verified(backup_fd, entries)
    finally:
        os.close(backup_fd)
    parent_fd = _open_pinned(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        if _exists_at(parent_fd, destination_name) or _exists_at(parent_fd, staging_name):
            raise ContractError("restore destination or staging area already exists")
        _stage_and_publish(parent_fd, staging_name, destination_name, contents, dict(entries))
    finally:
        os.close(parent_fd)
    return RestoreResult(destination, entries, total, _digest([list(entry) for entry in entries]))


# --- credential rotation drill --------------------------------------------------

@dataclass(frozen=True, slots=True)
class CredentialMetadata:
    """Opaque descriptor of a credential; it never carries the credential value."""

    credential_id: str
    kind: str
    generation: int
    ttl_seconds: int

    def __post_init__(self) -> None:
        _validate_credential(self)


@dataclass(frozen=True, slots=True)
class RotationResult:
    steps: tuple[str, ...]
    revoked_id: str
    active_id: str
    generation: int
    digest: str

    def __post_init__(self) -> None:
        if type(self.steps) is not tuple or self.steps != ROTATION_STEPS:
            raise ContractError("rotation result steps are invalid")
        _label(self.revoked_id, "revoked credential id")
        _label(self.active_id, "active credential id")
        generation = _bounded_int(self.generation, 1, 10**9, "rotation generation")
        payload = {
            "steps": list(ROTATION_STEPS), "revoked": self.revoked_id,
            "active": self.active_id, "generation": generation,
        }
        if self.revoked_id == self.active_id or self.digest != _digest(payload):
            raise ContractError("rotation result is inconsistent")


def _validate_credential(value: object) -> CredentialMetadata:
    if type(value) is not CredentialMetadata:
        raise ContractError("credential metadata is invalid")
    try:
        credential_id, kind, generation, ttl = value.credential_id, value.kind, value.generation, value.ttl_seconds
    except AttributeError as exc:
        raise ContractError("credential metadata is incomplete") from exc
    _label(credential_id, "credential id")
    # The kind is an enumerated metadata tag, so the secret-label filter that
    # would reject the word "token" does not apply; only the exact tag passes.
    if kind != "oidc-token":
        raise ContractError("credential kind must be short-lived oidc-token")
    _bounded_int(generation, 0, 10**9, "credential generation")
    _bounded_int(ttl, 1, _MAX_TTL_SECONDS, "credential ttl")
    return value


def rotate_credential(current: CredentialMetadata, replacement: CredentialMetadata) -> RotationResult:
    """Rehearse issue/verify/cutover/revoke using metadata only."""
    current = _validate_credential(current)
    replacement = _validate_credential(replacement)
    if replacement.credential_id == current.credential_id:
        raise ContractError("replacement credential must have a fresh id")
    if replacement.kind != current.kind:
        raise ContractError("rotation may not change the credential kind")
    if replacement.generation != current.generation + 1:
        raise ContractError("rotation must advance exactly one generation")
    payload = {
        "steps": list(ROTATION_STEPS),
        "revoked": current.credential_id,
        "active": replacement.credential_id,
        "generation": replacement.generation,
    }
    return RotationResult(
        ROTATION_STEPS, current.credential_id, replacement.credential_id,
        replacement.generation, _digest(payload),
    )


# --- compromised runner drill ---------------------------------------------------

@dataclass(frozen=True, slots=True)
class CompromiseResult:
    steps: tuple[str, ...]
    destroyed_runner: str
    replacement_runner: str
    digest: str

    def __post_init__(self) -> None:
        if type(self.steps) is not tuple or self.steps != COMPROMISE_STEPS:
            raise ContractError("compromise result steps are invalid")
        _label(self.destroyed_runner, "destroyed runner id")
        _label(self.replacement_runner, "replacement runner id")
        payload = {
            "steps": list(COMPROMISE_STEPS), "destroyed": self.destroyed_runner,
            "replacement": self.replacement_runner,
        }
        if self.destroyed_runner == self.replacement_runner or self.digest != _digest(payload):
            raise ContractError("compromise result is inconsistent")


def respond_to_compromise(runner_id: str, replacement_id: str, steps: tuple[str, ...]) -> CompromiseResult:
    """Accept only the exact detect/revoke/destroy/rebuild/canary tuple."""
    _label(runner_id, "compromised runner id")
    _label(replacement_id, "replacement runner id")
    if replacement_id == runner_id:
        raise ContractError("a compromised runner may never be reused")
    if type(steps) is not tuple or steps != COMPROMISE_STEPS:
        raise ContractError("compromise response steps must be exactly the tuple detect, revoke, destroy, rebuild, canary")
    payload = {"steps": list(COMPROMISE_STEPS), "destroyed": runner_id, "replacement": replacement_id}
    return CompromiseResult(COMPROMISE_STEPS, runner_id, replacement_id, _digest(payload))


# --- cost ceiling drill ---------------------------------------------------------

@dataclass(frozen=True, slots=True)
class CostResult:
    ceiling_cents: int
    spent_cents: int
    accepted: int
    halted: bool
    digest: str

    def __post_init__(self) -> None:
        ceiling = _bounded_int(self.ceiling_cents, 1, _MAX_CEILING_CENTS, "cost result ceiling")
        spent = _bounded_int(self.spent_cents, 0, ceiling, "cost result spent")
        accepted = _bounded_int(self.accepted, 0, _MAX_CHARGES, "cost result accepted")
        if type(self.halted) is not bool:
            raise ContractError("cost result halted flag is invalid")
        payload = {"ceiling": ceiling, "spent": spent, "accepted": accepted, "halted": self.halted}
        if self.digest != _digest(payload):
            raise ContractError("cost result is inconsistent")


def enforce_cost_ceiling(ceiling_cents: int, charges_cents: tuple[int, ...]) -> CostResult:
    """Accept charges in order and halt before the first one that would overspend."""
    ceiling = _bounded_int(ceiling_cents, 1, _MAX_CEILING_CENTS, "cost ceiling")
    if type(charges_cents) is not tuple or len(charges_cents) > _MAX_CHARGES:
        raise ContractError("charges must be a bounded tuple")
    charges = tuple(_bounded_int(charge, 0, _MAX_CEILING_CENTS, "charge") for charge in charges_cents)
    spent = 0
    accepted = 0
    halted = False
    for charge in charges:
        if spent + charge > ceiling:
            halted = True
            break
        spent += charge
        accepted += 1
    payload = {"ceiling": ceiling, "spent": spent, "accepted": accepted, "halted": halted}
    return CostResult(ceiling, spent, accepted, halted, _digest(payload))
