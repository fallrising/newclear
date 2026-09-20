"""Dependency-free parser and validator for the governed SDD format."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from typing import Any, Mapping


@dataclass(frozen=True)
class ValidationIssue:
    code: str
    message: str
    path: str = ""
    line: int | None = None

    def __str__(self) -> str:
        location = f"{self.path}:{self.line}: " if self.line else (f"{self.path}: " if self.path else "")
        return f"{location}{self.code}: {self.message}"


@dataclass(frozen=True)
class ValidationResult:
    valid: bool
    issues: tuple[ValidationIssue, ...] = ()
    data: Mapping[str, Any] | None = None

    @property
    def errors(self) -> tuple[ValidationIssue, ...]:
        return self.issues


_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_ID = re.compile(r"^(?:SDD-[0-9]{4}|SDD-FULL-BUILD)$")
_TASK = re.compile(r"^T-[0-9]{3}$")
_REQUIRED = ("id", "title", "status", "owner", "risk", "data_class", "budget_usd", "allowed_paths", "forbidden_paths")
_ENUMS = {
    "status": {"draft", "approved", "active", "blocked", "complete", "archived"},
    "risk": {"low", "medium", "high", "critical"},
    "data_class": {"public", "internal", "confidential", "restricted"},
}
_HEADINGS = ("Context", "Goals", "Non-goals", "User stories", "Functional requirements", "Non-functional requirements", "Acceptance criteria", "Failure modes", "Open questions")


def _strip_comment(value: str) -> str:
    quote = None
    for index, char in enumerate(value):
        if char in "'\"":
            quote = None if quote == char else (char if quote is None else quote)
        elif char == "#" and quote is None and (index == 0 or value[index - 1].isspace()):
            return value[:index].rstrip()
    return value.strip()


def _scalar(value: str) -> Any:
    value = _strip_comment(value)
    if not value:
        return None
    if value[0] in "'\"":
        if len(value) < 2 or value[-1] != value[0]:
            raise ValueError("unsupported syntax: unterminated quoted value")
        inner = value[1:-1]
        if value[0] == '"' and "\\" in inner:
            raise ValueError("unsupported syntax: escape sequences are not supported")
        return inner
    if any(token in value for token in ("{", "}", "[", "]", "&", "!", "|")):
        raise ValueError("unsupported syntax in value")
    if re.fullmatch(r"[0-9]+", value):
        return int(value)
    if re.fullmatch(r"[0-9]+\.[0-9]+", value):
        return float(value)
    if value in {"true", "false"}:
        return value == "true"
    if value in {"null", "~"}:
        return None
    if value.startswith(("-", "+")) or ": " in value:
        raise ValueError("unsupported scalar syntax")
    return value


def parse_front_matter(text: str) -> dict[str, Any]:
    """Parse the deliberately small YAML subset used by ``spec.md``.

    A ``ValueError`` is raised with deterministic text for malformed input.
    The returned dictionary is newly allocated and does not expose parser state.
    """
    if not isinstance(text, str):
        raise TypeError("front matter must be text")
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise ValueError("missing front matter opening delimiter")
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        raise ValueError("missing front matter closing delimiter")
    result: dict[str, Any] = {}
    current: str | None = None
    for number, raw in enumerate(lines[1:end], 2):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if "\t" in raw:
            raise ValueError(f"line {number}: tabs are not supported")
        indent = len(raw) - len(raw.lstrip(" "))
        content = raw.strip()
        if indent and not content.startswith("-"):
            raise ValueError(f"line {number}: unsupported indentation")
        if content.startswith("-"):
            if indent != 2 or current is None or not isinstance(result.get(current), list):
                raise ValueError(f"line {number}: unsupported list syntax")
            item = content[1:].strip()
            if not item:
                raise ValueError(f"line {number}: empty list item")
            result[current].append(_scalar(item))
            continue
        if ":" not in content:
            raise ValueError(f"line {number}: expected key/value")
        key, raw_value = content.split(":", 1)
        key = key.strip()
        if not _KEY.fullmatch(key):
            raise ValueError(f"line {number}: invalid key '{key}'")
        if key in result:
            raise ValueError(f"line {number}: duplicate key '{key}'")
        value = _strip_comment(raw_value)
        if value == "":
            result[key] = []
            current = key
        else:
            result[key] = _scalar(value)
            current = None
    return result


def _source(value: str | Path) -> tuple[str, str, Path | None]:
    if isinstance(value, Path):
        if value.is_dir():
            return "", str(value), value
        if not value.is_file():
            raise FileNotFoundError(value)
        return value.read_text(encoding="utf-8"), str(value), value
    if isinstance(value, str):
        return value, "<input>", None
    raise TypeError("SDD input must be text or a path")


def _issue(code: str, message: str, path: str = "") -> ValidationIssue:
    return ValidationIssue(code, message, path)


def _validate_spec(text: str, path: str) -> tuple[list[ValidationIssue], dict[str, Any] | None]:
    try:
        fields = parse_front_matter(text)
    except (TypeError, ValueError) as exc:
        return [_issue("front_matter.invalid", str(exc), path)], None
    issues: list[ValidationIssue] = []
    for key in _REQUIRED:
        if key not in fields:
            issues.append(_issue("front_matter.required", f"missing required field '{key}'", path))
    for key, choices in _ENUMS.items():
        if key in fields and (not isinstance(fields[key], str) or fields[key] not in choices):
            issues.append(_issue("front_matter.enum", f"'{key}' must be one of {', '.join(sorted(choices))}", path))
    for key in ("id", "title", "owner"):
        if key in fields and not isinstance(fields[key], str):
            issues.append(_issue("front_matter.type", f"'{key}' must be a string", path))
    if isinstance(fields.get("id"), str) and not _ID.fullmatch(fields["id"]):
        issues.append(_issue("id.invalid", "id must match SDD-NNNN", path))
    if "budget_usd" in fields and (isinstance(fields["budget_usd"], bool) or not isinstance(fields["budget_usd"], (int, float)) or fields["budget_usd"] < 0):
        issues.append(_issue("front_matter.type", "'budget_usd' must be a non-negative number", path))
    for key in ("allowed_paths", "forbidden_paths"):
        if key in fields and (not isinstance(fields[key], list) or not all(isinstance(item, str) for item in fields[key])):
            issues.append(_issue("front_matter.type", f"'{key}' must be a list of strings", path))
        elif key in fields:
            for item in fields[key]:
                if (item.startswith(("/", "\\")) or "//" in item or re.match(r"^[A-Za-z]:($|[/\\])", item)
                        or "\\" in item or "\x00" in item or any(part == ".." for part in item.split("/"))):
                    issues.append(_issue("path.traversal", f"unsafe {key} entry '{item}'", path))
                if item == "" or item.endswith("/"):
                    issues.append(_issue("path.invalid", f"invalid {key} entry '{item}'", path))
    body = text[text.find("---", 3) + 3:]
    headings = {line.strip() for line in body.splitlines() if line.lstrip().startswith("##")}
    for heading in _HEADINGS:
        if f"## {heading}" not in headings:
            issues.append(_issue("content.required", f"missing section '{heading}'", path))
    return issues, fields


def validate_sdd(value: str | Path) -> ValidationResult:
    """Validate one spec text/file or an SDD directory, without modifying it."""
    issues: list[ValidationIssue] = []
    data: dict[str, Any] | None = None
    if isinstance(value, Path) and value.is_symlink():
        return ValidationResult(False, (_issue("file.symlink", "symlinked SDD paths are not allowed", str(value)),), None)
    try:
        text, path, directory = _source(value)
    except FileNotFoundError as exc:
        return ValidationResult(False, (_issue("file.missing", "file does not exist", str(exc)),), None)
    if directory is not None and directory.is_dir():
        path = str(directory / "spec.md")
        spec_path = directory / "spec.md"
        if spec_path.is_symlink():
            issues.append(_issue("file.symlink", "symlinked governed files are not allowed", str(spec_path)))
        elif not spec_path.is_file():
            issues.append(_issue("file.missing", "required file 'spec.md' is missing", path))
        else:
            text = spec_path.read_text(encoding="utf-8")
        for name in ("plan.md", "tasks.md", "verification.md"):
            governed_path = directory / name
            if governed_path.is_symlink():
                issues.append(_issue("file.symlink", "symlinked governed files are not allowed", str(governed_path)))
            elif not governed_path.is_file():
                issues.append(_issue("file.missing", f"required file '{name}' is missing", str(governed_path)))
        if issues and not text:
            return ValidationResult(False, tuple(sorted(issues, key=str)), None)
        tasks_path = directory / "tasks.md"
        if tasks_path.is_file() and not tasks_path.is_symlink():
            task_text = tasks_path.read_text(encoding="utf-8")
            tokens = re.findall(r"(?<![A-Za-z0-9_-])T-[A-Za-z0-9_-]+", task_text)
            if any(not _TASK.fullmatch(token) for token in tokens):
                issues.append(_issue("task.id.invalid", "task identifiers must match T-NNN", str(tasks_path)))
        for name in ("plan.md", "verification.md"):
            governed_path = directory / name
            if (governed_path.is_file() and not governed_path.is_symlink()
                    and governed_path.read_text(encoding="utf-8").count("#") == 0):
                issues.append(_issue("content.invalid", f"'{name}' has no headings", str(governed_path)))
    body_issues, data = _validate_spec(text, path)
    issues.extend(body_issues)
    issues.sort(key=lambda item: (item.path, item.line or 0, item.code, item.message))
    return ValidationResult(not issues, tuple(issues), dict(data) if data is not None else None)
