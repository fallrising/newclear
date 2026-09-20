"""Offline, base-pinned publication of one sealed study bundle."""

from __future__ import annotations

import ctypes
import dataclasses
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import stat
import subprocess
import sys
import tempfile
import unicodedata
from types import MappingProxyType
from typing import Callable, Iterable, Mapping


class StudyPublishError(ValueError):
    """A bundle, target, or isolated-publication invariant failed."""


@dataclasses.dataclass(frozen=True, slots=True)
class StudyPublishResult:
    operation: str
    bundle_digest: str
    base_commit: str
    target_contract_digest: str
    changed_paths: tuple[str, ...]
    diff_sha256: str
    diff: str


@dataclasses.dataclass(frozen=True, slots=True)
class StudyGithubResult:
    operation: str
    repository: str
    remote_url: str
    base_branch: str
    branch: str
    bundle_digest: str
    base_commit: str
    diff_sha256: str
    changed_paths: tuple[str, ...]
    tree_sha256: str
    commit_sha: str | None
    pushed_sha: str | None
    pr_number: int | None
    pr_url: str | None
    draft: bool | None
    command_exit_classes: tuple[str, ...]


_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_COMMIT = re.compile(r"[0-9a-f]{40}\Z")
_SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
_IDENTITY = "fallrising/doc_analysis_study"
_TARGET_FILES = (
    "docs/methodology.md",
    "docs/repository-structure.md",
    "scripts/validate_repository.py",
    "templates/study/README.md",
    "templates/study/progress.md",
    "templates/study/sources.md",
    "templates/study/analysis/overview.md",
    "templates/study/analysis/qa-review.md",
)
_MAX_FILE = 1024 * 1024
_MAX_GIT_OUTPUT = 8 * 1024 * 1024
_MAX_DIFF = 2 * 1024 * 1024
_DIRECTORY = getattr(os, "O_DIRECTORY", 0)
_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
_RENAME_NOREPLACE = 1
_GIT_OPERATIONS = {
    "add", "branch", "bundle", "checkout", "commit", "config", "diff",
    "diff-tree", "fetch", "init", "ls-remote", "push", "remote",
    "rev-parse", "show", "status", "submodule", "worktree", "write-tree",
}
_SECRET = re.compile(
    rb"(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|"
    rb"\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|"
    rb"\bxox[baprs]-[A-Za-z0-9-]{10,}\b)"
)
_GITHUB_CONFIG_VERSION = "study-github-publication.v1"
_GITHUB_CODE_CONFIG = {
    "base_branch": "main",
    "branch_prefix": "study/",
    "config_version": _GITHUB_CONFIG_VERSION,
    "gh_executable": "/usr/bin/gh",
    "git_executable": "/usr/bin/git",
    "registry_path": "README.md",
    "remote_repository": _IDENTITY,
    "remote_url": "git@github.com:fallrising/doc_analysis_study.git",
    "study_root": "studies",
}
_MAX_PUBLICATION_OUTPUT = 1024 * 1024
_MAX_PUBLICATION_TIMEOUT = 60
_PUBLICATION_BRANCH = re.compile(r"study/[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{12}\Z")


def _canonical(value: object) -> bytes:
    try:
        return (
            json.dumps(
                value, sort_keys=True, separators=(",", ":"),
                ensure_ascii=True, allow_nan=False,
            ) + "\n"
        ).encode("ascii")
    except (TypeError, ValueError, UnicodeError) as exc:
        raise StudyPublishError("value is not canonical JSON") from exc


def _absolute_directory(
    value: os.PathLike[str] | str,
    label: str,
    *,
    private: bool = False,
) -> tuple[Path, int]:
    try:
        raw = os.fspath(value)
    except TypeError as exc:
        raise StudyPublishError(label + " is invalid") from exc
    path = Path(raw) if isinstance(raw, str) else Path("")
    if (
        not isinstance(raw, str) or not raw or "\x00" in raw or "\n" in raw
        or not path.is_absolute() or path.as_posix() != raw or ".." in path.parts
        or not _NOFOLLOW or not _DIRECTORY
    ):
        raise StudyPublishError(label + " is invalid")
    descriptor = None
    try:
        descriptor = os.open(path.anchor, os.O_RDONLY | _DIRECTORY | _NOFOLLOW)
        for component in path.parts[1:]:
            following = os.open(
                component, os.O_RDONLY | _DIRECTORY | _NOFOLLOW,
                dir_fd=descriptor,
            )
            os.close(descriptor)
            descriptor = following
        info = os.fstat(descriptor)
        if info.st_uid != os.getuid() or (private and stat.S_IMODE(info.st_mode) != 0o700):
            raise StudyPublishError(label + " ownership or mode is unsafe")
        return path, descriptor
    except StudyPublishError:
        if descriptor is not None:
            os.close(descriptor)
        raise
    except OSError as exc:
        if descriptor is not None:
            os.close(descriptor)
        raise StudyPublishError(label + " is invalid") from exc


def _read_beneath(root: int, relative: str, maximum: int = _MAX_FILE) -> bytes:
    parts = relative.split("/")
    if (
        not relative or relative.startswith("/") or ".." in parts
        or any(not part or part in {".", ".."} for part in parts)
    ):
        raise StudyPublishError("unsafe relative path")
    directory = os.dup(root)
    try:
        for component in parts[:-1]:
            following = os.open(
                component, os.O_RDONLY | _DIRECTORY | _NOFOLLOW,
                dir_fd=directory,
            )
            os.close(directory)
            directory = following
        descriptor = os.open(
            parts[-1], os.O_RDONLY | _NOFOLLOW | getattr(os, "O_CLOEXEC", 0),
            dir_fd=directory,
        )
        try:
            before = os.fstat(descriptor)
            if (
                not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                or not 0 < before.st_size <= maximum
            ):
                raise StudyPublishError("unsafe regular file")
            data = bytearray()
            while len(data) < before.st_size:
                block = os.read(descriptor, min(65_536, before.st_size - len(data)))
                if not block:
                    raise StudyPublishError("file changed during read")
                data.extend(block)
            after = os.fstat(descriptor)
            fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
            if os.read(descriptor, 1) or any(
                getattr(before, field) != getattr(after, field) for field in fields
            ):
                raise StudyPublishError("file changed during read")
            return bytes(data)
        finally:
            os.close(descriptor)
    except StudyPublishError:
        raise
    except OSError as exc:
        raise StudyPublishError("unsafe regular file") from exc
    finally:
        os.close(directory)


def _strict_json(data: bytes) -> dict[str, object]:
    duplicate = False

    def pairs(items: list[tuple[str, object]]) -> dict[str, object]:
        nonlocal duplicate
        result: dict[str, object] = {}
        for key, value in items:
            duplicate = duplicate or key in result
            result[key] = value
        return result

    try:
        value = json.loads(data.decode("ascii"), object_pairs_hook=pairs)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise StudyPublishError("bundle manifest is invalid") from exc
    if duplicate or not isinstance(value, dict) or _canonical(value) != data:
        raise StudyPublishError("bundle manifest is invalid")
    return value


def _strict_json_labeled(data: bytes, label: str) -> dict[str, object]:
    duplicate = False

    def pairs(items: list[tuple[str, object]]) -> dict[str, object]:
        nonlocal duplicate
        result: dict[str, object] = {}
        for key, value in items:
            duplicate = duplicate or key in result
            result[key] = value
        return result

    try:
        value = json.loads(data.decode("ascii"), object_pairs_hook=pairs)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise StudyPublishError(label + " is invalid") from exc
    if duplicate or not isinstance(value, dict) or _canonical(value) != data:
        raise StudyPublishError(label + " is invalid")
    return value


def load_github_publication_config(
    path: os.PathLike[str] | str | None = None,
) -> Mapping[str, object]:
    """Load code-ceiling-bound host publication configuration."""
    try:
        source = (
            Path(path)
            if path is not None
            else Path(__file__).resolve().parents[2]
            / "config"
            / "study-github-publication.json"
        )
    except TypeError as exc:
        raise StudyPublishError("GitHub publication config path is invalid") from exc
    if not source.is_absolute() or source.as_posix() != os.fspath(source):
        raise StudyPublishError("GitHub publication config path is invalid")
    parent, descriptor = _absolute_directory(source.parent, "publication config parent")
    try:
        value = _strict_json_labeled(
            _read_beneath(descriptor, source.name, 128 * 1024),
            "GitHub publication config",
        )
    finally:
        os.close(descriptor)
    expected_fields = set(_GITHUB_CODE_CONFIG) | {
        "max_output_bytes", "timeout_seconds",
    }
    if set(value) != expected_fields or any(
        value.get(key) != expected
        for key, expected in _GITHUB_CODE_CONFIG.items()
    ):
        raise StudyPublishError("GitHub publication config exceeds its capability ceiling")
    maximum = value.get("max_output_bytes")
    timeout = value.get("timeout_seconds")
    if (
        type(maximum) is not int
        or not 1 <= maximum <= _MAX_PUBLICATION_OUTPUT
        or type(timeout) is not int
        or not 1 <= timeout <= _MAX_PUBLICATION_TIMEOUT
    ):
        raise StudyPublishError("GitHub publication config exceeds its capability ceiling")
    if _remote_identity(str(value["remote_url"])) != _IDENTITY:
        raise StudyPublishError("GitHub publication remote is invalid")
    for key in ("git_executable", "gh_executable"):
        executable = Path(str(value[key]))
        if (
            not executable.is_absolute() or executable.is_symlink()
            or not executable.is_file() or not os.access(executable, os.X_OK)
        ):
            raise StudyPublishError("publication executable identity is invalid")
    return MappingProxyType(dict(value))


def _load_bundle(
    root: os.PathLike[str] | str,
    expected_digest: str,
) -> tuple[str, dict[str, bytes]]:
    if not isinstance(expected_digest, str) or not _SHA256.fullmatch(expected_digest):
        raise StudyPublishError("expected bundle digest is invalid")
    _path, root_fd = _absolute_directory(root, "bundle root")
    studies_fd = study_fd = analysis_fd = None
    try:
        manifest = _strict_json(_read_beneath(root_fd, "manifest.json"))
        if set(manifest) != {
            "aggregate_digest", "analysis_ids", "artifacts", "chunk_evidence_ids",
            "chunk_ids", "config_digest", "decision_ids", "evidence_cutoff",
            "evidence_ledger_sha256", "qa_ids", "source_batch_digest", "source_ids",
            "source_record_ids", "target_contract_version", "tool_digest",
        }:
            raise StudyPublishError("bundle manifest fields are invalid")
        aggregate = manifest.get("aggregate_digest")
        if aggregate != expected_digest:
            raise StudyPublishError("bundle digest mismatch")
        body = dict(manifest)
        body.pop("aggregate_digest", None)
        if hashlib.sha256(_canonical(body)).hexdigest() != expected_digest:
            raise StudyPublishError("bundle aggregate is invalid")
        if manifest.get("target_contract_version") != "doc-analysis-study.v1":
            raise StudyPublishError("bundle target contract is invalid")
        artifacts = manifest.get("artifacts")
        if not isinstance(artifacts, list) or len(artifacts) != 6:
            raise StudyPublishError("bundle artifact ledger is invalid")
        ledger: dict[str, str] = {}
        for item in artifacts:
            if not isinstance(item, dict) or set(item) != {"path", "sha256"}:
                raise StudyPublishError("bundle artifact ledger is invalid")
            relative, digest = item["path"], item["sha256"]
            if (
                not isinstance(relative, str) or not isinstance(digest, str)
                or not _SHA256.fullmatch(digest) or relative in ledger
            ):
                raise StudyPublishError("bundle artifact ledger is invalid")
            ledger[relative] = digest
        study_paths = [path for path in ledger if path.startswith("studies/")]
        slugs = {Path(path).parts[1] for path in study_paths if len(Path(path).parts) >= 3}
        if len(slugs) != 1:
            raise StudyPublishError("bundle study identity is invalid")
        slug = next(iter(slugs))
        if not _SLUG.fullmatch(slug):
            raise StudyPublishError("bundle study identity is invalid")
        expected_paths = {
            "registry-row.md",
            f"studies/{slug}/README.md",
            f"studies/{slug}/progress.md",
            f"studies/{slug}/sources.md",
            f"studies/{slug}/analysis/overview.md",
            f"studies/{slug}/analysis/qa-review.md",
        }
        if set(ledger) != expected_paths:
            raise StudyPublishError("bundle artifact paths are invalid")
        studies_fd = os.open("studies", os.O_RDONLY | _DIRECTORY | _NOFOLLOW, dir_fd=root_fd)
        study_fd = os.open(slug, os.O_RDONLY | _DIRECTORY | _NOFOLLOW, dir_fd=studies_fd)
        analysis_fd = os.open("analysis", os.O_RDONLY | _DIRECTORY | _NOFOLLOW, dir_fd=study_fd)
        if (
            set(os.listdir(root_fd)) != {"manifest.json", "registry-row.md", "studies"}
            or set(os.listdir(studies_fd)) != {slug}
            or set(os.listdir(study_fd)) != {"README.md", "progress.md", "sources.md", "analysis"}
            or set(os.listdir(analysis_fd)) != {"overview.md", "qa-review.md"}
        ):
            raise StudyPublishError("bundle tree is not exact")
        result = {path: _read_beneath(root_fd, path) for path in sorted(ledger)}
        for relative, content in result.items():
            if hashlib.sha256(content).hexdigest() != ledger[relative]:
                raise StudyPublishError("bundle artifact hash mismatch")
            try:
                text = content.decode("utf-8")
            except UnicodeError as exc:
                raise StudyPublishError("bundle artifact is not UTF-8") from exc
            if (
                "\x00" in text or _SECRET.search(content)
                or re.search(r"(?:/home/|/tmp/|[A-Za-z]:\\\\)", text)
            ):
                raise StudyPublishError("bundle artifact violates publication policy")
        row = result["registry-row.md"]
        if row.count(b"\n") != 1 or f"studies/{slug}/README.md".encode() not in row:
            raise StudyPublishError("registry row is invalid")
        return slug, result
    except StudyPublishError:
        raise
    except OSError as exc:
        raise StudyPublishError("bundle tree is invalid") from exc
    finally:
        for descriptor in (analysis_fd, study_fd, studies_fd, root_fd):
            if descriptor is not None:
                os.close(descriptor)


def _git(
    executable: str,
    cwd: Path,
    arguments: Iterable[str],
    *,
    maximum: int = _MAX_GIT_OUTPUT,
) -> bytes:
    git = Path(executable)
    args = tuple(arguments)
    if (
        not git.is_absolute() or git.is_symlink() or not git.is_file()
        or not os.access(git, os.X_OK) or not args or args[0] not in _GIT_OPERATIONS
    ):
        raise StudyPublishError("Git invocation is not allowlisted")
    command = [
        str(git), "-c", "alias.publish=!false", "-c", "core.hooksPath=/dev/null",
        "-c", "credential.helper=", "-c", "commit.gpgSign=false",
        "-c", "tag.gpgSign=false", "-c", "core.pager=cat", "-c", "pager.diff=false",
        "-c", "diff.external=", "-c", "core.attributesfile=/dev/null",
        "-c", "core.autocrlf=false", *args,
    ]
    environment = {
        "PATH": "/usr/bin:/bin", "HOME": "/nonexistent", "LANG": "C", "LC_ALL": "C",
        "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_TERMINAL_PROMPT": "0", "GIT_PAGER": "cat", "GIT_OPTIONAL_LOCKS": "0",
        "GIT_NO_REPLACE_OBJECTS": "1", "GIT_PROTOCOL_FROM_USER": "0",
    }
    try:
        result = subprocess.run(
            command, cwd=cwd, env=environment, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise StudyPublishError("Git invocation failed") from exc
    if (
        result.returncode != 0 or len(result.stdout) > maximum
        or len(result.stderr) > maximum or result.stderr
    ):
        raise StudyPublishError("Git command was rejected")
    return result.stdout


def _publication_environment(*, github: bool, local_transport: bool) -> dict[str, str]:
    environment = {
        "PATH": "/usr/bin:/bin",
        "LANG": "C",
        "LC_ALL": "C",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_PAGER": "cat",
        "GIT_OPTIONAL_LOCKS": "0",
        "GIT_NO_REPLACE_OBJECTS": "1",
        "GIT_PROTOCOL_FROM_USER": "1" if local_transport else "0",
    }
    if github:
        home = os.environ.get("HOME", "")
        home_path = Path(home)
        if (
            not home or not os.path.isabs(home) or "\x00" in home
            or "\n" in home or home_path == Path(home_path.anchor)
        ):
            raise StudyPublishError("operator GitHub configuration is unavailable")
        try:
            home_info = home_path.lstat()
        except OSError as exc:
            raise StudyPublishError("operator GitHub configuration is unavailable") from exc
        if (
            not stat.S_ISDIR(home_info.st_mode) or stat.S_ISLNK(home_info.st_mode)
            or home_info.st_uid != os.getuid()
        ):
            raise StudyPublishError("operator GitHub configuration is unavailable")
        environment["HOME"] = home
    else:
        environment["HOME"] = "/nonexistent"
    socket_path = os.environ.get("SSH_AUTH_SOCK", "")
    if socket_path and not local_transport:
        try:
            socket_info = os.stat(socket_path, follow_symlinks=False)
        except OSError as exc:
            raise StudyPublishError("operator SSH agent is unavailable") from exc
        if (
            not os.path.isabs(socket_path) or "\x00" in socket_path
            or "\n" in socket_path or not stat.S_ISSOCK(socket_info.st_mode)
            or socket_info.st_uid != os.getuid()
        ):
            raise StudyPublishError("operator SSH agent is unavailable")
        environment["SSH_AUTH_SOCK"] = socket_path
    return environment


def _run_publication_command(
    executable: str,
    cwd: Path,
    arguments: Iterable[str],
    *,
    timeout: int,
    maximum: int,
    github: bool = False,
    local_transport: bool = False,
    allowed_exit: tuple[int, ...] = (0,),
    deterministic_commit: bool = False,
) -> tuple[int, bytes]:
    binary = Path(executable)
    args = tuple(arguments)
    if (
        not binary.is_absolute() or binary.is_symlink() or not binary.is_file()
        or not os.access(binary, os.X_OK) or not args
        or any(
            not isinstance(argument, str) or not argument
            or "\x00" in argument or "\n" in argument or len(argument) > 4096
            for argument in args
        )
    ):
        raise StudyPublishError("publication command is not allowlisted")
    environment = _publication_environment(
        github=github, local_transport=local_transport,
    )
    if deterministic_commit:
        environment.update({
            "GIT_AUTHOR_NAME": "Ice Maker Study Publisher",
            "GIT_AUTHOR_EMAIL": "ice-maker@invalid.local",
            "GIT_AUTHOR_DATE": "2000-01-01T00:00:00Z",
            "GIT_COMMITTER_NAME": "Ice Maker Study Publisher",
            "GIT_COMMITTER_EMAIL": "ice-maker@invalid.local",
            "GIT_COMMITTER_DATE": "2000-01-01T00:00:00Z",
        })
    try:
        result = subprocess.run(
            [str(binary), *args], cwd=cwd, env=environment,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=timeout, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise StudyPublishError("publication command failed") from exc
    if (
        result.returncode not in allowed_exit
        or len(result.stdout) > maximum or len(result.stderr) > maximum
        or _SECRET.search(result.stdout) or _SECRET.search(result.stderr)
    ):
        raise StudyPublishError("publication command was rejected")
    return result.returncode, result.stdout


def _publication_git(
    config: Mapping[str, object],
    cwd: Path,
    arguments: Iterable[str],
    *,
    local_transport: bool = False,
    allowed_exit: tuple[int, ...] = (0,),
    deterministic_commit: bool = False,
) -> tuple[int, bytes]:
    args = tuple(arguments)
    if not args or args[0] not in _GIT_OPERATIONS:
        raise StudyPublishError("Git publication operation is not allowlisted")
    fixed = (
        "-c", "alias.publish=!false",
        "-c", "core.hooksPath=/dev/null",
        "-c", "credential.helper=",
        "-c", "commit.gpgSign=false",
        "-c", "tag.gpgSign=false",
        "-c", "core.pager=cat",
        "-c", "pager.diff=false",
        "-c", "diff.external=",
        "-c", "core.attributesfile=/dev/null",
        "-c", "core.autocrlf=false",
        "-c", "protocol.file.allow=" + ("always" if local_transport else "never"),
    )
    return _run_publication_command(
        str(config["git_executable"]), cwd, (*fixed, *args),
        timeout=int(config["timeout_seconds"]),
        maximum=int(config["max_output_bytes"]),
        local_transport=local_transport,
        allowed_exit=allowed_exit,
        deterministic_commit=deterministic_commit,
    )


def _github_cli(
    config: Mapping[str, object],
    cwd: Path,
    arguments: Iterable[str],
) -> bytes:
    args = tuple(arguments)
    if (
        len(args) < 2 or args[0] != "pr"
        or args[1] not in {"create", "list", "view"}
    ):
        raise StudyPublishError("GitHub operation is not allowlisted")
    _status, output = _run_publication_command(
        str(config["gh_executable"]), cwd, args,
        timeout=int(config["timeout_seconds"]),
        maximum=int(config["max_output_bytes"]),
        github=True,
    )
    return output


def _remote_identity(value: str) -> str:
    match = re.fullmatch(
        r"(?:git@github\.com:|https://github\.com/)([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?/?",
        value.strip(),
    )
    if not match:
        raise StudyPublishError("target remote is not an allowlisted GitHub identity")
    return match.group(1)


def _target_contract_digest(base: Path, git: str, commit: str) -> str:
    verified = _git(git, base, ["rev-parse", "--verify", f"{commit}^{{commit}}"])
    if verified.decode().strip() != commit:
        raise StudyPublishError("base commit changed")
    records = []
    _path, root_fd = _absolute_directory(base, "base checkout")
    try:
        for relative in _TARGET_FILES:
            payload = _read_beneath(root_fd, relative, _MAX_FILE)
            records.append({
                "path": relative, "sha256": hashlib.sha256(payload).hexdigest(),
            })
    finally:
        os.close(root_fd)
    return hashlib.sha256(_canonical(records)).hexdigest()


def _preflight(
    base: Path,
    expected_repository: str,
    expected_commit: str,
    expected_contract: str,
    git: str,
) -> str:
    if expected_repository != _IDENTITY:
        raise StudyPublishError("repository identity is not allowlisted")
    if not _COMMIT.fullmatch(expected_commit) or not _SHA256.fullmatch(expected_contract):
        raise StudyPublishError("expected target identity is invalid")
    if base == Path.cwd().resolve():
        raise StudyPublishError("current working repository cannot be a publication base")
    git_dir = base / ".git"
    if not git_dir.is_dir() or git_dir.is_symlink():
        raise StudyPublishError("base checkout Git directory is unsafe")
    if _git(git, base, ["status", "--porcelain=v1", "--untracked-files=all"]):
        raise StudyPublishError("base checkout is dirty")
    head = _git(git, base, ["rev-parse", "HEAD"]).decode("ascii").strip()
    branch = _git(git, base, ["rev-parse", "--abbrev-ref", "HEAD"]).decode("ascii").strip()
    if head != expected_commit or branch != "HEAD":
        raise StudyPublishError("base checkout is not the expected detached commit")
    remote = _git(git, base, ["remote", "get-url", "origin"]).decode("utf-8").strip()
    if _remote_identity(remote) != expected_repository:
        raise StudyPublishError("target repository identity mismatch")
    if (base / ".gitmodules").exists() or _git(git, base, ["submodule", "status"]):
        raise StudyPublishError("submodules are not supported")
    worktrees = _git(git, base, ["worktree", "list", "--porcelain"]).decode("utf-8")
    records = [record for record in worktrees.strip().split("\n\n") if record]
    if len(records) != 1 or f"worktree {base}\n" not in records[0] + "\n" or "detached" not in records[0]:
        raise StudyPublishError("base checkout is not isolated")
    for relative in ("objects/info/alternates", "shallow"):
        if (git_dir / relative).exists():
            raise StudyPublishError("Git object boundary is unsafe")
    replace_root = git_dir / "refs/replace"
    if replace_root.exists() and any(replace_root.iterdir()):
        raise StudyPublishError("Git replace refs are forbidden")
    hooks = git_dir / "hooks"
    if hooks.is_symlink() or hooks.exists() and any(
        entry.is_symlink() or (entry.is_file() and not entry.name.endswith(".sample"))
        for entry in hooks.iterdir()
    ):
        raise StudyPublishError("custom Git hooks are forbidden")
    config = _git(git, base, ["config", "--local", "--null", "--list"])
    for record in config.split(b"\0"):
        key = record.split(b"\n", 1)[0].decode("utf-8", "strict").lower()
        if key.startswith((
            "filter.", "include.", "includeif.", "credential.", "url.", "http.",
            "core.sshcommand", "core.hookspath", "core.attributesfile",
            "diff.external", "commit.gpgsign", "tag.gpgsign",
        )):
            raise StudyPublishError("unsafe local Git configuration")
    actual_contract = _target_contract_digest(base, git, expected_commit)
    if actual_contract != expected_contract:
        raise StudyPublishError("target contract digest mismatch")
    return actual_contract


def target_contract_digest(
    base: os.PathLike[str] | str,
    expected_repository: str,
    expected_commit: str,
    *,
    git_executable: str = "/usr/bin/git",
) -> str:
    """Measure a clean isolated target contract before an explicit publish call."""
    base_path, descriptor = _absolute_directory(base, "base checkout")
    os.close(descriptor)
    measured = _target_contract_digest(base_path, git_executable, expected_commit)
    return _preflight(
        base_path, expected_repository, expected_commit, measured, git_executable,
    )


def _snapshot(base: Path, destination: Path, commit: str, git: str) -> None:
    _git(git, destination, ["init", "--quiet"])
    bundle = destination / ".base.bundle"
    _git(git, base, ["bundle", "create", str(bundle), "HEAD"])
    try:
        _git(git, destination, ["bundle", "unbundle", str(bundle)])
    finally:
        try:
            bundle.unlink()
        except FileNotFoundError:
            pass
    _git(git, destination, ["checkout", "--detach", "--quiet", commit])
    if _git(git, destination, ["rev-parse", "HEAD"]).decode().strip() != commit:
        raise StudyPublishError("isolated snapshot lost its base identity")
    file_count = total = 0
    for entry in destination.rglob("*"):
        if ".git" in entry.parts:
            continue
        info = entry.lstat()
        if entry.is_symlink() or not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
            raise StudyPublishError("target snapshot contains a special entry")
        if stat.S_ISREG(info.st_mode):
            file_count += 1
            total += info.st_size
            if info.st_nlink != 1 or file_count > 20_000 or total > 64 * 1024 * 1024:
                raise StudyPublishError("target snapshot exceeds publication bounds")


def _write(path: Path, content: bytes) -> None:
    descriptor = os.open(
        path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | _NOFOLLOW,
        0o600,
    )
    try:
        written = 0
        while written < len(content):
            count = os.write(descriptor, content[written:])
            if count <= 0:
                raise StudyPublishError("short publication write")
            written += count
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _allowed_paths(slug: str) -> tuple[str, ...]:
    return (
        "README.md",
        f"studies/{slug}/README.md",
        f"studies/{slug}/analysis/overview.md",
        f"studies/{slug}/analysis/qa-review.md",
        f"studies/{slug}/progress.md",
        f"studies/{slug}/sources.md",
    )


def _apply(snapshot: Path, slug: str, artifacts: Mapping[str, bytes]) -> tuple[str, ...]:
    studies = snapshot / "studies"
    studies.mkdir(mode=0o700, exist_ok=True)
    existing = [entry.name for entry in studies.iterdir() if entry.is_dir()]
    folded = {unicodedata.normalize("NFKC", name).casefold() for name in existing}
    if unicodedata.normalize("NFKC", slug).casefold() in folded:
        raise StudyPublishError("study slug collides with the target")
    study = studies / slug
    (study / "analysis").mkdir(parents=True, mode=0o700)
    for relative, content in artifacts.items():
        if relative != "registry-row.md":
            _write(snapshot / relative, content)
    readme = snapshot / "README.md"
    old = readme.read_bytes()
    row = artifacts["registry-row.md"]
    if f"studies/{slug}/README.md".encode() in old:
        raise StudyPublishError("root registry already contains the study")
    temporary = snapshot / ".README.md.study-publisher"
    _write(temporary, old + (b"" if old.endswith(b"\n") else b"\n") + row)
    os.replace(temporary, readme)
    return _allowed_paths(slug)


def _validate(snapshot: Path) -> None:
    script = snapshot / "scripts/validate_repository.py"
    try:
        result = subprocess.run(
            [sys.executable, "-I", str(script), str(snapshot)], cwd=snapshot,
            env={"PATH": "/usr/bin:/bin", "HOME": "/nonexistent", "LANG": "C", "LC_ALL": "C"},
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=30, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise StudyPublishError("target validator failed") from exc
    if (
        result.returncode or result.stderr or len(result.stdout) > _MAX_GIT_OUTPUT
        or not re.fullmatch(rb"VALIDATION PASSED: studies=\d+, markdown_files=\d+\n", result.stdout)
    ):
        raise StudyPublishError("target validator rejected publication")


def _changed(snapshot: Path, git: str, allowed: tuple[str, ...]) -> tuple[str, str]:
    status = _git(
        git, snapshot,
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )
    status_paths = []
    for record in status.split(b"\0"):
        if not record:
            continue
        if len(record) < 4 or record[2:3] != b" ":
            raise StudyPublishError("isolated status is malformed")
        try:
            status_paths.append(record[3:].decode("utf-8"))
        except UnicodeError as exc:
            raise StudyPublishError("isolated status path is invalid") from exc
    if tuple(sorted(status_paths)) != tuple(sorted(allowed)):
        raise StudyPublishError("isolated changes escaped their exact allowlist")
    _git(git, snapshot, ["add", "--", *allowed])
    _git(git, snapshot, ["diff", "--cached", "--check"])
    paths = tuple(sorted(
        _git(git, snapshot, ["diff", "--cached", "--name-only", "--no-ext-diff"])
        .decode("utf-8").splitlines()
    ))
    if paths != tuple(sorted(allowed)):
        raise StudyPublishError("isolated diff escaped its exact allowlist")
    for relative in paths:
        path = snapshot / relative
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o111 or info.st_nlink != 1:
            raise StudyPublishError("publication artifact mode is unsafe")
        payload = path.read_bytes()
        try:
            payload.decode("utf-8")
        except UnicodeError as exc:
            raise StudyPublishError("publication artifact is binary") from exc
        if b"\x00" in payload or _SECRET.search(payload):
            raise StudyPublishError("publication artifact violates content policy")
    diff_bytes = _git(
        git, snapshot, ["diff", "--cached", "--no-ext-diff", "--binary"],
        maximum=_MAX_DIFF,
    )
    try:
        diff = diff_bytes.decode("utf-8")
    except UnicodeError as exc:
        raise StudyPublishError("publication diff is not UTF-8") from exc
    return diff, hashlib.sha256(diff_bytes).hexdigest()


def _rename_noreplace(parent: int, source: str, destination: str) -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    call = getattr(libc, "renameat2", None)
    if call is None:
        raise StudyPublishError("atomic no-replace publication is unsupported")
    result = call(
        ctypes.c_int(parent), ctypes.c_char_p(os.fsencode(source)),
        ctypes.c_int(parent), ctypes.c_char_p(os.fsencode(destination)),
        ctypes.c_uint(_RENAME_NOREPLACE),
    )
    if result != 0:
        error = ctypes.get_errno()
        if error == 17:
            raise FileExistsError(error, "destination exists")
        raise OSError(error, os.strerror(error))


def _marker_path(snapshot: Path) -> Path:
    return snapshot / ".git/ice-maker-study.json"


def _result(
    operation: str, bundle: str, commit: str, contract: str,
    paths: tuple[str, ...], diff: str, digest: str,
) -> StudyPublishResult:
    return StudyPublishResult(operation, bundle, commit, contract, paths, digest, diff)


def _existing(
    destination: Path, bundle: str, commit: str, contract: str,
    repository: str, slug: str, artifacts: Mapping[str, bytes], git: str,
) -> StudyPublishResult:
    if not destination.is_dir() or destination.is_symlink():
        raise StudyPublishError("staging destination collision")
    destination_path, destination_fd = _absolute_directory(
        destination, "staging destination", private=True,
    )
    try:
        marker = _strict_json(
            _read_beneath(destination_fd, ".git/ice-maker-study.json")
        )
    except StudyPublishError as exc:
        raise StudyPublishError("staging destination collision") from exc
    finally:
        os.close(destination_fd)
    required = {
        "base_commit", "bundle_digest", "changed_paths", "diff_sha256",
        "repository", "target_contract_digest",
    }
    if set(marker) != required or any((
        marker.get("bundle_digest") != bundle,
        marker.get("base_commit") != commit,
        marker.get("target_contract_digest") != contract,
        marker.get("repository") != repository,
    )):
        raise StudyPublishError("staging destination collision")
    paths_value = marker.get("changed_paths")
    if not isinstance(paths_value, list) or any(not isinstance(path, str) for path in paths_value):
        raise StudyPublishError("staging evidence is invalid")
    paths = tuple(paths_value)
    if paths != _allowed_paths(slug):
        raise StudyPublishError("staging evidence path list is invalid")
    destination_path, destination_fd = _absolute_directory(
        destination, "staging destination", private=True,
    )
    try:
        for relative, expected in artifacts.items():
            if relative != "registry-row.md" and _read_beneath(
                destination_fd, relative,
            ) != expected:
                raise StudyPublishError("staging artifact changed")
        base_readme = _git(
            git, destination_path, ["show", f"{commit}:README.md"],
        )
        expected_readme = base_readme + (
            b"" if base_readme.endswith(b"\n") else b"\n"
        ) + artifacts["registry-row.md"]
        if _read_beneath(destination_fd, "README.md", _MAX_FILE) != expected_readme:
            raise StudyPublishError("staging registry changed")
    finally:
        os.close(destination_fd)
    if _git(git, destination_path, ["rev-parse", "HEAD"]).decode().strip() != commit:
        raise StudyPublishError("staging base identity changed")
    _validate(destination_path)
    diff, digest = _changed(destination_path, git, paths)
    if digest != marker.get("diff_sha256"):
        raise StudyPublishError("staging diff changed")
    return _result("apply", bundle, commit, contract, paths, diff, digest)


def publish_local(
    bundle_root: os.PathLike[str] | str,
    base: os.PathLike[str] | str,
    staging_root: os.PathLike[str] | str,
    expected_base: str,
    expected_contract: str,
    expected_bundle: str,
    expected_repository: str,
    *,
    apply: bool = False,
    git_executable: str = "/usr/bin/git",
) -> StudyPublishResult:
    """Preview or atomically retain an isolated, staged target checkout."""
    slug, artifacts = _load_bundle(bundle_root, expected_bundle)
    base_path, base_fd = _absolute_directory(base, "base checkout")
    state_path, state_fd = _absolute_directory(staging_root, "staging root", private=True)
    os.close(base_fd)
    try:
        contract = _preflight(
            base_path, expected_repository, expected_base, expected_contract,
            git_executable,
        )
        destination_name = "study-" + expected_bundle
        destination = state_path / destination_name
        try:
            os.stat(destination_name, dir_fd=state_fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            return _existing(
                destination, expected_bundle, expected_base, contract,
                expected_repository, slug, artifacts, git_executable,
            )
        stage_name = ".study-publisher-" + secrets.token_hex(16)
        temporary = Path(tempfile.mkdtemp(prefix=stage_name + "-", dir=state_path))
        try:
            _snapshot(base_path, temporary, expected_base, git_executable)
            _preflight(
                base_path, expected_repository, expected_base, expected_contract,
                git_executable,
            )
            allowed = _apply(temporary, slug, artifacts)
            _validate(temporary)
            diff, diff_digest = _changed(temporary, git_executable, allowed)
            result = _result(
                "apply" if apply else "preview", expected_bundle, expected_base,
                contract, allowed, diff, diff_digest,
            )
            if apply:
                marker = {
                    "base_commit": expected_base,
                    "bundle_digest": expected_bundle,
                    "changed_paths": list(allowed),
                    "diff_sha256": diff_digest,
                    "repository": expected_repository,
                    "target_contract_digest": contract,
                }
                _write(_marker_path(temporary), _canonical(marker))
                try:
                    _rename_noreplace(state_fd, temporary.name, destination_name)
                except FileExistsError:
                    raise StudyPublishError("staging destination collision") from None
                temporary = None
                os.fsync(state_fd)
            return result
        finally:
            if temporary is not None:
                shutil.rmtree(temporary, ignore_errors=True)
    finally:
        os.close(state_fd)


def _optional_marker(checkout: Path, name: str) -> dict[str, object] | None:
    checkout_path, descriptor = _absolute_directory(
        checkout, "validated staging checkout", private=True,
    )
    try:
        try:
            os.stat(".git/" + name, dir_fd=descriptor, follow_symlinks=False)
        except FileNotFoundError:
            return None
        return _strict_json_labeled(
            _read_beneath(descriptor, ".git/" + name, 128 * 1024),
            "publication evidence",
        )
    finally:
        os.close(descriptor)


def _write_git_evidence(checkout: Path, name: str, value: Mapping[str, object]) -> None:
    target = checkout / ".git" / name
    try:
        _write(target, _canonical(dict(value)))
    except FileExistsError as exc:
        raise StudyPublishError("publication evidence collision") from exc


def _tree_digest(checkout: Path, paths: tuple[str, ...]) -> str:
    _path, descriptor = _absolute_directory(
        checkout, "validated staging checkout", private=True,
    )
    try:
        records = [
            {
                "path": relative,
                "sha256": hashlib.sha256(
                    _read_beneath(descriptor, relative, _MAX_FILE)
                ).hexdigest(),
            }
            for relative in paths
        ]
    finally:
        os.close(descriptor)
    return hashlib.sha256(_canonical(records)).hexdigest()


def _staging_artifacts_match(
    checkout: Path,
    base_commit: str,
    artifacts: Mapping[str, bytes],
    git: str,
) -> None:
    checkout_path, descriptor = _absolute_directory(
        checkout, "validated staging checkout", private=True,
    )
    try:
        for relative, expected in artifacts.items():
            if relative != "registry-row.md" and _read_beneath(
                descriptor, relative,
            ) != expected:
                raise StudyPublishError("published study artifact changed")
        base_readme = _git(git, checkout_path, ["show", f"{base_commit}:README.md"])
        expected_readme = base_readme + (
            b"" if base_readme.endswith(b"\n") else b"\n"
        ) + artifacts["registry-row.md"]
        if _read_beneath(descriptor, "README.md", _MAX_FILE) != expected_readme:
            raise StudyPublishError("published study registry changed")
    finally:
        os.close(descriptor)


def _prepared_fields() -> set[str]:
    return {
        "base_commit", "branch", "bundle_digest", "changed_paths",
        "commit_sha", "diff_sha256", "repository", "target_contract_digest",
        "tree_sha256",
    }


def _validate_prepared(
    checkout: Path,
    marker: Mapping[str, object],
    *,
    slug: str,
    bundle: str,
    base: str,
    contract: str,
    repository: str,
    diff_digest: str,
    artifacts: Mapping[str, bytes],
    git: str,
) -> tuple[str, tuple[str, ...], str]:
    branch = f"study/{slug}-{bundle[:12]}"
    allowed = _allowed_paths(slug)
    if (
        set(marker) != _prepared_fields()
        or marker.get("base_commit") != base
        or marker.get("branch") != branch
        or marker.get("bundle_digest") != bundle
        or marker.get("changed_paths") != list(allowed)
        or marker.get("diff_sha256") != diff_digest
        or marker.get("repository") != repository
        or marker.get("target_contract_digest") != contract
        or not isinstance(marker.get("tree_sha256"), str)
        or not _SHA256.fullmatch(str(marker.get("tree_sha256")))
        or not isinstance(marker.get("commit_sha"), str)
        or not _COMMIT.fullmatch(str(marker.get("commit_sha")))
    ):
        raise StudyPublishError("prepared publication evidence is invalid")
    commit = str(marker["commit_sha"])
    head = _git(git, checkout, ["rev-parse", "HEAD"]).decode("ascii").strip()
    current = _git(
        git, checkout, ["rev-parse", "--abbrev-ref", "HEAD"],
    ).decode("ascii").strip()
    parent = _git(git, checkout, ["rev-parse", "HEAD^"]).decode("ascii").strip()
    if head != commit or current != branch or parent != base:
        raise StudyPublishError("prepared publication identity changed")
    if _git(git, checkout, ["status", "--porcelain=v1", "--untracked-files=all"]):
        raise StudyPublishError("prepared publication checkout is dirty")
    paths = tuple(
        _git(
            git, checkout,
            ["diff", "--name-only", "--no-ext-diff", base, commit],
        ).decode("utf-8").splitlines()
    )
    if paths != allowed:
        raise StudyPublishError("prepared publication paths changed")
    _git(git, checkout, ["diff", "--check", base, commit])
    diff = _git(
        git, checkout, ["diff", "--no-ext-diff", "--binary", base, commit],
        maximum=_MAX_DIFF,
    )
    if hashlib.sha256(diff).hexdigest() != diff_digest:
        raise StudyPublishError("prepared publication diff changed")
    expected_message = f"study: {slug} {bundle[:12]}"
    message = _git(git, checkout, ["show", "-s", "--format=%B", commit]).decode(
        "utf-8"
    )
    if message.strip("\n") != expected_message:
        raise StudyPublishError("prepared publication commit message changed")
    _staging_artifacts_match(checkout, base, artifacts, git)
    _validate(checkout)
    tree = _tree_digest(checkout, allowed)
    if tree != marker["tree_sha256"]:
        raise StudyPublishError("prepared publication tree changed")
    return commit, allowed, tree


def _remote_ref(
    config: Mapping[str, object],
    checkout: Path,
    transport: str,
    ref: str,
    *,
    local_transport: bool,
) -> str | None:
    status, output = _publication_git(
        config, checkout, ["ls-remote", "--refs", transport, ref],
        local_transport=local_transport, allowed_exit=(0, 2),
    )
    if status == 2 or not output:
        return None
    try:
        text = output.decode("ascii")
    except UnicodeError as exc:
        raise StudyPublishError("remote reference response is invalid") from exc
    match = re.fullmatch(r"([0-9a-f]{40})\t([^\n]+)\n", text)
    if not match or match.group(2) != ref:
        raise StudyPublishError("remote reference response is invalid")
    return match.group(1)


def _parse_github_json(data: bytes, *, sequence: bool) -> object:
    duplicate = False

    def pairs(items: list[tuple[str, object]]) -> dict[str, object]:
        nonlocal duplicate
        result: dict[str, object] = {}
        for key, value in items:
            duplicate = duplicate or key in result
            result[key] = value
        return result

    try:
        value = json.loads(data.decode("utf-8"), object_pairs_hook=pairs)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise StudyPublishError("GitHub response is invalid") from exc
    if duplicate or (sequence and not isinstance(value, list)) or (
        not sequence and not isinstance(value, dict)
    ):
        raise StudyPublishError("GitHub response is invalid")
    return value


def _validated_pr(
    value: object,
    *,
    branch: str,
    base: str,
    commit: str,
    repository: str,
) -> tuple[int, str]:
    fields = {
        "baseRefName", "headRefName", "headRefOid", "isDraft", "number",
        "state", "url",
    }
    if not isinstance(value, dict) or set(value) != fields:
        raise StudyPublishError("GitHub pull request evidence is invalid")
    number = value.get("number")
    url = value.get("url")
    expected_url = (
        f"https://github.com/{repository}/pull/{number}"
        if type(number) is int and number > 0
        else ""
    )
    if (
        value.get("baseRefName") != base
        or value.get("headRefName") != branch
        or value.get("headRefOid") != commit
        or value.get("isDraft") is not True
        or value.get("state") != "OPEN"
        or not isinstance(url, str) or url != expected_url
    ):
        raise StudyPublishError("GitHub pull request evidence is invalid")
    return number, url


def _github_pr(
    config: Mapping[str, object],
    checkout: Path,
    branch: str,
    commit: str,
    bundle: str,
) -> tuple[int, str, str]:
    repository = str(config["remote_repository"])
    base = str(config["base_branch"])
    fields = "baseRefName,headRefName,headRefOid,isDraft,number,state,url"
    listed = _parse_github_json(
        _github_cli(
            config, checkout,
            [
                "pr", "list", "--repo", repository, "--head", branch,
                "--base", base, "--state", "all", "--limit", "2",
                "--json", fields,
            ],
        ),
        sequence=True,
    )
    if len(listed) > 1:
        raise StudyPublishError("GitHub pull request collision")
    operation = "pr:0"
    if not listed:
        title = f"Study: {branch.removeprefix('study/')}"
        body = f"Ice Maker approved bundle `{bundle}`. Merge remains manual."
        created = _github_cli(
            config, checkout,
            [
                "pr", "create", "--draft", "--repo", repository,
                "--base", base, "--head", branch, "--title", title,
                "--body", body,
            ],
        )
        try:
            created_url = created.decode("utf-8").strip()
        except UnicodeError as exc:
            raise StudyPublishError("GitHub pull request response is invalid") from exc
        if not re.fullmatch(
            rf"https://github\.com/{re.escape(repository)}/pull/[1-9][0-9]*",
            created_url,
        ):
            raise StudyPublishError("GitHub pull request response is invalid")
    viewed = _parse_github_json(
        _github_cli(
            config, checkout,
            ["pr", "view", branch, "--repo", repository, "--json", fields],
        ),
        sequence=False,
    )
    number, url = _validated_pr(
        viewed, branch=branch, base=base, commit=commit, repository=repository,
    )
    return number, url, operation


def _github_result(
    operation: str,
    config: Mapping[str, object],
    branch: str,
    bundle: str,
    base: str,
    diff_digest: str,
    paths: tuple[str, ...],
    tree: str,
    *,
    commit: str | None = None,
    pushed: str | None = None,
    pr_number: int | None = None,
    pr_url: str | None = None,
    draft: bool | None = None,
    commands: tuple[str, ...] = (),
) -> StudyGithubResult:
    return StudyGithubResult(
        operation, str(config["remote_repository"]), str(config["remote_url"]),
        str(config["base_branch"]), branch, bundle, base, diff_digest, paths,
        tree, commit, pushed, pr_number, pr_url, draft, commands,
    )


def _validate_final_marker_local(
    marker: Mapping[str, object],
    config: Mapping[str, object],
    *,
    branch: str,
    bundle: str,
    base: str,
    diff_digest: str,
    paths: tuple[str, ...],
    tree: str,
    commit: str,
) -> None:
    fields = {
        "base_branch", "base_commit", "branch", "bundle_digest",
        "changed_paths", "command_exit_classes", "commit_sha", "diff_sha256",
        "draft", "pr_number", "pr_url", "pushed_sha", "remote_repository",
        "remote_url", "tree_sha256",
    }
    number = marker.get("pr_number")
    expected_url = (
        f"https://github.com/{config['remote_repository']}/pull/{number}"
        if type(number) is int and number > 0
        else ""
    )
    if (
        set(marker) != fields
        or marker.get("base_branch") != config["base_branch"]
        or marker.get("base_commit") != base
        or marker.get("branch") != branch
        or marker.get("bundle_digest") != bundle
        or marker.get("changed_paths") != list(paths)
        or marker.get("command_exit_classes")
        != ["fetch:0", "push:0", "pr:0", "pr-view:0"]
        or marker.get("commit_sha") != commit
        or marker.get("diff_sha256") != diff_digest
        or marker.get("draft") is not True
        or marker.get("pr_url") != expected_url
        or marker.get("pushed_sha") != commit
        or marker.get("remote_repository") != config["remote_repository"]
        or marker.get("remote_url") != config["remote_url"]
        or marker.get("tree_sha256") != tree
    ):
        raise StudyPublishError("final publication evidence is invalid")


def publish_github(
    staging_checkout: os.PathLike[str] | str,
    bundle_root: os.PathLike[str] | str,
    expected_base: str,
    expected_contract: str,
    expected_bundle: str,
    *,
    publish: bool = False,
    config_path: os.PathLike[str] | str | None = None,
    _test_transport: os.PathLike[str] | str | None = None,
) -> StudyGithubResult:
    """Dry-run or explicitly publish one T-036 checkout as a draft PR."""
    config = load_github_publication_config(config_path)
    slug, artifacts = _load_bundle(bundle_root, expected_bundle)
    if (
        not _COMMIT.fullmatch(expected_base)
        or not _SHA256.fullmatch(expected_contract)
    ):
        raise StudyPublishError("expected publication identity is invalid")
    checkout, descriptor = _absolute_directory(
        staging_checkout, "validated staging checkout", private=True,
    )
    os.close(descriptor)
    branch = f"{config['branch_prefix']}{slug}-{expected_bundle[:12]}"
    if not _PUBLICATION_BRANCH.fullmatch(branch):
        raise StudyPublishError("publication branch is invalid")
    final_marker = _optional_marker(checkout, "ice-maker-github.json")
    prepared_marker = _optional_marker(checkout, "ice-maker-github-prepared.json")
    t036_marker = _optional_marker(checkout, "ice-maker-study.json")
    if t036_marker is None:
        raise StudyPublishError("validated local publication evidence is missing")
    required_local = {
        "base_commit", "bundle_digest", "changed_paths", "diff_sha256",
        "repository", "target_contract_digest",
    }
    if (
        set(t036_marker) != required_local
        or t036_marker.get("base_commit") != expected_base
        or t036_marker.get("bundle_digest") != expected_bundle
        or t036_marker.get("target_contract_digest") != expected_contract
        or t036_marker.get("repository") != config["remote_repository"]
        or t036_marker.get("changed_paths") != list(_allowed_paths(slug))
        or not isinstance(t036_marker.get("diff_sha256"), str)
        or not _SHA256.fullmatch(str(t036_marker.get("diff_sha256")))
    ):
        raise StudyPublishError("validated local publication evidence is invalid")
    diff_digest = str(t036_marker["diff_sha256"])
    allowed = _allowed_paths(slug)
    commit = None
    if prepared_marker is None:
        if final_marker is not None:
            raise StudyPublishError("final publication evidence is partial")
        local_result = _existing(
            checkout, expected_bundle, expected_base, expected_contract,
            str(config["remote_repository"]), slug, artifacts,
            str(config["git_executable"]),
        )
        if local_result.diff_sha256 != diff_digest:
            raise StudyPublishError("validated local publication diff changed")
        tree = _tree_digest(checkout, allowed)
    else:
        commit, allowed, tree = _validate_prepared(
            checkout, prepared_marker, slug=slug, bundle=expected_bundle,
            base=expected_base, contract=expected_contract,
            repository=str(config["remote_repository"]),
            diff_digest=diff_digest, artifacts=artifacts,
            git=str(config["git_executable"]),
        )
        if final_marker is not None:
            _validate_final_marker_local(
                final_marker, config, branch=branch, bundle=expected_bundle,
                base=expected_base, diff_digest=diff_digest, paths=allowed,
                tree=tree, commit=commit,
            )
    if not publish:
        return _github_result(
            "dry-run", config, branch, expected_bundle, expected_base,
            diff_digest, allowed, tree, commit=commit,
        )

    if _test_transport is None:
        transport = str(config["remote_url"])
        local_transport = False
    else:
        raw_transport = os.fspath(_test_transport)
        path = Path(raw_transport) if isinstance(raw_transport, str) else Path("")
        if (
            not isinstance(raw_transport, str) or not path.is_absolute()
            or path.as_posix() != raw_transport or path.is_symlink()
            or not path.is_dir() or path.stat().st_uid != os.getuid()
        ):
            raise StudyPublishError("test remote transport is invalid")
        transport = raw_transport
        local_transport = True

    _publication_git(
        config, checkout,
        [
            "fetch", "--no-tags", "--no-recurse-submodules", transport,
            f"refs/heads/{config['base_branch']}:refs/remotes/ice-maker/{config['base_branch']}",
        ],
        local_transport=local_transport,
    )
    fetched = _git(
        str(config["git_executable"]), checkout,
        ["rev-parse", f"refs/remotes/ice-maker/{config['base_branch']}"],
    ).decode("ascii").strip()
    if fetched != expected_base:
        raise StudyPublishError("remote base is stale or diverged")
    if commit is None:
        _publication_git(
            config, checkout, ["checkout", "-b", branch],
            local_transport=local_transport,
        )
        _publication_git(
            config, checkout,
            [
                "commit", "--quiet", "--no-verify", "--no-gpg-sign",
                "-m", f"study: {slug} {expected_bundle[:12]}",
            ],
            local_transport=local_transport, deterministic_commit=True,
        )
        commit = _git(
            str(config["git_executable"]), checkout, ["rev-parse", "HEAD"],
        ).decode("ascii").strip()
        if not _COMMIT.fullmatch(commit):
            raise StudyPublishError("publication commit identity is invalid")
        prepared_marker = {
            "base_commit": expected_base,
            "branch": branch,
            "bundle_digest": expected_bundle,
            "changed_paths": list(allowed),
            "commit_sha": commit,
            "diff_sha256": diff_digest,
            "repository": config["remote_repository"],
            "target_contract_digest": expected_contract,
            "tree_sha256": tree,
        }
        _write_git_evidence(
            checkout, "ice-maker-github-prepared.json", prepared_marker,
        )
        _validate_prepared(
            checkout, prepared_marker, slug=slug, bundle=expected_bundle,
            base=expected_base, contract=expected_contract,
            repository=str(config["remote_repository"]),
            diff_digest=diff_digest, artifacts=artifacts,
            git=str(config["git_executable"]),
        )

    remote_main = _remote_ref(
        config, checkout, transport,
        f"refs/heads/{config['base_branch']}",
        local_transport=local_transport,
    )
    if remote_main != expected_base:
        raise StudyPublishError("remote base changed before push")
    remote_branch = _remote_ref(
        config, checkout, transport, f"refs/heads/{branch}",
        local_transport=local_transport,
    )
    if remote_branch is not None and remote_branch != commit:
        raise StudyPublishError("remote publication branch collision")
    if remote_branch is None:
        _publication_git(
            config, checkout,
            [
                "push", "--porcelain", "--no-verify", transport,
                f"refs/heads/{branch}:refs/heads/{branch}",
            ],
            local_transport=local_transport,
        )
    pushed = _remote_ref(
        config, checkout, transport, f"refs/heads/{branch}",
        local_transport=local_transport,
    )
    if pushed != commit:
        raise StudyPublishError("remote publication identity mismatch")
    number, url, pr_operation = _github_pr(
        config, checkout, branch, commit, expected_bundle,
    )
    commands = ("fetch:0", "push:0", pr_operation, "pr-view:0")
    evidence = {
        "base_branch": config["base_branch"],
        "base_commit": expected_base,
        "branch": branch,
        "bundle_digest": expected_bundle,
        "changed_paths": list(allowed),
        "command_exit_classes": list(commands),
        "commit_sha": commit,
        "diff_sha256": diff_digest,
        "draft": True,
        "pr_number": number,
        "pr_url": url,
        "pushed_sha": pushed,
        "remote_repository": config["remote_repository"],
        "remote_url": config["remote_url"],
        "tree_sha256": tree,
    }
    if final_marker is None:
        _write_git_evidence(checkout, "ice-maker-github.json", evidence)
        operation = "publish"
    elif final_marker != evidence:
        raise StudyPublishError("final publication evidence changed")
    else:
        operation = "reuse"
    return _github_result(
        operation, config, branch, expected_bundle, expected_base, diff_digest,
        allowed, tree, commit=commit, pushed=pushed, pr_number=number,
        pr_url=url, draft=True, commands=commands,
    )
