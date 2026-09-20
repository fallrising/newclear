"""Bounded, local-only source intake primitives for the knowledge refinery."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
from types import MappingProxyType
from typing import Any, Mapping


class IntakeError(ValueError):
    """The source or local taxonomy failed a mandatory intake gate."""


MAX_SOURCE_BYTES = 8 * 1024 * 1024
SCHEMA_VERSION = "knowledge-source-manifest.v1"
EXTRACTOR_INPUT_VERSION = "synthetic-input.v1"
_MIME = {b"%PDF-": "application/pdf", b"P1\n": "image/x-portable-bitmap", b"P1\r\n": "image/x-portable-bitmap"}
_CANONICAL = {
    "domains": ("operations", "software", "systems"),
    "concepts": ("consistency", "idempotency", "privacy", "provenance"),
    "relations": ("contrasts_with", "depends_on", "derived_from", "example_of", "implements"),
}
_CANONICAL_TAXONOMY = (
    b"domains:\n  - operations\n  - software\n  - systems\n"
    b"concepts:\n  - consistency\n  - idempotency\n  - privacy\n  - provenance\n"
    b"relations:\n  - contrasts_with\n  - depends_on\n  - derived_from\n"
    b"  - example_of\n  - implements\n"
)
_SECRET = re.compile(rb"(?i)(?:api[_-]?key|token|password|secret)\s*[:=]")
_PII = re.compile(rb"(?i)\b(?:ssn|social\s+security|email|phone)\s*[:=]")
_CONFIDENTIAL = re.compile(rb"(?i)\b(?:confidential|internal[- ]only|customer data)\b")


def _read_regular_bytes(path: Path, *, label: str, maximum: int) -> bytes:
    """Read one stable, non-link regular file through a no-follow descriptor."""
    _reject_symlink_components(path)
    try:
        fd = os.open(os.fspath(path), os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError as exc:
        raise IntakeError(f"{label} is unreadable") from exc
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode):
            raise IntakeError(f"{label} must be a regular file")
        if before.st_size <= 0 or before.st_size > maximum:
            raise IntakeError(f"{label} exceeds bounded size")
        content = bytearray()
        while len(content) < before.st_size:
            chunk = os.read(fd, min(65536, before.st_size - len(content)))
            if not chunk:
                raise IntakeError(f"{label} changed during read")
            content.extend(chunk)
        after = os.fstat(fd)
        identity = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
        if any(getattr(before, item) != getattr(after, item) for item in identity):
            raise IntakeError(f"{label} changed during read")
        return bytes(content)
    except OSError as exc:
        raise IntakeError(f"{label} is unreadable") from exc
    finally:
        os.close(fd)


def _reject_symlink_components(path: Path) -> None:
    """Do not permit any existing path component to resolve through a link."""
    absolute = Path(os.path.abspath(os.fspath(path)))
    current = Path(absolute.anchor)
    for component in absolute.parts[1:]:
        current /= component
        try:
            if current.is_symlink():
                raise IntakeError("path contains a symlink")
        except OSError as exc:
            raise IntakeError("path is unsafe") from exc


def _ensure_directory(path: Path) -> None:
    absolute = Path(os.path.abspath(os.fspath(path)))
    current = Path(absolute.anchor)
    for component in absolute.parts[1:]:
        current /= component
        try:
            if current.exists() or current.is_symlink():
                if current.is_symlink() or not current.is_dir():
                    raise IntakeError("state directory is unsafe")
            else:
                current.mkdir()
        except OSError as exc:
            raise IntakeError("state directory is unsafe") from exc


def _mime(prefix: bytes) -> str:
    if prefix.startswith(b"%PDF-"):
        return "application/pdf"
    if prefix.startswith((b"P1\n", b"P1\r\n")):
        return "image/x-portable-bitmap"
    raise IntakeError("unsupported content type")


def _safe_name(name: str) -> str:
    if not name or len(name) > 120 or any(ord(c) < 32 or ord(c) == 127 for c in name):
        raise IntakeError("unsafe original name")
    if "/" in name or "\\" in name or name in {".", ".."} or ".." in Path(name).parts:
        raise IntakeError("unsafe original name")
    # Keep a bounded, non-sensitive display name in the manifest.
    value = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    return value[:120] or "source"


def _scan(data: bytes) -> list[str]:
    found = []
    if _SECRET.search(data):
        found.append("secret")
    if _PII.search(data):
        found.append("pii")
    if _CONFIDENTIAL.search(data):
        found.append("confidential")
    return sorted(found)


def _content_details(data: bytes) -> tuple[str, str, list[str]]:
    """Return only deterministic content facts used to bind an existing record."""
    mime = _mime(data[:8])
    if (mime == "application/pdf"
            and (not data.startswith(b"%PDF-") or b"%%EOF" not in data[-64:])):
        raise IntakeError("malformed PDF")
    if mime == "image/x-portable-bitmap" and not _valid_pbm(data):
        raise IntakeError("malformed PBM")
    return mime, hashlib.sha256(data).hexdigest(), _scan(data)


def _publish_exclusive(path: Path, payload: bytes) -> None:
    """Publish complete bytes atomically without replacing an existing object."""
    fd, temporary = tempfile.mkstemp(prefix=".intake-", dir=path.parent)
    temporary_path = Path(temporary)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temporary_path, path)
    finally:
        try:
            temporary_path.unlink()
        except FileNotFoundError:
            pass


def _valid_pbm(data: bytes) -> bool:
    if any(byte > 127 for byte in data) or not data.startswith(b"P1"):
        return False
    match = re.match(rb"\s*(?:#[^\n]*\n\s*)*(\d+)\s+(\d+)", data[2:])
    if not match:
        return False
    width, height = int(match.group(1)), int(match.group(2))
    return 0 < width <= 4096 and 0 < height <= 4096 and bool(data[2 + match.end():])


class SourceStore:
    def __init__(self, state_root: os.PathLike[str] | str, *, max_bytes: int = MAX_SOURCE_BYTES):
        if isinstance(max_bytes, bool) or not isinstance(max_bytes, int) or not 1 <= max_bytes <= MAX_SOURCE_BYTES:
            raise IntakeError("invalid source size bound")
        try:
            raw_root = os.fspath(state_root)
        except TypeError as exc:
            raise IntakeError("invalid state root") from exc
        if not isinstance(raw_root, str) or "\x00" in raw_root:
            raise IntakeError("invalid state root")
        self.root = Path(raw_root)
        _reject_symlink_components(self.root)
        if self.root.exists() and not self.root.is_dir():
            raise IntakeError("state root must be a directory")
        self.max_bytes = max_bytes

    def ingest(self, source: os.PathLike[str] | str, *, rights: str = "unconfirmed",
               data_class: str = "restricted") -> Path:
        try:
            raw_source = os.fspath(source)
        except TypeError as exc:
            raise IntakeError("unsafe source path") from exc
        if (not isinstance(raw_source, str) or "\x00" in raw_source
                or any(part == ".." for part in Path(raw_source).parts)):
            raise IntakeError("unsafe source path")
        path = Path(source)
        original_name = _safe_name(path.name)
        if rights not in {"confirmed", "unconfirmed", "denied"}:
            raise IntakeError("invalid rights decision")
        if data_class not in {"public", "internal", "confidential", "restricted"}:
            raise IntakeError("invalid data class")
        data = _read_regular_bytes(path, label="source", maximum=self.max_bytes)
        size = len(data)
        if any(byte < 32 and byte not in (9, 10, 13) for byte in data):
            raise IntakeError("source contains unsafe control bytes")
        mime, digest, findings = _content_details(data)
        provider_eligible = rights == "confirmed" and data_class in {"public", "internal"} and not findings
        manifest = {
            "byte_count": size,
            "data_class": data_class,
            "extractor_input_version": EXTRACTOR_INPUT_VERSION,
            "local_only": not provider_eligible,
            "mime": mime,
            "original_name": original_name,
            "provider_eligible": provider_eligible,
            "quarantine_object": f"quarantine/{digest}",
            "rights_decision": rights,
            "schema_version": SCHEMA_VERSION,
            "sensitive_findings": findings,
            "sha256": digest,
        }
        _ensure_directory(self.root)
        quarantine = self.root / "quarantine"
        manifests = self.root / "manifests"
        for directory in (quarantine, manifests):
            _ensure_directory(directory)
        object_path = quarantine / digest
        manifest_path = manifests / f"{digest}.json"
        encoded = (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode()
        if manifest_path.exists() or object_path.exists():
            _validate_existing(self.root, manifest_path, object_path, data, digest,
                               rights, data_class)
            return manifest_path
        try:
            _publish_exclusive(object_path, data)
            _publish_exclusive(manifest_path, encoded)
        except FileExistsError:
            _validate_existing(self.root, manifest_path, object_path, data, digest,
                               rights, data_class)
            return manifest_path
        except OSError as exc:
            raise IntakeError("quarantine publication failed") from exc
        return manifest_path


def ingest_source(source: os.PathLike[str] | str, state_root: os.PathLike[str] | str, **kwargs: Any) -> Path:
    return SourceStore(state_root).ingest(source, **kwargs)


_MANIFEST_KEYS = frozenset({
    "byte_count", "data_class", "extractor_input_version", "local_only", "mime",
    "original_name", "provider_eligible", "quarantine_object", "rights_decision",
    "schema_version", "sensitive_findings", "sha256",
})


def _strict_json(payload: bytes) -> Mapping[str, Any]:
    duplicates = False
    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        nonlocal duplicates
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                duplicates = True
            result[key] = value
        return result
    try:
        value = json.loads(payload.decode("utf-8"), object_pairs_hook=pairs)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise IntakeError("manifest is malformed") from exc
    if duplicates or not isinstance(value, Mapping):
        raise IntakeError("manifest is malformed")
    return value


def _validate_existing(root: Path, manifest_path: Path, object_path: Path, data: bytes,
                       digest: str, rights: str, data_class: str) -> None:
    _reject_symlink_components(manifest_path)
    _reject_symlink_components(object_path)
    try:
        raw = _read_regular_bytes(manifest_path, label="manifest", maximum=MAX_SOURCE_BYTES)
        object_bytes = _read_regular_bytes(object_path, label="quarantine object", maximum=MAX_SOURCE_BYTES)
        manifest = _strict_json(raw)
        if set(manifest) != _MANIFEST_KEYS:
            raise IntakeError("manifest schema is invalid")
        if manifest.get("schema_version") != SCHEMA_VERSION or manifest.get("extractor_input_version") != EXTRACTOR_INPUT_VERSION:
            raise IntakeError("manifest schema is invalid")
        object_mime, object_digest, object_findings = _content_details(object_bytes)
        source_mime, source_digest, source_findings = _content_details(data)
        if object_bytes != data or object_digest != source_digest or source_digest != digest:
            raise IntakeError("immutable content-addressed state mismatch")
        if (manifest.get("sha256") != source_digest
                or manifest.get("mime") != source_mime
                or object_mime != source_mime):
            raise IntakeError("manifest identity is invalid")
        if manifest.get("byte_count") != len(data) or not isinstance(manifest.get("byte_count"), int) or isinstance(manifest.get("byte_count"), bool):
            raise IntakeError("manifest identity is invalid")
        if manifest.get("data_class") not in {"public", "internal", "confidential", "restricted"}:
            raise IntakeError("manifest policy is invalid")
        if manifest.get("rights_decision") not in {"confirmed", "unconfirmed", "denied"}:
            raise IntakeError("manifest policy is invalid")
        if manifest["data_class"] != data_class or manifest["rights_decision"] != rights:
            raise IntakeError("manifest policy conflicts with requested decision")
        findings = manifest.get("sensitive_findings")
        if (not isinstance(findings, list)
                or any(not isinstance(item, str) or item not in {"secret", "pii", "confidential"} for item in findings)
                or findings != sorted(set(findings))
                or findings != source_findings
                or object_findings != source_findings):
            raise IntakeError("manifest policy is invalid")
        eligible = manifest.get("provider_eligible")
        if not isinstance(eligible, bool) or manifest.get("local_only") is not (not eligible):
            raise IntakeError("manifest policy is invalid")
        expected_eligible = (rights == "confirmed"
                             and data_class in {"public", "internal"}
                             and not source_findings)
        if eligible is not expected_eligible:
            raise IntakeError("manifest policy is invalid")
        if manifest.get("quarantine_object") != f"quarantine/{digest}" or not isinstance(manifest.get("original_name"), str):
            raise IntakeError("manifest identity is invalid")
        try:
            if _safe_name(manifest["original_name"]) != manifest["original_name"]:
                raise IntakeError("manifest identity is invalid")
        except IntakeError:
            raise
        if raw != (json.dumps(dict(manifest), sort_keys=True, separators=(",", ":")) + "\n").encode():
            raise IntakeError("manifest is not canonical")
    except OSError as exc:
        raise IntakeError("immutable state is unreadable") from exc


def load_taxonomy(path: os.PathLike[str] | str = "knowledge/90-meta/taxonomy.yaml") -> Mapping[str, tuple[str, ...]]:
    try:
        raw_path = os.fspath(path)
    except TypeError as exc:
        raise ValueError("taxonomy is unreadable") from exc
    if not isinstance(raw_path, str) or "\x00" in raw_path:
        raise ValueError("taxonomy is unreadable")
    target = Path(raw_path)
    try:
        raw = _read_regular_bytes(target, label="taxonomy", maximum=16 * 1024)
        if raw != _CANONICAL_TAXONOMY:
            raise ValueError("taxonomy is not the canonical taxonomy")
        lines = raw.decode("utf-8").splitlines()
    except (IntakeError, UnicodeError) as exc:
        raise ValueError("taxonomy is unreadable") from exc
    result: dict[str, list[str]] = {}
    current = None
    for line in lines:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line.startswith("  - ") and current:
            value = line[4:]
            if not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", value) or value in result[current]:
                raise ValueError("taxonomy contains malformed or duplicate value")
            result[current].append(value)
        elif re.fullmatch(r"[a-z]+:", line):
            current = line[:-1]
            if current in result:
                raise ValueError("taxonomy contains duplicate section")
            result[current] = []
        else:
            raise ValueError("taxonomy contains malformed input")
    if set(result) != set(_CANONICAL) or any(tuple(result[k]) != _CANONICAL[k] for k in _CANONICAL):
        raise ValueError("taxonomy is not the canonical taxonomy")
    return MappingProxyType({key: tuple(result[key]) for key in sorted(result)})


def validate_taxonomy_value(taxonomy: Mapping[str, Any], category: str, value: str) -> bool:
    if category not in {"domains", "concepts", "relations"}:
        raise ValueError("unknown taxonomy category")
    if not isinstance(taxonomy, Mapping) or set(taxonomy) != set(_CANONICAL):
        raise ValueError("malformed taxonomy")
    if any(taxonomy.get(key) != _CANONICAL[key] for key in _CANONICAL):
        raise ValueError("malformed taxonomy")
    values = taxonomy.get(category)
    if not isinstance(values, tuple) or not isinstance(value, str):
        raise ValueError("malformed taxonomy")
    return value in values


validate_taxonomy = load_taxonomy
