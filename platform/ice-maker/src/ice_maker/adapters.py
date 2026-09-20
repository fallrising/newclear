"""Governed local provider adapters."""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import re
import stat
import uuid

from .execution import CommandEvidence, ContractError, ExecutionLimits, TaskContract, execute_argv


_MODEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$")
_SENSITIVE = re.compile(
    r"(?i)(?:bearer\s+[A-Za-z0-9._~+/-]{8,}|"
    r"(?:api[_-]?key|token|password|secret|authorization)\s*[:=]|"
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----|"
    r"(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}))"
)
_CODEX_VERSION = re.compile(r"^codex-cli\s+[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9._-]+)?$")
_OPENCODE_VERSION = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9._-]+)?$")
_REVIEW_VERSIONS = {
    "claude": re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+ \(Claude Code\)$"),
    "grok": re.compile(r"^grok\s+[0-9]+\.[0-9]+\.[0-9]+ \([0-9a-f]+\) \[stable\]$"),
}
_MAX_REVIEW_ARTIFACT_BYTES = 65536


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
        or _SENSITIVE.search(str(path)) is not None
    )


def _valid_cli_path(value: object) -> bool:
    return (
        isinstance(value, str)
        and bool(value)
        and not any(ord(character) < 32 for character in value)
        and _SENSITIVE.search(value) is None
    )


def _doctor(evidence: CommandEvidence, version: re.Pattern[str], provider: str) -> CommandEvidence:
    lines = tuple(line.strip() for line in evidence.output.splitlines() if line.strip())
    if (
        evidence.exit_code != 0
        or evidence.timed_out
        or evidence.truncated
        or len(lines) != 1
        or version.fullmatch(lines[0]) is None
    ):
        raise ContractError(f"{provider} doctor did not return a valid version")
    return evidence


def _publish_stdout(evidence: CommandEvidence, output: Path, *, provider: str) -> None:
    """Write bounded evidence privately, then publish one new name atomically."""
    if (
        evidence.exit_code != 0
        or evidence.timed_out
        or evidence.truncated
        or evidence.output == "[no output]"
        or "[REDACTED]" in evidence.output
    ):
        raise ContractError(f"{provider} result output is unsafe")
    payload = evidence.output.encode("utf-8")
    if not payload:
        raise ContractError(f"{provider} result output is unsafe")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        parent_fd = os.open(output.parent, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
    except OSError as exc:
        raise ContractError(f"{provider} result path is unsafe") from exc
    temporary_name = f".{output.name}.{uuid.uuid4().hex}.tmp"
    descriptor = -1
    temporary_exists = False
    try:
        descriptor = os.open(temporary_name, flags, 0o600, dir_fd=parent_fd)
        temporary_exists = True
        offset = 0
        while offset < len(payload):
            written = os.write(descriptor, payload[offset:])
            if written <= 0:
                raise OSError("short result write")
            offset += written
        os.fsync(descriptor)
        temporary_status = os.fstat(descriptor)
        if not stat.S_ISREG(temporary_status.st_mode) or temporary_status.st_nlink != 1:
            raise OSError("unsafe temporary result")
        os.close(descriptor)
        descriptor = -1
        os.link(
            temporary_name,
            output.name,
            src_dir_fd=parent_fd,
            dst_dir_fd=parent_fd,
            follow_symlinks=False,
        )
        os.unlink(temporary_name, dir_fd=parent_fd)
        temporary_exists = False
        published_status = os.stat(output.name, dir_fd=parent_fd, follow_symlinks=False)
        if (
            not stat.S_ISREG(published_status.st_mode)
            or published_status.st_ino != temporary_status.st_ino
            or published_status.st_dev != temporary_status.st_dev
            or published_status.st_nlink != 1
        ):
            raise OSError("unsafe published result")
        os.fsync(parent_fd)
    except OSError as exc:
        raise ContractError(f"{provider} result could not be published safely") from exc
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if temporary_exists:
            try:
                os.unlink(temporary_name, dir_fd=parent_fd)
            except OSError:
                pass
        os.close(parent_fd)


@dataclass(frozen=True)
class CodexAdapter:
    """Non-interactive Codex invocation using a configured, checked model ID."""

    alias: str
    model_id: str
    codex_path: str = "codex"

    def __post_init__(self) -> None:
        if (
            self.alias != "builder_primary"
            or not isinstance(self.model_id, str)
            or not _MODEL.fullmatch(self.model_id)
            or _SENSITIVE.search(self.model_id)
            or not _valid_cli_path(self.codex_path)
        ):
            raise ContractError("invalid configured Codex adapter")

    def doctor(self, limits: ExecutionLimits, *, configured_model_id: str) -> CommandEvidence:
        """Run the bounded local CLI doctor after checking the selected alias value."""
        if configured_model_id != self.model_id:
            raise ContractError("configured Codex model does not match the adapter")
        evidence = execute_argv((self.codex_path, "--version"), limits)
        return _doctor(evidence, _CODEX_VERSION, "Codex")

    @staticmethod
    def _paths(workspace: Path, output_file: Path) -> tuple[Path, Path]:
        if _unsafe_path_syntax(workspace) or _unsafe_path_syntax(output_file):
            raise ContractError("adapter paths escape the governed workspace")
        workspace_input = workspace.absolute()
        output_input = output_file.absolute()
        if (
            _has_symlink_component(workspace_input)
            or _has_symlink_component(output_input.parent)
            or output_input.is_symlink()
            or any(character in str(output_input) for character in ("\n", "\r", "\x00"))
        ):
            raise ContractError("adapter paths escape the governed workspace")
        try:
            canonical_workspace = workspace_input.resolve(strict=True)
            canonical_parent = output_input.parent.resolve(strict=True)
        except OSError as exc:
            raise ContractError("adapter paths are unavailable") from exc
        if not canonical_parent.is_dir():
            raise ContractError("adapter paths escape the governed workspace")
        canonical_output = (canonical_parent / output_input.name).resolve(strict=False)
        git_file = canonical_workspace / ".git"
        if (
            not canonical_workspace.is_dir()
            or not git_file.is_file()
            or git_file.is_symlink()
            or canonical_output.exists()
            or canonical_output.is_symlink()
        ):
            raise ContractError("adapter paths escape the governed workspace")
        try:
            canonical_output.relative_to(canonical_workspace)
        except ValueError:
            raise ContractError("adapter paths escape the governed workspace") from None
        return canonical_workspace, canonical_output

    def build_argv(self, contract: TaskContract, workspace: Path, output_file: Path, prompt: str) -> tuple[str, ...]:
        if not isinstance(contract, TaskContract) or contract.provider != "codex":
            raise ContractError("adapter requires a governed Codex contract")
        if (
            not isinstance(prompt, str)
            or not prompt.strip()
            or len(prompt) > 10000
            or "\x00" in prompt
            or _SENSITIVE.search(prompt)
        ):
            raise ContractError("adapter prompt is unsafe")
        canonical_workspace, canonical_output = self._paths(workspace, output_file)
        return (
            self.codex_path, "exec", "-m", self.model_id, "-s", "workspace-write",
            "-C", str(canonical_workspace), "-o", str(canonical_output), prompt,
        )

    def invoke(self, contract: TaskContract, workspace: Path, output_file: Path, prompt: str,
               limits: ExecutionLimits, *, configured_model_id: str) -> CommandEvidence:
        """Invoke the constructed argv through the bounded execution core."""
        self.doctor(limits, configured_model_id=configured_model_id)
        canonical_workspace, canonical_output = self._paths(workspace, output_file)
        evidence = execute_argv(
            self.build_argv(contract, canonical_workspace, canonical_output, prompt),
            limits,
        )
        if evidence.exit_code == 0 and (
            not canonical_output.is_file()
            or canonical_output.is_symlink()
            or _has_symlink_component(canonical_output)
        ):
            raise ContractError("Codex result file is missing or unsafe")
        return evidence


@dataclass(frozen=True)
class OpenCodeAdapter:
    """Non-interactive OpenCode builder invocation with governed result evidence."""

    alias: str
    model_id: str
    opencode_path: str = "opencode"
    provider: str = "deepseek"

    def __post_init__(self) -> None:
        if (
            self.alias != "builder_economy"
            or self.provider != "deepseek"
            or not isinstance(self.model_id, str)
            or not _MODEL.fullmatch(self.model_id)
            or _SENSITIVE.search(self.model_id)
            or not _valid_cli_path(self.opencode_path)
        ):
            raise ContractError("invalid configured OpenCode adapter")

    def doctor(self, limits: ExecutionLimits, *, configured_model_id: str) -> CommandEvidence:
        if configured_model_id != self.model_id:
            raise ContractError("configured OpenCode model does not match the adapter")
        return _doctor(execute_argv((self.opencode_path, "--version"), limits), _OPENCODE_VERSION, "OpenCode")

    def build_argv(self, contract: TaskContract, workspace: Path, output_file: Path, prompt: str) -> tuple[str, ...]:
        if not isinstance(contract, TaskContract) or contract.provider != self.provider:
            raise ContractError("adapter requires a governed OpenCode contract")
        if (
            not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 10000
            or "\x00" in prompt or _SENSITIVE.search(prompt)
        ):
            raise ContractError("adapter prompt is unsafe")
        canonical_workspace, canonical_output = CodexAdapter._paths(workspace, output_file)
        return (
            self.opencode_path, "run", "--pure", "-m", self.model_id, "--format", "json",
            "--dir", str(canonical_workspace), prompt,
        )

    def invoke(self, contract: TaskContract, workspace: Path, output_file: Path, prompt: str,
               limits: ExecutionLimits, *, configured_model_id: str) -> CommandEvidence:
        self.doctor(limits, configured_model_id=configured_model_id)
        canonical_workspace, canonical_output = CodexAdapter._paths(workspace, output_file)
        evidence = execute_argv(self.build_argv(contract, canonical_workspace, canonical_output, prompt), limits)
        _publish_stdout(evidence, canonical_output, provider="OpenCode")
        return evidence


@dataclass(frozen=True)
class ClaudeGrokReviewAdapter:
    """Read-only review adapter consuming one bounded artifact, never a workspace."""

    provider: str
    alias: str
    model_id: str
    cli_path: str

    def __post_init__(self) -> None:
        expected_alias = {"claude": "reviewer_claude", "grok": "critic_independent"}.get(self.provider)
        if (
            self.provider not in _REVIEW_VERSIONS or self.alias != expected_alias
            or not isinstance(self.model_id, str) or not _MODEL.fullmatch(self.model_id)
            or _SENSITIVE.search(self.model_id) or not _valid_cli_path(self.cli_path)
        ):
            raise ContractError("invalid configured review adapter")

    def doctor(self, limits: ExecutionLimits, *, configured_model_id: str) -> CommandEvidence:
        if configured_model_id != self.model_id:
            raise ContractError("configured review model does not match the adapter")
        return _doctor(execute_argv((self.cli_path, "--version"), limits), _REVIEW_VERSIONS[self.provider], self.provider)

    @staticmethod
    def _artifact_paths(input_file: Path, output_file: Path) -> tuple[Path, Path, str]:
        if _unsafe_path_syntax(input_file) or _unsafe_path_syntax(output_file):
            raise ContractError("review artifact paths are unsafe")
        source, output = input_file.absolute(), output_file.absolute()
        if (
            _has_symlink_component(source) or _has_symlink_component(output.parent)
            or source.is_symlink() or output.is_symlink()
        ):
            raise ContractError("review artifact paths are unsafe")
        try:
            canonical_source = source.resolve(strict=True)
            canonical_parent = output.parent.resolve(strict=True)
        except OSError as exc:
            raise ContractError("review artifact paths are unavailable") from exc
        canonical_output = (canonical_parent / output.name).resolve(strict=False)
        if (
            not canonical_source.is_file() or canonical_source.is_symlink()
            or canonical_output.exists() or canonical_output.is_symlink()
            or canonical_source.parent != canonical_parent
        ):
            raise ContractError("review artifacts must be a new sibling result and regular input")
        try:
            payload = canonical_source.read_bytes()
            text = payload.decode("utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            raise ContractError("review input artifact is unreadable") from exc
        if not payload or len(payload) > _MAX_REVIEW_ARTIFACT_BYTES or _SENSITIVE.search(text):
            raise ContractError("review input artifact is unsafe")
        return canonical_source, canonical_output, text

    def build_argv(self, contract: TaskContract, input_file: Path, output_file: Path) -> tuple[str, ...]:
        if not isinstance(contract, TaskContract) or contract.provider != self.provider:
            raise ContractError("adapter requires a matching governed review contract")
        _, output, text = self._artifact_paths(input_file, output_file)
        prompt = "Review this bounded artifact and return JSON only:\n" + text
        if self.provider == "claude":
            return (
                self.cli_path, "-p", prompt, "--model", self.model_id,
                "--permission-mode", "plan", "--permission-prompts", "none", "--tools=",
                "--safe-mode", "--no-session-persistence", "--output-format", "json",
            )
        return (
            self.cli_path, "--single", prompt, "--model", self.model_id, "--output-format", "json",
            "--disable-web-search", "--no-subagents", "--permission-mode", "plan", "--tools=",
        )

    def invoke(self, contract: TaskContract, input_file: Path, output_file: Path, limits: ExecutionLimits,
               *, configured_model_id: str) -> CommandEvidence:
        self.doctor(limits, configured_model_id=configured_model_id)
        source, output, _ = self._artifact_paths(input_file, output_file)
        evidence = execute_argv(self.build_argv(contract, source, output), limits)
        _publish_stdout(evidence, output, provider=self.provider)
        return evidence
