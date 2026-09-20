"""Fail-closed, local-only contracts for production document batches."""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
from types import MappingProxyType
from typing import Any, Callable, Mapping


class BatchContractError(ValueError):
    """A manifest, source, configuration, or evidence contract is invalid."""


SCHEMA_VERSION = "document-batch-manifest.v1"
RESULT_SCHEMA = "document-batch-result.v1"
CHECKPOINT_SCHEMA = "document-batch-checkpoint.v1"
CONFIG_SCHEMA = "document-ingestion-config.v1"
STATUSES = frozenset(("processed", "duplicate", "rejected", "failed"))
RIGHTS = frozenset(("confirmed", "unconfirmed", "denied"))
DATA_CLASSES = frozenset(("public", "internal", "confidential", "restricted"))
CODE_MAXIMA = MappingProxyType({
    "max_items": 100, "max_file_bytes": 268435456,
    "max_aggregate_bytes": 4294967296, "max_pdf_pages": 1000,
    "max_decoded_pixels": 100000000, "max_image_dimension": 100000,
    "max_tile_pixels": 16000000,
    "tile_height_pixels": 8192, "tile_overlap_pixels": 4096,
    "max_ocr_output_bytes": 8388608, "timeout_seconds": 600,
    "max_workers": 2, "max_error_records": 1000,
})
MAX_MANIFEST_BYTES = 4 * 1024 * 1024
MAX_LANGUAGE_LENGTH = 64
MAX_LANGUAGES = 16
MAX_RELATIVE_PATH_LENGTH = 1024
READ_CHUNK_BYTES = 65536
_HASH = re.compile(r"^[0-9a-f]{64}$")
_LANGUAGE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
_REASON = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_SIGNATURES = frozenset(("pdf", "png", "jpeg", "webp"))
_DIRECTORY_FLAGS = (
    os.O_RDONLY
    | getattr(os, "O_DIRECTORY", 0)
    | getattr(os, "O_NOFOLLOW", 0)
    | getattr(os, "O_CLOEXEC", 0)
)
_FILE_FLAGS = (
    os.O_RDONLY
    | getattr(os, "O_NOFOLLOW", 0)
    | getattr(os, "O_CLOEXEC", 0)
)


def canonical_json(value: Any) -> bytes:
    try:
        text = json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
            allow_nan=False,
        )
        return (text + "\n").encode("ascii")
    except (TypeError, ValueError, UnicodeEncodeError) as exc:
        raise BatchContractError("value is not canonical JSON") from exc


def _strict_json(raw: bytes) -> Any:
    duplicate = False

    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        nonlocal duplicate
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                duplicate = True
            result[key] = value
        return result
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise BatchContractError("JSON is malformed") from exc
    if duplicate or canonical_json(value) != raw:
        raise BatchContractError("JSON is not canonical")
    return value


def _validate_limits(limits: Any) -> Mapping[str, int]:
    if not isinstance(limits, Mapping) or set(limits) != set(CODE_MAXIMA):
        raise BatchContractError("configuration limits are invalid")
    checked: dict[str, int] = {}
    for key, maximum in CODE_MAXIMA.items():
        value = limits[key]
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0 or value > maximum:
            raise BatchContractError("configuration exceeds supported envelope")
        checked[key] = value
    if checked["tile_overlap_pixels"] >= checked["tile_height_pixels"]:
        raise BatchContractError("tile overlap is invalid")
    return MappingProxyType(checked)


def load_config(
    path: os.PathLike[str] | str = "config/document-ingestion.json",
    overrides: Mapping[str, Any] | None = None,
) -> Mapping[str, Any]:
    value = _strict_json(_read_file(Path(path), 128 * 1024, "configuration"))
    if (
        not isinstance(value, dict)
        or set(value) != {"schema_version", "limits"}
        or value["schema_version"] != CONFIG_SCHEMA
    ):
        raise BatchContractError("configuration schema is invalid")
    merged = dict(value["limits"]) if isinstance(value["limits"], dict) else {}
    if overrides is not None and not isinstance(overrides, Mapping):
        raise BatchContractError("configuration overrides are invalid")
    for key, item in (overrides or {}).items():
        if key not in CODE_MAXIMA:
            raise BatchContractError("unknown configuration override")
        merged[key] = item
    return MappingProxyType({"schema_version": CONFIG_SCHEMA, "limits": _validate_limits(merged)})


def _limits(config: Mapping[str, Any] | None) -> Mapping[str, int]:
    if config is None:
        return load_config()["limits"]
    if (
        not isinstance(config, Mapping)
        or set(config) != {"schema_version", "limits"}
        or config["schema_version"] != CONFIG_SCHEMA
    ):
        raise BatchContractError("configuration schema is invalid")
    return _validate_limits(config["limits"])


@dataclass(frozen=True, slots=True)
class BatchItem:
    path: str
    rights: str
    data_class: str
    languages: tuple[str, ...]
    def __post_init__(self) -> None:
        if not isinstance(self.path, str) or not _safe_relative(self.path):
            raise BatchContractError("item path is unsafe")
        if (
            not isinstance(self.rights, str)
            or self.rights not in RIGHTS
            or not isinstance(self.data_class, str)
            or self.data_class not in DATA_CLASSES
        ):
            raise BatchContractError("item policy is invalid")
        if (
            not isinstance(self.languages, tuple)
            or not 1 <= len(self.languages) <= MAX_LANGUAGES
        ):
            raise BatchContractError("OCR languages are invalid")
        if any(
            not isinstance(item, str)
            or len(item) > MAX_LANGUAGE_LENGTH
            or not _LANGUAGE.fullmatch(item)
            for item in self.languages
        ):
            raise BatchContractError("OCR languages are invalid")
        if tuple(sorted(set(self.languages))) != self.languages:
            raise BatchContractError("OCR languages must be unique and canonical")


@dataclass(frozen=True, slots=True)
class BatchManifest:
    items: tuple[BatchItem, ...]
    schema_version: str = SCHEMA_VERSION
    def __post_init__(self) -> None:
        if not isinstance(self.items, tuple) or self.schema_version != SCHEMA_VERSION:
            raise BatchContractError("manifest schema is invalid")
        if (
            not 1 <= len(self.items) <= CODE_MAXIMA["max_items"]
            or any(type(item) is not BatchItem for item in self.items)
        ):
            raise BatchContractError("manifest item count is invalid")
        paths = [item.path for item in self.items]
        if paths != sorted(paths) or len(paths) != len(set(paths)):
            raise BatchContractError("manifest paths are not unique and canonical")
    def as_dict(self) -> dict[str, Any]:
        items = [
            {
                "data_class": item.data_class,
                "languages": list(item.languages),
                "path": item.path,
                "rights": item.rights,
            }
            for item in self.items
        ]
        return {"items": items, "schema_version": self.schema_version}
    def bytes(self) -> bytes:
        return canonical_json(self.as_dict())
    @property
    def digest(self) -> str:
        return hashlib.sha256(self.bytes()).hexdigest()


def validate_manifest(
    raw: bytes | bytearray | str | os.PathLike[str],
    config: Mapping[str, Any] | None = None,
) -> BatchManifest:
    if isinstance(raw, (str, os.PathLike)):
        data = _read_file(Path(raw), MAX_MANIFEST_BYTES, "manifest")
    elif isinstance(raw, (bytes, bytearray)):
        if not raw or len(raw) > MAX_MANIFEST_BYTES:
            raise BatchContractError("manifest is outside byte bound")
        data = bytes(raw)
    else:
        raise BatchContractError("manifest input is invalid")
    value = _strict_json(data)
    if (
        not isinstance(value, dict)
        or set(value) != {"items", "schema_version"}
        or not isinstance(value["items"], list)
    ):
        raise BatchContractError("manifest schema is invalid")
    if len(value["items"]) > _limits(config)["max_items"]:
        raise BatchContractError("manifest exceeds configured item limit")
    items = []
    for item in value["items"]:
        if (
            not isinstance(item, dict)
            or set(item) != {"data_class", "languages", "path", "rights"}
            or not isinstance(item["languages"], list)
        ):
            raise BatchContractError("manifest item fields are invalid")
        items.append(
            BatchItem(
                item["path"],
                item["rights"],
                item["data_class"],
                tuple(item["languages"]),
            )
        )
    return BatchManifest(tuple(items), value["schema_version"])


@dataclass(frozen=True, slots=True)
class SourceDescriptor:
    item: BatchItem
    size: int
    sha256: str
    signature: str
    duplicate_of: str | None = None

    def __post_init__(self) -> None:
        if (
            type(self.item) is not BatchItem
            or type(self.size) is not int
            or not 0 < self.size <= CODE_MAXIMA["max_file_bytes"]
            or not isinstance(self.sha256, str)
            or not _HASH.fullmatch(self.sha256)
            or not isinstance(self.signature, str)
            or self.signature not in _SIGNATURES
        ):
            raise BatchContractError("source descriptor is invalid")
        if self.duplicate_of is not None and (
            not isinstance(self.duplicate_of, str)
            or not _safe_relative(self.duplicate_of)
            or self.duplicate_of == self.item.path
            or self.duplicate_of >= self.item.path
        ):
            raise BatchContractError("source duplicate origin is invalid")


@dataclass(frozen=True, slots=True)
class ProductionToolchain:
    """Explicit local parser/OCR identity; executable use is verified by run_batch."""

    pdfinfo: str
    pdftotext: str
    pdftoppm: str
    tesseract: str
    poppler_version: str
    tesseract_version: str
    languages: tuple[str, ...]

    def __post_init__(self) -> None:
        paths = (self.pdfinfo, self.pdftotext, self.pdftoppm, self.tesseract)
        versions = (self.poppler_version, self.tesseract_version)
        if (
            any(not isinstance(path, str) or not os.path.isabs(path) or "\x00" in path for path in paths)
            or any(not isinstance(version, str) or not re.fullmatch(r"[A-Za-z0-9 ._+()=-]{1,256}", version) for version in versions)
            or not isinstance(self.languages, tuple)
            or not self.languages
            or tuple(sorted(set(self.languages))) != self.languages
            or any(not isinstance(language, str) or not _LANGUAGE.fullmatch(language) for language in self.languages)
        ):
            raise BatchContractError("production toolchain is invalid")

    def as_dict(self) -> dict[str, Any]:
        return {
            "languages": list(self.languages),
            "pdfinfo": self.pdfinfo,
            "pdftoppm": self.pdftoppm,
            "pdftotext": self.pdftotext,
            "poppler_version": self.poppler_version,
            "tesseract": self.tesseract,
            "tesseract_version": self.tesseract_version,
        }

    @property
    def digest(self) -> str:
        return hashlib.sha256(canonical_json(self.as_dict())).hexdigest()


def discover_sources(
    manifest: BatchManifest,
    input_root: os.PathLike[str] | str,
    config: Mapping[str, Any] | None = None,
) -> tuple[SourceDescriptor, ...]:
    if type(manifest) is not BatchManifest:
        raise BatchContractError("manifest is invalid")
    root, root_fd = _pin_absolute_directory(
        input_root,
        "input root",
        create=False,
    )
    limits = _limits(config)
    result: list[SourceDescriptor] = []
    seen_inode: set[tuple[int, int]] = set()
    seen_digest: dict[str, str] = {}
    total = 0
    try:
        for item in manifest.items:
            path = root / item.path
            # This makes pre-existing links fail with a stable contract error;
            # descriptor-relative opens below enforce the boundary under races.
            _reject_links(path)
            fd = _open_regular_beneath(root_fd, item.path, "source")
            try:
                before = os.fstat(fd)
                identity = (before.st_dev, before.st_ino)
                if before.st_nlink != 1 or identity in seen_inode:
                    raise BatchContractError("source filesystem alias is unsafe")
                if before.st_size <= 0 or before.st_size > limits["max_file_bytes"]:
                    raise BatchContractError("source size is outside bounds")
                total += before.st_size
                if total > limits["max_aggregate_bytes"]:
                    raise BatchContractError("aggregate source size exceeds bound")
                digest, prefix, count = _hash_fd(fd, before.st_size, "source")
                after = os.fstat(fd)
                if count != before.st_size or _identity_changed(before, after):
                    raise BatchContractError("source changed during read")
                signature = _signature(prefix)
                if signature is None:
                    raise BatchContractError("unsupported source signature")
                duplicate_of = seen_digest.get(digest)
                seen_inode.add(identity)
                seen_digest.setdefault(digest, item.path)
                result.append(
                    SourceDescriptor(
                        item,
                        before.st_size,
                        digest,
                        signature,
                        duplicate_of,
                    )
                )
            finally:
                os.close(fd)
    finally:
        os.close(root_fd)
    return tuple(result)


def _hash_fd(fd: int, size: int, label: str) -> tuple[str, bytes, int]:
    digest = hashlib.sha256()
    prefix = bytearray()
    count = 0
    while count < size:
        chunk = os.read(fd, min(READ_CHUNK_BYTES, size - count))
        if not chunk or len(chunk) > size - count:
            raise BatchContractError(label + " changed during read")
        if len(prefix) < 16:
            prefix.extend(chunk[:16 - len(prefix)])
        digest.update(chunk)
        count += len(chunk)
    if os.read(fd, 1):
        raise BatchContractError(label + " changed during read")
    return digest.hexdigest(), bytes(prefix), count


def _identity_changed(before: os.stat_result, after: os.stat_result) -> bool:
    fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
    return any(
        getattr(before, field) != getattr(after, field)
        for field in fields
    )


def _signature(data: bytes) -> str | None:
    if data.startswith(b"%PDF-"):
        return "pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if data.startswith(b"RIFF") and len(data) >= 12 and data[8:12] == b"WEBP":
        return "webp"
    return None


def _safe_relative(value: str) -> bool:
    if (
        not value
        or len(value) > MAX_RELATIVE_PATH_LENGTH
        or "\x00" in value
        or "\\" in value
        or Path(value).is_absolute()
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        return False
    parts = Path(value).parts
    return (
        bool(parts)
        and value == Path(value).as_posix()
        and all(part not in ("", ".", "..") for part in parts)
    )


def _absolute_directory_path(
    value: os.PathLike[str] | str,
    label: str,
) -> Path:
    try:
        raw = os.fspath(value)
    except TypeError as exc:
        raise BatchContractError(label + " path is invalid") from exc
    if (
        not isinstance(raw, str)
        or "\x00" in raw
        or not os.path.isabs(raw)
        or raw != Path(raw).as_posix()
        or Path(raw) == Path(Path(raw).anchor)
        or ".." in Path(raw).parts
    ):
        raise BatchContractError(label + " must be an absolute non-traversing path")
    return Path(raw)


def _pin_absolute_directory(
    value: os.PathLike[str] | str,
    label: str,
    *,
    create: bool,
) -> tuple[Path, int]:
    path = _absolute_directory_path(value, label)
    if create:
        descriptor = _open_or_create_directory_no_follow(path, label)
    else:
        descriptor = _open_directory_no_follow(path, label)
    return path, descriptor


def _reject_links(path: Path) -> None:
    absolute = Path(os.path.abspath(os.fspath(path)))
    current = Path(absolute.anchor)
    for part in absolute.parts[1:]:
        current /= part
        if current.is_symlink():
            raise BatchContractError("path contains a symlink")


def _open_regular(path: Path, label: str) -> int:
    try:
        fd = os.open(os.fspath(path), os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError as exc:
        raise BatchContractError(label + " is unreadable") from exc
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise BatchContractError(label + " is not a regular file")
    except BaseException:
        os.close(fd)
        raise
    return fd


def _open_directory_no_follow(path: Path, label: str) -> int:
    parts = path.parts
    try:
        descriptor = os.open(path.anchor, _DIRECTORY_FLAGS)
        try:
            for component in parts[1:]:
                next_descriptor = os.open(
                    component,
                    _DIRECTORY_FLAGS,
                    dir_fd=descriptor,
                )
                os.close(descriptor)
                descriptor = next_descriptor
            if not stat.S_ISDIR(os.fstat(descriptor).st_mode):
                raise OSError("not a directory")
            return descriptor
        except BaseException:
            os.close(descriptor)
            raise
    except OSError as exc:
        raise BatchContractError(label + " is unsafe") from exc


def _open_or_create_directory_no_follow(path: Path, label: str) -> int:
    try:
        descriptor = os.open(path.anchor, _DIRECTORY_FLAGS)
    except OSError as exc:
        raise BatchContractError(label + " is unsafe") from exc
    try:
        for component in path.parts[1:]:
            try:
                next_descriptor = os.open(
                    component,
                    _DIRECTORY_FLAGS,
                    dir_fd=descriptor,
                )
            except FileNotFoundError:
                try:
                    os.mkdir(component, mode=0o700, dir_fd=descriptor)
                except FileExistsError:
                    pass
                next_descriptor = os.open(
                    component,
                    _DIRECTORY_FLAGS,
                    dir_fd=descriptor,
                )
            os.close(descriptor)
            descriptor = next_descriptor
        return descriptor
    except OSError as exc:
        os.close(descriptor)
        raise BatchContractError(label + " is unsafe") from exc


def _open_regular_beneath(root_fd: int, relative: str, label: str) -> int:
    components = tuple(relative.split("/"))
    directory_fd = os.dup(root_fd)
    try:
        for component in components[:-1]:
            next_fd = os.open(component, _DIRECTORY_FLAGS, dir_fd=directory_fd)
            os.close(directory_fd)
            directory_fd = next_fd
        file_fd = os.open(components[-1], _FILE_FLAGS, dir_fd=directory_fd)
        try:
            if not stat.S_ISREG(os.fstat(file_fd).st_mode):
                raise BatchContractError(label + " is not a regular file")
        except BaseException:
            os.close(file_fd)
            raise
        return file_fd
    except BatchContractError:
        raise
    except OSError as exc:
        raise BatchContractError(label + " is unreadable") from exc
    finally:
        os.close(directory_fd)


def _read_file(path: Path, maximum: int, label: str) -> bytes:
    _reject_links(path)
    fd = _open_regular(path, label)
    try:
        before = os.fstat(fd)
        if before.st_size <= 0 or before.st_size > maximum:
            raise BatchContractError(label + " is outside byte bound")
        chunks: list[bytes] = []
        read = 0
        while read < before.st_size:
            chunk = os.read(fd, min(READ_CHUNK_BYTES, before.st_size - read))
            if not chunk or len(chunk) > before.st_size - read:
                raise BatchContractError(label + " changed during read")
            chunks.append(chunk)
            read += len(chunk)
        if os.read(fd, 1) or _identity_changed(before, os.fstat(fd)):
            raise BatchContractError(label + " changed during read")
        return b"".join(chunks)
    finally:
        os.close(fd)


def _freeze(value: Any) -> Any:
    if isinstance(value, dict):
        return MappingProxyType({key: _freeze(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(item) for item in value)
    return value


def _validate_result(result: Any) -> dict[str, Any]:
    fields = {"counts", "items", "manifest_sha256", "schema_version"}
    if (
        not isinstance(result, Mapping)
        or set(result) != fields
        or result["schema_version"] != RESULT_SCHEMA
    ):
        raise BatchContractError("result schema is invalid")
    manifest_hash = result["manifest_sha256"]
    if not isinstance(manifest_hash, str) or not _HASH.fullmatch(manifest_hash):
        raise BatchContractError("result binding is invalid")
    counts, items = result["counts"], result["items"]
    if (
        not isinstance(counts, Mapping)
        or set(counts) != STATUSES
        or not isinstance(items, (list, tuple))
        or not 1 <= len(items) <= CODE_MAXIMA["max_items"]
    ):
        raise BatchContractError("result counts or items are invalid")
    normalized: list[dict[str, Any]] = []
    actual = {state: 0 for state in sorted(STATUSES)}
    prior_path = ""
    prior_success: dict[str, str] = {}
    for record in items:
        if not isinstance(record, Mapping):
            raise BatchContractError("result item is invalid")
        status = record.get("status")
        if status == "processed":
            required = {"path", "status", "sha256"}
        elif status == "duplicate":
            required = {"path", "status", "sha256", "duplicate_of"}
        elif status in ("rejected", "failed"):
            required = {"path", "status", "reason"}
        else:
            required = None
        if (
            required is None
            or set(record) != required
            or not isinstance(record.get("path"), str)
            or not _safe_relative(record["path"])
        ):
            raise BatchContractError("result item fields are invalid")
        if record["path"] <= prior_path:
            raise BatchContractError("result items are not uniquely ordered")
        if status in ("processed", "duplicate") and (
            not isinstance(record["sha256"], str)
            or not _HASH.fullmatch(record["sha256"])
        ):
            raise BatchContractError("result hash is invalid")
        if status == "duplicate" and (
            not isinstance(record["duplicate_of"], str)
            or not _safe_relative(record["duplicate_of"])
        ):
            raise BatchContractError("duplicate origin is invalid")
        if status == "duplicate" and prior_success.get(record["duplicate_of"]) != record["sha256"]:
            raise BatchContractError("duplicate result binding is invalid")
        if status in ("rejected", "failed") and (
            not isinstance(record["reason"], str)
            or not _REASON.fullmatch(record["reason"])
        ):
            raise BatchContractError("result reason is invalid")
        actual[status] += 1
        normalized.append(dict(record))
        prior_path = record["path"]
        if status in ("processed", "duplicate"):
            prior_success[record["path"]] = record["sha256"]
    if any(
        isinstance(counts[state], bool)
        or not isinstance(counts[state], int)
        or counts[state] != actual[state]
        for state in STATUSES
    ):
        raise BatchContractError("result counts do not match item records")
    return {
        "counts": {state: actual[state] for state in sorted(STATUSES)},
        "items": normalized,
        "manifest_sha256": manifest_hash,
        "schema_version": RESULT_SCHEMA,
    }


def make_result(manifest: BatchManifest, records: Any) -> Mapping[str, Any]:
    if (
        type(manifest) is not BatchManifest
        or not isinstance(records, (list, tuple))
        or len(records) != len(manifest.items)
    ):
        raise BatchContractError("result input is invalid")
    normalized = []
    for item, record in zip(manifest.items, records):
        if not isinstance(record, Mapping) or record.get("path") != item.path:
            raise BatchContractError("result item path mismatch")
        normalized.append(dict(record))
    counts = {
        state: sum(record.get("status") == state for record in normalized)
        for state in STATUSES
    }
    result = {
        "counts": counts,
        "items": normalized,
        "manifest_sha256": manifest.digest,
        "schema_version": RESULT_SCHEMA,
    }
    return _freeze(_validate_result(result))


def result_bytes(result: Mapping[str, Any]) -> bytes:
    return canonical_json(_validate_result(result))


def transition_status(current: str | None, requested: str) -> str:
    if requested not in STATUSES or (current is not None and current not in STATUSES):
        raise BatchContractError("unknown item status")
    if current is not None and current != requested:
        raise BatchContractError("terminal outcome cannot be rewritten")
    return requested


_CHECKPOINT_FIELDS = {
    "schema_version",
    "manifest_sha256",
    "config_sha256",
    "source_sha256",
    "status",
}


def _validate_checkpoint(
    value: Any,
    manifest_sha256: str | None = None,
    config_sha256: str | None = None,
    source_sha256: str | None = None,
) -> dict[str, Any]:
    if (
        not isinstance(value, Mapping)
        or set(value) != _CHECKPOINT_FIELDS
        or value.get("schema_version") != CHECKPOINT_SCHEMA
        or value.get("status") not in STATUSES
    ):
        raise BatchContractError("checkpoint schema is invalid")
    for key in ("manifest_sha256", "config_sha256", "source_sha256"):
        if not isinstance(value[key], str) or not _HASH.fullmatch(value[key]):
            raise BatchContractError("checkpoint hash is invalid")
    expected = {
        "manifest_sha256": manifest_sha256,
        "config_sha256": config_sha256,
        "source_sha256": source_sha256,
    }
    if any(item is not None and value[key] != item for key, item in expected.items()):
        raise BatchContractError("checkpoint binding mismatch")
    return dict(value)


def _same_directory_identity(path: Path, expected_fd: int) -> bool:
    try:
        actual_fd = _open_directory_no_follow(path, "checkpoint directory")
    except BatchContractError:
        return False
    try:
        expected = os.fstat(expected_fd)
        actual = os.fstat(actual_fd)
        return (expected.st_dev, expected.st_ino) == (actual.st_dev, actual.st_ino)
    finally:
        os.close(actual_fd)


def _create_checkpoint_temporary(directory_fd: int) -> tuple[str, int]:
    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_CLOEXEC", 0)
    )
    for _ in range(16):
        name = ".checkpoint-" + secrets.token_hex(16)
        try:
            return name, os.open(name, flags, 0o600, dir_fd=directory_fd)
        except FileExistsError:
            continue
        except OSError as exc:
            raise BatchContractError("checkpoint publication failed") from exc
    raise BatchContractError("checkpoint temporary-name collision")


def _read_checkpoint_at(directory_fd: int, name: str, maximum: int) -> bytes:
    try:
        descriptor = os.open(name, _FILE_FLAGS, dir_fd=directory_fd)
    except OSError as exc:
        raise BatchContractError("checkpoint is unreadable") from exc
    try:
        before = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_nlink != 1
            or before.st_size <= 0
            or before.st_size > maximum
        ):
            raise BatchContractError("checkpoint is invalid")
        content = bytearray()
        while len(content) < before.st_size:
            chunk = os.read(
                descriptor,
                min(READ_CHUNK_BYTES, before.st_size - len(content)),
            )
            if not chunk:
                raise BatchContractError("checkpoint changed during read")
            content.extend(chunk)
        if os.read(descriptor, 1) or _identity_changed(before, os.fstat(descriptor)):
            raise BatchContractError("checkpoint changed during read")
        return bytes(content)
    finally:
        os.close(descriptor)


def publish_checkpoint(directory: os.PathLike[str] | str, value: Mapping[str, Any]) -> Path:
    payload = canonical_json(_validate_checkpoint(value))
    digest = hashlib.sha256(payload).hexdigest()
    directory_path, directory_fd = _pin_absolute_directory(
        directory,
        "checkpoint directory",
        create=True,
    )
    target = directory_path / (digest + ".json")
    temporary_name: str | None = None
    try:
        temporary_name, descriptor = _create_checkpoint_temporary(directory_fd)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(
                temporary_name,
                target.name,
                src_dir_fd=directory_fd,
                dst_dir_fd=directory_fd,
                follow_symlinks=False,
            )
        except FileExistsError:
            if _read_checkpoint_at(directory_fd, target.name, len(payload)) != payload:
                raise BatchContractError("checkpoint digest conflict")
        os.unlink(temporary_name, dir_fd=directory_fd)
        temporary_name = None
        os.fsync(directory_fd)
        if not _same_directory_identity(directory_path, directory_fd):
            raise BatchContractError("checkpoint directory changed")
    except BatchContractError:
        raise
    except OSError as exc:
        raise BatchContractError("checkpoint publication failed") from exc
    finally:
        if temporary_name is not None:
            try:
                os.unlink(temporary_name, dir_fd=directory_fd)
            except FileNotFoundError:
                pass
        os.close(directory_fd)
    return target


def load_checkpoint(
    path: os.PathLike[str] | str,
    *,
    manifest_sha256: str,
    config_sha256: str,
    source_sha256: str | None = None,
) -> Mapping[str, Any]:
    for binding in (manifest_sha256, config_sha256):
        if not isinstance(binding, str) or not _HASH.fullmatch(binding):
            raise BatchContractError("checkpoint binding is invalid")
    if source_sha256 is not None and (
        not isinstance(source_sha256, str)
        or not _HASH.fullmatch(source_sha256)
    ):
        raise BatchContractError("checkpoint source binding is invalid")
    try:
        raw_path = os.fspath(path)
    except TypeError as exc:
        raise BatchContractError("checkpoint path is invalid") from exc
    if (
        not isinstance(raw_path, str)
        or "\x00" in raw_path
        or not os.path.isabs(raw_path)
        or raw_path != Path(raw_path).as_posix()
        or ".." in Path(raw_path).parts
    ):
        raise BatchContractError("checkpoint path must be absolute and safe")
    checkpoint_path = Path(raw_path)
    if not re.fullmatch(r"[0-9a-f]{64}\.json", checkpoint_path.name):
        raise BatchContractError("checkpoint name is invalid")
    parent_path, parent_fd = _pin_absolute_directory(
        checkpoint_path.parent,
        "checkpoint directory",
        create=False,
    )
    try:
        raw = _read_checkpoint_at(parent_fd, checkpoint_path.name, 16 * 1024)
        if hashlib.sha256(raw).hexdigest() != checkpoint_path.name[:-5]:
            raise BatchContractError("checkpoint digest mismatch")
        checked = _validate_checkpoint(
            _strict_json(raw),
            manifest_sha256,
            config_sha256,
            source_sha256,
        )
        if not _same_directory_identity(parent_path, parent_fd):
            raise BatchContractError("checkpoint directory changed")
        return _freeze(checked)
    finally:
        os.close(parent_fd)


class _ItemFailure(BatchContractError):
    def __init__(self, reason: str) -> None:
        if not _REASON.fullmatch(reason):
            raise BatchContractError("item failure reason is invalid")
        super().__init__("batch item failed")
        self.reason = reason


class _CacheFailure(BatchContractError):
    pass


@dataclass(frozen=True, slots=True)
class _DiscoveryFailure:
    item: BatchItem
    reason: str


_CACHE_SCHEMA = "document-batch-cache.v1"
_PROGRESS_SCHEMA = "document-batch-progress.v1"
_MAX_CACHE_BYTES = 64 * 1024 * 1024
_CHUNK_FIELDS = {
    "chunk_id", "confidence", "method", "page_number", "region",
    "source_sha256", "text",
}


def _plain_config(config: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "limits": {key: config["limits"][key] for key in sorted(config["limits"])},
        "schema_version": config["schema_version"],
    }


def _verify_toolchain(toolchain: ProductionToolchain) -> None:
    if type(toolchain) is not ProductionToolchain:
        raise BatchContractError("production toolchain is invalid")
    for path in (toolchain.pdfinfo, toolchain.pdftotext, toolchain.pdftoppm, toolchain.tesseract):
        _reject_links(Path(path))
        descriptor = _open_regular(Path(path), "production tool")
        try:
            info = os.fstat(descriptor)
            if info.st_nlink != 1 or not (info.st_mode & 0o111):
                raise BatchContractError("production tool is invalid")
        finally:
            os.close(descriptor)


def _discover_for_batch(
    manifest: BatchManifest,
    root: Path,
    config: Mapping[str, Any],
) -> tuple[SourceDescriptor | _DiscoveryFailure, ...]:
    """Discover one pinned manifest pass while isolating item-local failures."""
    _, root_fd = _pin_absolute_directory(root, "input root", create=False)
    limits = _limits(config)
    outcomes: list[SourceDescriptor | _DiscoveryFailure] = []
    seen_inode: set[tuple[int, int]] = set()
    seen_digest: dict[str, str] = {}
    total = 0
    try:
        for item in manifest.items:
            if item.rights == "denied":
                outcomes.append(_DiscoveryFailure(item, "policy_denied"))
                continue
            descriptor = -1
            try:
                _reject_links(root / item.path)
                descriptor = _open_regular_beneath(root_fd, item.path, "source")
                before = os.fstat(descriptor)
                identity = (before.st_dev, before.st_ino)
                if before.st_nlink != 1 or identity in seen_inode:
                    raise _ItemFailure("unsafe_source")
                if before.st_size <= 0 or before.st_size > limits["max_file_bytes"]:
                    raise _ItemFailure("size_limit")
                candidate_total = total + before.st_size
                if candidate_total > limits["max_aggregate_bytes"]:
                    raise _ItemFailure("aggregate_limit")
                digest, prefix, count = _hash_fd(descriptor, before.st_size, "source")
                if count != before.st_size or _identity_changed(before, os.fstat(descriptor)):
                    raise _ItemFailure("source_changed")
                signature = _signature(prefix)
                if signature is None:
                    raise _ItemFailure("unsupported_format")
                duplicate_of = seen_digest.get(digest)
                seen_inode.add(identity)
                seen_digest.setdefault(digest, item.path)
                total = candidate_total
                outcomes.append(SourceDescriptor(item, before.st_size, digest, signature, duplicate_of))
            except _ItemFailure as exc:
                outcomes.append(_DiscoveryFailure(item, exc.reason))
            except BatchContractError:
                outcomes.append(_DiscoveryFailure(item, "unsafe_source"))
            except OSError:
                outcomes.append(_DiscoveryFailure(item, "unsafe_source"))
            finally:
                if descriptor >= 0:
                    os.close(descriptor)
    finally:
        os.close(root_fd)
    return tuple(outcomes)


def _read_source(root: Path, descriptor: SourceDescriptor) -> bytes:
    root_fd = _open_directory_no_follow(root, "input root")
    try:
        fd = _open_regular_beneath(root_fd, descriptor.item.path, "source")
    finally:
        os.close(root_fd)
    try:
        before = os.fstat(fd)
        if before.st_nlink != 1 or before.st_size != descriptor.size:
            raise _ItemFailure("source_changed")
        content = bytearray()
        digest = hashlib.sha256()
        while len(content) < descriptor.size:
            part = os.read(fd, min(READ_CHUNK_BYTES, descriptor.size - len(content)))
            if not part or len(part) > descriptor.size - len(content):
                raise _ItemFailure("source_changed")
            content.extend(part)
            digest.update(part)
        if (
            os.read(fd, 1)
            or digest.hexdigest() != descriptor.sha256
            or _signature(bytes(content[:16])) != descriptor.signature
            or _identity_changed(before, os.fstat(fd))
        ):
            raise _ItemFailure("source_changed")
        return bytes(content)
    finally:
        os.close(fd)


def _chunk(source: str, page: int, region: str, method: str, text: str, confidence: float) -> Any:
    from .extraction import ExtractedChunk
    identity = f"{source}\0{page}\0{region}\0{method}\0{text}"
    return ExtractedChunk(source, page, region, method, text, confidence,
                          hashlib.sha256(identity.encode("utf-8")).hexdigest())


def _split_native_text(text: str) -> tuple[tuple[int, str], ...]:
    result: list[tuple[int, str]] = []
    start = 0
    while start < len(text):
        end = start
        encoded = 0
        while end < len(text):
            width = len(text[end].encode("utf-8"))
            if encoded + width > 16_384:
                break
            encoded += width
            end += 1
        if end == start:
            raise _ItemFailure("invalid_extraction")
        result.append((start, text[start:end]))
        start = end
    return tuple(result)


def _batch_chunks(value: Any) -> tuple[Any, ...]:
    from .extraction import ExtractedChunk
    from .knowledge_index import IndexError, validate_chunks
    from .production_extraction import PdfExtraction, RasterExtraction
    result: list[ExtractedChunk] = []
    if isinstance(value, (tuple, list)) and all(type(item) is ExtractedChunk for item in value):
        result.extend(value)
    elif type(value) is PdfExtraction:
        for page in value.pages:
            if page.method == "ocr":
                for word in page.ocr_words:
                    result.append(_chunk(page.source_sha256, page.page,
                        f"pixels:{word.left},{word.top},{word.width},{word.height}",
                        "ocr", word.text, word.confidence))
            else:
                for offset, text in _split_native_text(page.text):
                    result.append(_chunk(page.source_sha256, page.page,
                        f"text:{offset},0,{len(text)}", "pdf-text", text, 1.0))
    elif type(value) is RasterExtraction:
        for word in value.words:
            result.append(_chunk(value.source_sha256, 1,
                f"pixels:{word.left},{word.top},{word.width},{word.height}",
                "ocr", word.text, word.confidence))
    else:
        raise _ItemFailure("invalid_extraction")
    try:
        return validate_chunks(tuple(result))
    except IndexError as exc:
        raise _ItemFailure("invalid_extraction") from exc


def _cache_binding(
    descriptor: SourceDescriptor,
    config_digest: str,
    extractor_digest: str,
) -> dict[str, Any]:
    return {
        "config_sha256": config_digest,
        "data_class": descriptor.item.data_class,
        "extractor_sha256": extractor_digest,
        "languages": list(descriptor.item.languages),
        "rights": descriptor.item.rights,
        "source_sha256": descriptor.sha256,
    }


def _chunk_dicts(chunks: tuple[Any, ...]) -> list[dict[str, Any]]:
    return [{field: getattr(chunk, field) for field in sorted(_CHUNK_FIELDS)} for chunk in chunks]


def _cache_record(binding: Mapping[str, Any], chunks: tuple[Any, ...]) -> dict[str, Any]:
    return {"binding": dict(binding), "chunks": _chunk_dicts(chunks), "schema_version": _CACHE_SCHEMA}


def _record_digest(value: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_json(dict(value))).hexdigest()


def _read_record(directory: Path, name: str, maximum: int, label: str) -> bytes:
    if not re.fullmatch(r"[0-9a-f]{64}\.json", name):
        raise _CacheFailure(label + " name is invalid")
    root, directory_fd = _pin_absolute_directory(directory, label + " directory", create=False)
    try:
        raw = _read_checkpoint_at(directory_fd, name, maximum)
        if not _same_directory_identity(root, directory_fd):
            raise _CacheFailure(label + " directory changed")
        return raw
    except BatchContractError as exc:
        raise _CacheFailure(label + " is invalid") from exc
    finally:
        os.close(directory_fd)


def _load_cache(
    directory: Path,
    binding: Mapping[str, Any],
) -> tuple[tuple[Any, ...], str] | None:
    binding_digest = _record_digest(binding)
    path = directory / (binding_digest + ".json")
    try:
        os.lstat(path)
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise _CacheFailure("cache is invalid") from exc
    raw = _read_record(directory, path.name, _MAX_CACHE_BYTES, "cache")
    try:
        value = _strict_json(raw)
    except BatchContractError as exc:
        raise _CacheFailure("cache is invalid") from exc
    if (
        not isinstance(value, dict)
        or set(value) != {"binding", "chunks", "schema_version"}
        or value["schema_version"] != _CACHE_SCHEMA
        or value["binding"] != dict(binding)
        or not isinstance(value["chunks"], list)
        or len(value["chunks"]) > 10_000
    ):
        raise _CacheFailure("cache binding is invalid")
    from .extraction import ExtractedChunk
    try:
        if any(not isinstance(item, dict) or set(item) != _CHUNK_FIELDS for item in value["chunks"]):
            raise TypeError
        chunks = _batch_chunks(tuple(ExtractedChunk(**item) for item in value["chunks"]))
    except (TypeError, ValueError) as exc:
        raise _CacheFailure("cache chunks are invalid") from exc
    return chunks, hashlib.sha256(raw).hexdigest()


def _publish_named_record(directory: Path, name: str, value: Mapping[str, Any], label: str) -> tuple[Path, str]:
    payload = canonical_json(dict(value))
    maximum = _MAX_CACHE_BYTES if label == "cache" else 16 * 1024
    if not payload or len(payload) > maximum:
        raise _CacheFailure(label + " is outside byte bound")
    root, directory_fd = _pin_absolute_directory(directory, label + " directory", create=True)
    temporary_name: str | None = None
    try:
        temporary_name, descriptor = _create_checkpoint_temporary(directory_fd)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary_name, name, src_dir_fd=directory_fd,
                    dst_dir_fd=directory_fd, follow_symlinks=False)
        except FileExistsError:
            if _read_checkpoint_at(directory_fd, name, len(payload)) != payload:
                raise _CacheFailure(label + " digest conflict")
        os.unlink(temporary_name, dir_fd=directory_fd)
        temporary_name = None
        os.fsync(directory_fd)
        if not _same_directory_identity(root, directory_fd):
            raise _CacheFailure(label + " directory changed")
    except BatchContractError:
        raise
    except OSError as exc:
        raise _CacheFailure(label + " publication failed") from exc
    finally:
        if temporary_name is not None:
            try:
                os.unlink(temporary_name, dir_fd=directory_fd)
            except FileNotFoundError:
                pass
        os.close(directory_fd)
    return root / name, hashlib.sha256(payload).hexdigest()


def _production_extractor(
    source: bytes,
    descriptor: SourceDescriptor,
    config: Mapping[str, Any],
    toolchain: ProductionToolchain,
) -> Any:
    from .production_extraction import extract_pdf, extract_raster
    if descriptor.signature == "pdf":
        return extract_pdf(
            source, descriptor, config=config,
            pdfinfo_executable=toolchain.pdfinfo,
            pdftotext_executable=toolchain.pdftotext,
            pdftoppm_executable=toolchain.pdftoppm,
            poppler_version=toolchain.poppler_version,
            ocr_executable=toolchain.tesseract,
            languages=descriptor.item.languages,
            installed_languages=toolchain.languages,
            tesseract_version=toolchain.tesseract_version,
        )
    return extract_raster(
        source, descriptor, config=config, executable=toolchain.tesseract,
        languages=descriptor.item.languages,
        installed_languages=toolchain.languages,
        tool_version=toolchain.tesseract_version,
    )


def _safe_reason(exc: Exception) -> str:
    from .knowledge_index import IndexError
    from .production_extraction import ProductionExtractionError
    if isinstance(exc, _ItemFailure):
        return exc.reason
    if isinstance(exc, _CacheFailure):
        return "invalid_cache"
    if isinstance(exc, IndexError):
        return "index_failed"
    if isinstance(exc, ProductionExtractionError):
        return "extraction_failed"
    return "extraction_failed"


def run_batch(
    manifest_path: os.PathLike[str] | str,
    input_root: os.PathLike[str] | str,
    *,
    config_path: os.PathLike[str] | str = "config/document-ingestion.json",
    state_root: os.PathLike[str] | str | None = None,
    extractor: Callable[[bytes, SourceDescriptor, Mapping[str, Any]], Any] | None = None,
    extractor_binding_sha256: str | None = None,
    toolchain: ProductionToolchain | None = None,
    interrupt_after_index: Callable[[SourceDescriptor], None] | None = None,
) -> Mapping[str, Any]:
    config = load_config(config_path)
    manifest = validate_manifest(manifest_path, config)
    root, root_fd = _pin_absolute_directory(input_root, "input root", create=False)
    os.close(root_fd)
    if extractor is None:
        if type(toolchain) is not ProductionToolchain:
            raise BatchContractError("production toolchain is not configured")
        _verify_toolchain(toolchain)
        extractor_digest = toolchain.digest
    else:
        if toolchain is not None or not isinstance(extractor_binding_sha256, str) or not _HASH.fullmatch(extractor_binding_sha256):
            raise BatchContractError("test extractor binding is invalid")
        extractor_digest = extractor_binding_sha256
    state = Path(state_root) if state_root is not None else root / ".ice-maker" / "knowledge"
    state, state_fd = _pin_absolute_directory(state, "state root", create=True)
    os.close(state_fd)
    config_digest = hashlib.sha256(canonical_json(_plain_config(config))).hexdigest()
    cache_dir = state / "batch-cache"
    progress_dir = state / "batch-progress"
    index_path = state / "batch-index.sqlite3"
    records: list[dict[str, Any]] = []
    for outcome in _discover_for_batch(manifest, root, config):
        if type(outcome) is _DiscoveryFailure:
            records.append({"path": outcome.item.path, "status": "rejected", "reason": outcome.reason})
            continue
        descriptor = outcome
        item = descriptor.item
        if descriptor.duplicate_of is not None:
            records.append({"path": item.path, "status": "duplicate", "sha256": descriptor.sha256,
                            "duplicate_of": descriptor.duplicate_of})
            continue
        try:
            binding = _cache_binding(descriptor, config_digest, extractor_digest)
            cached = _load_cache(cache_dir, binding)
            if cached is None:
                source = _read_source(root, descriptor)
                evidence = (
                    extractor(source, descriptor, config)
                    if extractor is not None
                    else _production_extractor(source, descriptor, config, toolchain)
                )
                chunks = _batch_chunks(evidence)
                record = _cache_record(binding, chunks)
                cache_name = _record_digest(binding) + ".json"
                _, cache_digest = _publish_named_record(cache_dir, cache_name, record, "cache")
            else:
                chunks, cache_digest = cached
            index_value = {
                "chunk_ids": [chunk.chunk_id for chunk in chunks],
                "schema_version": "knowledge-index.v1",
                "source_sha256": descriptor.sha256,
            }
            index_digest = _record_digest(index_value)
            progress = {
                "cache_sha256": cache_digest,
                "config_sha256": config_digest,
                "extractor_sha256": extractor_digest,
                "index_sha256": index_digest,
                "item_path": item.path,
                "manifest_sha256": manifest.digest,
                "schema_version": _PROGRESS_SCHEMA,
                "source_sha256": descriptor.sha256,
                "status": "processed",
            }
            progress_name = _record_digest(progress) + ".json"
            progress_path = progress_dir / progress_name
            try:
                os.lstat(progress_path)
            except FileNotFoundError:
                pass
            except OSError as exc:
                raise _CacheFailure("progress is invalid") from exc
            else:
                if _read_record(progress_dir, progress_name, 16 * 1024, "progress") != canonical_json(progress):
                    raise _CacheFailure("progress is invalid")
            from .knowledge_index import KnowledgeIndex
            with KnowledgeIndex(index_path) as index:
                index.index_chunks(chunks)
            if interrupt_after_index is not None:
                interrupt_after_index(descriptor)
            _publish_named_record(progress_dir, progress_name, progress, "progress")
            records.append({"path": item.path, "status": "processed", "sha256": descriptor.sha256})
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception as exc:
            records.append({"path": item.path, "status": "failed", "reason": _safe_reason(exc)})
    return json.loads(result_bytes(make_result(manifest, records)).decode("ascii"))
