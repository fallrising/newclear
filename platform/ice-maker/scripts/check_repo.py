#!/usr/bin/env python3
"""Offline Phase 0 repository validation gate."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SYNTHETIC_MARKERS = ("SYNTHETIC_TEST_MARKER", "SYNTHETIC_TEST_SECRET")
SECRET_PATTERNS = (
    re.compile(r"(?i)\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"(?i)\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"(?i)\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b"),
    re.compile(r"(?i)\b(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*['\"][^'\"]{8,}['\"]"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
)
ACTION_RE = re.compile(r"^\s*-?\s*uses:\s*[^#\s]+@([^\s#]+)", re.MULTILINE)


def display_path(path: Path) -> str:
    """Format a path without leaking machine-specific absolute paths."""
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def tracked_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "-z"], cwd=ROOT, check=True, capture_output=True
    )
    return [ROOT / item for item in result.stdout.decode().split("\0") if item]


def check_json(files: list[Path]) -> list[str]:
    errors = []
    for path in files:
        if path.suffix != ".json":
            continue
        try:
            with path.open(encoding="utf-8") as handle:
                json.load(handle)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            errors.append(f"invalid JSON: {display_path(path)} ({exc.__class__.__name__})")
    return errors


def check_whitespace(files: list[Path]) -> list[str]:
    errors = []
    for path in files:
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for number, line in enumerate(text.splitlines(), 1):
            if line.endswith((" ", "\t")):
                errors.append(f"trailing whitespace: {display_path(path)}:{number}")
    return errors


def check_secrets(files: list[Path]) -> list[str]:
    errors = []
    for path in files:
        # Only explicit test/fixture paths may contain synthetic examples.  Every
        # other tracked path, including production files, is scanned normally.
        relative_parts = path.relative_to(ROOT).parts
        synthetic_path = "tests" in relative_parts or "fixture" in relative_parts
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeDecodeError):
            continue
        for number, line in enumerate(lines, 1):
            if synthetic_path and any(marker in line for marker in SYNTHETIC_MARKERS):
                continue
            if any(pattern.search(line) for pattern in SECRET_PATTERNS):
                errors.append(f"secret-like content: {display_path(path)}:{number}")
    return errors


def check_source_hashes() -> list[str]:
    manifest = ROOT / "docs/execution/sdd-source.sha256"
    errors = []
    try:
        entries = manifest.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        return [f"cannot read source hash manifest: {exc.__class__.__name__}"]
    for entry in entries:
        fields = entry.split()
        if len(fields) != 2 or not re.fullmatch(r"[0-9a-fA-F]{64}", fields[0]):
            errors.append(f"malformed source hash entry: {entry}")
            continue
        target = ROOT / fields[1]
        if not target.is_file():
            errors.append(f"missing hashed source: {fields[1]}")
            continue
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        if digest.lower() != fields[0].lower():
            errors.append(f"source hash mismatch: {fields[1]}")
    return errors


def check_governance() -> list[str]:
    errors = []
    try:
        codeowners_path = ROOT / "CODEOWNERS"
        github_codeowners_path = ROOT / ".github/CODEOWNERS"
        codeowners = codeowners_path.read_text(encoding="utf-8")
        github_codeowners = github_codeowners_path.read_text(encoding="utf-8")
        protected = json.loads((ROOT / "orchestration/policies/protected-paths.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        return [f"governance files unavailable: {exc.__class__.__name__}"]
    if codeowners != github_codeowners:
        errors.append("CODEOWNERS copies differ: CODEOWNERS and .github/CODEOWNERS")

    def owned_paths(contents: str) -> set[str]:
        return {
            line.split()[0].lstrip("/")
            for line in contents.splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        }

    owner_paths = owned_paths(codeowners)
    github_owner_paths = owned_paths(github_codeowners)
    for path in protected.get("paths", []):
        if path not in owner_paths:
            errors.append(f"protected path lacks CODEOWNERS entry: {path}")
        if path not in github_owner_paths:
            errors.append(f"protected path lacks .github/CODEOWNERS entry: {path}")
    if protected.get("owner"):
        if protected["owner"] not in codeowners:
            errors.append("protected policy owner is absent from CODEOWNERS")
        if protected["owner"] not in github_codeowners:
            errors.append("protected policy owner is absent from .github/CODEOWNERS")
    return errors


def check_workflows(files: list[Path]) -> list[str]:
    errors = []
    for path in files:
        if ".github/workflows" not in str(path.relative_to(ROOT)):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for ref in ACTION_RE.findall(text):
            if not re.fullmatch(r"[0-9a-fA-F]{40}", ref):
                errors.append(f"workflow action is not SHA-pinned: {display_path(path)}")
    return errors


def check_active_sdds() -> list[str]:
    """Validate each active SDD while refusing symlink-based traversal."""
    from ice_maker.sdd import validate_sdd

    active = ROOT / "specs/active"
    if active.is_symlink():
        return [f"active SDD root is a symlink: {display_path(active)}"]
    if not active.is_dir():
        return [f"active SDD root is missing or not a directory: {display_path(active)}"]

    errors = []
    for entry in sorted(active.iterdir(), key=lambda path: path.name):
        relative = display_path(entry)
        if entry.is_symlink():
            errors.append(f"active SDD is a symlink: {relative}")
            continue
        if not entry.is_dir():
            errors.append(f"active SDD is not a directory: {relative}")
            continue
        try:
            result = validate_sdd(entry)
        except (OSError, UnicodeError) as exc:
            errors.append(f"active SDD could not be read: {relative} ({exc.__class__.__name__})")
            continue
        for issue in result.issues:
            issue_path = display_path(Path(issue.path)) if issue.path else relative
            errors.append(f"active SDD invalid: {issue_path}: {issue.code}: {issue.message}")
    return errors


def validate() -> list[str]:
    files = tracked_files()
    errors = []
    errors.extend(check_json(files))
    errors.extend(check_source_hashes())
    errors.extend(check_whitespace(files))
    errors.extend(check_secrets(files))
    errors.extend(check_governance())
    errors.extend(check_workflows(files))
    errors.extend(check_active_sdds())
    return errors


def main() -> int:
    errors = validate()
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        print(f"Phase 0 check failed ({len(errors)} issue(s))", file=sys.stderr)
        return 1
    print("Phase 0 check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
