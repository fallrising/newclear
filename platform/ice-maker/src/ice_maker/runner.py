"""Local, fail-closed boundaries for disposable agent workspaces."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
import re
import subprocess
from typing import Mapping, Sequence

from .execution import ContractError


_JOB_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_SHA256_IMAGE = re.compile(
    r"^(?:[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*(?::[0-9]+)?/)*"
    r"[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*@sha256:[0-9a-f]{64}$"
)
_FORBIDDEN_ENV = re.compile(r"(?i)(?:token|secret|password|credential|docker_host)")
_SAFE_ENV = frozenset({"LANG", "LC_ALL", "TERM"})
_SAFE_ENV_VALUE = re.compile(r"^[A-Za-z0-9_.@/+:-]{1,64}$")
_SECRET_VALUE = re.compile(
    r"(?i)(?:bearer\s+[A-Za-z0-9._~+/-]{8,}|"
    r"(?:api[_-]?key|token|password|secret)\s*[:=]|"
    r"(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}))"
)
_POLICY_KEYS = frozenset({
    "version", "runtime", "network", "read_only_root", "capabilities",
    "no_new_privileges", "limits", "tmpfs_options", "workspace_mount",
    "forbidden_mounts",
})


@dataclass(frozen=True)
class WorktreeLifecycle:
    """Read-only identity and registration state for one disposable workspace."""

    repository: Path
    path: Path
    base_sha: str
    instance_id: object
    active: bool
    registered: bool
    at_base: bool


def _run_git(root: Path, *args: str) -> None:
    result = subprocess.run(["git", *args], cwd=root, stdin=subprocess.DEVNULL,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    if result.returncode:
        raise ContractError("worktree operation was refused")


def _worktree_registered(root: Path, path: Path) -> bool:
    result = subprocess.run(
        ["git", "worktree", "list", "--porcelain"],
        cwd=root,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        check=False,
    )
    if result.returncode:
        raise ContractError("worktree registration could not be verified")
    return f"worktree {path}\n" in result.stdout


def _has_symlink_component(path: Path) -> bool:
    current = Path(path.anchor) if path.is_absolute() else Path.cwd()
    for part in path.parts[1 if path.is_absolute() else 0:]:
        current /= part
        if current.is_symlink():
            return True
    return False


def _unsafe_path_syntax(path: object) -> bool:
    return (
        not isinstance(path, Path)
        or ".." in path.parts
        or any(character in str(path) for character in ("\n", "\r", "\x00"))
    )


class WorktreeJob:
    """A fresh detached Git worktree that always unregisters on cleanup."""

    def __init__(self, repository: Path, job_root: Path, job_name: str, base_sha: str) -> None:
        if not isinstance(job_name, str) or not _JOB_NAME.fullmatch(job_name):
            raise ContractError("unsafe job name")
        if not isinstance(base_sha, str) or not re.fullmatch(r"[0-9a-fA-F]{40}|[0-9a-fA-F]{64}", base_sha):
            raise ContractError("invalid immutable commit")
        if (
            _unsafe_path_syntax(repository)
            or _unsafe_path_syntax(job_root)
            or _has_symlink_component(repository)
            or _has_symlink_component(job_root)
        ):
            raise ContractError("workspace root is unsafe")
        try:
            self.repository = repository.resolve(strict=True)
            self.job_root = job_root.resolve(strict=True)
        except OSError as exc:
            raise ContractError("workspace root is unavailable") from exc
        if not self.job_root.is_dir():
            raise ContractError("workspace root is unsafe")
        try:
            self.job_root.relative_to(self.repository)
        except ValueError:
            pass
        else:
            raise ContractError("job root may not be inside the source repository")
        try:
            self.repository.relative_to(self.job_root)
        except ValueError:
            pass
        else:
            raise ContractError("job root may not contain the source repository")
        _run_git(self.repository, "rev-parse", "--is-inside-work-tree")
        _run_git(self.repository, "rev-parse", "--verify", base_sha + "^{commit}")
        self.base_sha = base_sha.lower()
        self.path = self.job_root / job_name
        if self.path.exists() or self.path.is_symlink() or self.path.parent != self.job_root:
            raise ContractError("job workspace already exists or escapes its root")
        self._created = False
        # Object identity is deliberately retained only in local lifecycle
        # evidence; it binds staging and final cleanup to this exact job.
        self._instance_id = object()

    @property
    def lifecycle(self) -> WorktreeLifecycle:
        """Return a non-mutating snapshot used by the orchestration boundary."""
        try:
            registered = _worktree_registered(self.repository, self.path)
            head = subprocess.run(
                ["git", "rev-parse", "--verify", "HEAD^{commit}"], cwd=self.path,
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL, text=True, check=False,
            )
            at_base = head.returncode == 0 and head.stdout.strip().lower() == self.base_sha
        except (OSError, ContractError):
            registered = at_base = False
        return WorktreeLifecycle(
            self.repository, self.path, self.base_sha, self._instance_id,
            self._created, registered, at_base,
        )

    def __enter__(self) -> "WorktreeJob":
        if self._created:
            raise ContractError("job workspace is already active")
        try:
            _run_git(self.repository, "worktree", "add", "--detach", str(self.path), self.base_sha)
        except ContractError:
            if self.path.exists() or _worktree_registered(self.repository, self.path):
                result = subprocess.run(
                    ["git", "worktree", "remove", "--force", str(self.path)],
                    cwd=self.repository,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                )
                if (
                    result.returncode
                    or self.path.exists()
                    or _worktree_registered(self.repository, self.path)
                ):
                    raise ContractError("worktree add failed and target cleanup failed") from None
            raise
        if (
            not self.path.is_dir()
            or not (self.path / ".git").is_file()
            or not _worktree_registered(self.repository, self.path)
        ):
            removal = subprocess.run(
                ["git", "worktree", "remove", "--force", str(self.path)],
                cwd=self.repository,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
            if (
                removal.returncode
                or self.path.exists()
                or _worktree_registered(self.repository, self.path)
            ):
                raise ContractError("worktree creation verification and cleanup failed")
            raise ContractError("worktree creation could not be verified")
        self._created = True
        return self

    def cleanup(self) -> None:
        if not self._created:
            return
        result = subprocess.run(["git", "worktree", "remove", "--force", str(self.path)], cwd=self.repository,
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                check=False)
        if (
            result.returncode
            or self.path.exists()
            or _worktree_registered(self.repository, self.path)
        ):
            raise ContractError("worktree cleanup failed")
        self._created = False

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> bool:
        self.cleanup()
        return False


def build_sandbox_argv(
    runtime: str,
    image: str,
    worktree: Path,
    command: Sequence[str],
    *,
    policy_path: Path,
    environment: Mapping[str, str] | None = None,
) -> tuple[str, ...]:
    """Construct, but never execute, the mandated rootless OCI sandbox argv."""
    if _unsafe_path_syntax(policy_path) or _unsafe_path_syntax(worktree):
        raise ContractError("sandbox path is unsafe")
    policy = load_sandbox_policy(policy_path)
    if runtime != "docker":
        raise ContractError("unsupported sandbox runtime")
    if not isinstance(image, str) or image.startswith("-") or not _SHA256_IMAGE.fullmatch(image):
        raise ContractError("sandbox image must be pinned by sha-256 digest")
    if isinstance(command, (str, bytes)) or not command or not all(isinstance(item, str) and item for item in command):
        raise ContractError("sandbox command must be a non-empty argv array")
    if any(
        Path(item).name in {"sh", "bash", "dash", "zsh"}
        or item == "-c"
        or any(ord(character) < 32 for character in item)
        or _SECRET_VALUE.search(item)
        for item in command
    ):
        raise ContractError("shell command is forbidden")
    if environment is not None and (
        not isinstance(environment, Mapping)
        or not all(isinstance(key, str) and isinstance(value, str) for key, value in environment.items())
        or any(
            key not in _SAFE_ENV
            or _FORBIDDEN_ENV.search(key)
            or not _SAFE_ENV_VALUE.fullmatch(value)
            or _SECRET_VALUE.search(value)
            for key, value in environment.items()
        )
    ):
        raise ContractError("sandbox environment key is forbidden")
    try:
        resolved = worktree.resolve(strict=True)
    except OSError as exc:
        raise ContractError("sandbox worktree is unavailable") from exc
    git_file = resolved / ".git"
    if (
        resolved == Path("/")
        or _has_symlink_component(worktree)
        or not resolved.is_dir()
        or not git_file.is_file()
        or git_file.is_symlink()
    ):
        raise ContractError("sandbox worktree is unsafe")
    limits = policy["limits"]
    assert isinstance(limits, dict)
    tmpfs_options = policy["tmpfs_options"]
    assert isinstance(tmpfs_options, list)
    workspace_target = str(policy["workspace_mount"]).removesuffix(":rw")
    argv = [
        runtime, "run", "--rm", f"--network={policy['network']}", "--read-only",
        "--cap-drop=ALL", "--security-opt=no-new-privileges",
        f"--pids-limit={limits['pids']}", f"--cpus={limits['cpus']}",
        f"--memory={limits['memory']}",
        f"--tmpfs=/tmp:{','.join(tmpfs_options)},size={limits['tmpfs']}",
        "--mount", f"type=bind,src={resolved},dst={workspace_target},rw",
        f"--workdir={workspace_target}",
    ]
    for key, value in sorted((environment or {}).items()):
        argv.extend(("--env", f"{key}={value}"))
    argv.extend((image, *command))
    return tuple(argv)


def load_sandbox_policy(path: Path) -> dict[str, object]:
    """Read the machine-readable policy without accepting malformed data."""
    try:
        if _unsafe_path_syntax(path) or _has_symlink_component(path):
            raise ContractError("sandbox policy is unsafe")
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ContractError("sandbox policy is unreadable") from exc
    expected_limits = {"cpus": "1.0", "memory": "512m", "pids": 128, "tmpfs": "64m"}
    if (not isinstance(data, dict) or set(data) != _POLICY_KEYS or data.get("version") != 1
            or data.get("runtime") != "docker-rootless-required" or data.get("network") != "none"
            or data.get("read_only_root") is not True or data.get("capabilities") != "drop-all"
            or data.get("no_new_privileges") is not True or data.get("limits") != expected_limits
            or data.get("tmpfs_options") != ["rw", "noexec", "nosuid", "nodev"]
            or data.get("workspace_mount") != "/workspace:rw"
            or data.get("forbidden_mounts") != ["/var/run/docker.sock", "/", "credentials"]):
        raise ContractError("sandbox policy is malformed")
    limits = data["limits"]
    if (
        not isinstance(limits, dict)
        or isinstance(limits.get("pids"), bool)
        or not isinstance(limits.get("pids"), int)
        or not all(isinstance(limits.get(key), str) for key in ("cpus", "memory", "tmpfs"))
    ):
        raise ContractError("sandbox policy is malformed")
    return data
