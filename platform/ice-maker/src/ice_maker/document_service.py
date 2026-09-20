"""Loopback-only durable upload surface for production document batches."""

import argparse
import ctypes
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import threading
import time
import unicodedata
from typing import Any, Callable, Mapping

from .document_batch import (
    BatchContractError,
    ProductionToolchain,
    canonical_json,
    load_config,
    result_bytes,
    run_batch,
    validate_manifest,
)
from .knowledge_index import (
    IndexError as KnowledgeIndexError,
    IndexLimitError,
    KnowledgeIndex,
)
from .readable_results import (
    MAX_LISTING_BYTES,
    ReadableResultError,
    ReadableResultTooLarge,
    render_html,
    render_markdown,
    source_metadata,
)


class ServiceError(ValueError):
    """A stable, non-echoing service boundary failure."""


_HASH = re.compile(r"^[0-9a-f]{64}$")
_LANGUAGE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
_ATTEMPT = re.compile(r"^[0-9]{6}$")
_SOURCE_NAME = re.compile(r"^[0-9]{3}$")
_SOURCE_PATH = re.compile(r"^sources/[0-9]{3}$")
_CHUNK = 64 * 1024
_MAX_NAME_CHARS = 128
_MAX_NAME_BYTES = 512
_MAX_METADATA_BYTES = 256 * 1024
_MAX_STATE_BYTES = 4 * 1024 * 1024
_MAX_PROGRESS_RECORDS = 1_000_000
_MAX_PROGRESS_BYTES = 16 * 1024
_UPLOAD_SCHEMA = "document-service-upload.v1"
_RENAME_NOREPLACE = 1
_DIRECTORY_FLAGS = (
    os.O_RDONLY
    | getattr(os, "O_DIRECTORY", 0)
    | getattr(os, "O_NOFOLLOW", 0)
    | getattr(os, "O_CLOEXEC", 0)
)
_FILE_FLAGS = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)


def _fail(condition: bool, reason: str) -> None:
    if condition:
        raise ServiceError(reason)


def _absolute_path(value: os.PathLike[str] | str) -> Path:
    try:
        raw = os.fspath(value)
    except TypeError as exc:
        raise ServiceError("state_root_invalid") from exc
    if (
        not isinstance(raw, str)
        or not raw
        or "\x00" in raw
        or "\\" in raw
        or not os.path.isabs(raw)
        or raw != Path(raw).as_posix()
        or Path(raw) == Path(Path(raw).anchor)
        or ".." in Path(raw).parts
    ):
        raise ServiceError("state_root_invalid")
    return Path(raw)


def _open_root(path: Path, *, create: bool) -> int:
    if not getattr(os, "O_NOFOLLOW", 0) or not getattr(os, "O_DIRECTORY", 0):
        raise ServiceError("state_root_unsupported")
    descriptor = None
    try:
        descriptor = os.open(path.anchor, _DIRECTORY_FLAGS)
        for component in path.parts[1:]:
            try:
                next_descriptor = os.open(component, _DIRECTORY_FLAGS, dir_fd=descriptor)
            except FileNotFoundError:
                if not create:
                    raise
                try:
                    os.mkdir(component, 0o700, dir_fd=descriptor)
                except FileExistsError:
                    pass
                next_descriptor = os.open(component, _DIRECTORY_FLAGS, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = next_descriptor
        return descriptor
    except OSError as exc:
        if descriptor is not None:
            os.close(descriptor)
        raise ServiceError("state_root_unsafe") from exc


def _open_directory(parent_fd: int, name: str, *, create: bool = False) -> int:
    try:
        if create:
            try:
                os.mkdir(name, 0o700, dir_fd=parent_fd)
            except FileExistsError:
                pass
        return os.open(name, _DIRECTORY_FLAGS, dir_fd=parent_fd)
    except OSError as exc:
        raise ServiceError("state_invalid") from exc


def _make_directory(parent_fd: int, name: str) -> int:
    try:
        os.mkdir(name, 0o700, dir_fd=parent_fd)
        return os.open(name, _DIRECTORY_FLAGS, dir_fd=parent_fd)
    except OSError as exc:
        raise ServiceError("state_write_failed") from exc


def _identity_changed(before: os.stat_result, after: os.stat_result) -> bool:
    return any(
        getattr(before, field) != getattr(after, field)
        for field in ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
    )


def _read_at(directory_fd: int, name: str, maximum: int, *, expected_size: int | None = None) -> bytes:
    try:
        descriptor = os.open(name, _FILE_FLAGS, dir_fd=directory_fd)
    except OSError as exc:
        raise ServiceError("state_invalid") from exc
    try:
        before = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_nlink != 1
            or before.st_size <= 0
            or before.st_size > maximum
            or (expected_size is not None and before.st_size != expected_size)
        ):
            raise ServiceError("state_invalid")
        content = bytearray()
        while len(content) < before.st_size:
            part = os.read(descriptor, min(_CHUNK, before.st_size - len(content)))
            if not part:
                raise ServiceError("state_invalid")
            content.extend(part)
        if os.read(descriptor, 1) or _identity_changed(before, os.fstat(descriptor)):
            raise ServiceError("state_invalid")
        return bytes(content)
    finally:
        os.close(descriptor)


def _hash_at(directory_fd: int, name: str, expected_size: int) -> str:
    try:
        descriptor = os.open(name, _FILE_FLAGS, dir_fd=directory_fd)
    except OSError as exc:
        raise ServiceError("state_invalid") from exc
    try:
        before = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_nlink != 1
            or before.st_size != expected_size
        ):
            raise ServiceError("state_invalid")
        digest = hashlib.sha256()
        count = 0
        while count < expected_size:
            part = os.read(descriptor, min(_CHUNK, expected_size - count))
            if not part:
                raise ServiceError("state_invalid")
            digest.update(part)
            count += len(part)
        if os.read(descriptor, 1) or _identity_changed(before, os.fstat(descriptor)):
            raise ServiceError("state_invalid")
        return digest.hexdigest()
    finally:
        os.close(descriptor)


def _strict_json(raw: bytes, reason: str) -> dict[str, Any]:
    duplicate = False

    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        nonlocal duplicate
        value: dict[str, Any] = {}
        for key, item in items:
            if key in value:
                duplicate = True
            value[key] = item
        return value

    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ServiceError(reason) from exc
    try:
        canonical = canonical_json(value)
    except BatchContractError as exc:
        raise ServiceError(reason) from exc
    if duplicate or not isinstance(value, dict) or canonical != raw:
        raise ServiceError(reason)
    return value


def _write_all(descriptor: int, payload: bytes) -> None:
    position = 0
    while position < len(payload):
        written = os.write(descriptor, payload[position:])
        if written <= 0:
            raise OSError("short write")
        position += written


def _write_new(directory_fd: int, name: str, payload: bytes) -> None:
    descriptor = None
    try:
        descriptor = os.open(
            name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            0o600,
            dir_fd=directory_fd,
        )
        _write_all(descriptor, payload)
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = None
    except OSError as exc:
        if descriptor is not None:
            os.close(descriptor)
        try:
            os.unlink(name, dir_fd=directory_fd)
        except OSError:
            pass
        raise ServiceError("state_write_failed") from exc


def _publish_at(directory_fd: int, name: str, value: Mapping[str, Any]) -> None:
    payload = canonical_json(dict(value))
    temporary = ".event-" + secrets.token_hex(16)
    _write_new(directory_fd, temporary, payload)
    try:
        try:
            os.link(
                temporary, name,
                src_dir_fd=directory_fd, dst_dir_fd=directory_fd,
                follow_symlinks=False,
            )
        except FileExistsError:
            if _read_at(directory_fd, name, len(payload)) != payload:
                raise ServiceError("state_conflict")
        os.unlink(temporary, dir_fd=directory_fd)
        temporary = ""
        os.fsync(directory_fd)
    except ServiceError:
        raise
    except OSError as exc:
        raise ServiceError("state_write_failed") from exc
    finally:
        if temporary:
            try:
                os.unlink(temporary, dir_fd=directory_fd)
            except OSError:
                pass


def _rename_noreplace(source_fd: int, source: str, target_fd: int, target: str) -> None:
    try:
        function = ctypes.CDLL(None, use_errno=True).renameat2
    except (AttributeError, OSError) as exc:
        raise ServiceError("atomic_publish_unsupported") from exc
    function.argtypes = (
        ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint,
    )
    function.restype = ctypes.c_int
    if function(
        source_fd, source.encode("ascii"), target_fd, target.encode("ascii"),
        _RENAME_NOREPLACE,
    ):
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))


def _safe_name(value: object) -> str:
    if not isinstance(value, str) or not value or value.strip() != value:
        raise ServiceError("filename_invalid")
    try:
        encoded = value.encode("utf-8")
    except UnicodeError as exc:
        raise ServiceError("filename_invalid") from exc
    if (
        len(value) > _MAX_NAME_CHARS
        or len(encoded) > _MAX_NAME_BYTES
        or unicodedata.normalize("NFKC", value) != value
        or value in {".", ".."}
        or "/" in value
        or "\\" in value
        or Path(value).is_absolute()
    ):
        raise ServiceError("filename_invalid")
    for character in value:
        if not character.isprintable() or unicodedata.category(character) in {"Cc", "Cf", "Cs"}:
            raise ServiceError("filename_invalid")
    return value


def _parse_metadata(raw: str | None, names: tuple[str, ...], maximum_size: int) -> tuple[dict[str, Any], ...]:
    if not isinstance(raw, str):
        raise ServiceError("metadata_required")
    try:
        encoded = raw.encode("utf-8")
    except UnicodeError as exc:
        raise ServiceError("metadata_invalid") from exc
    if not encoded or len(encoded) > _MAX_METADATA_BYTES:
        raise ServiceError("metadata_invalid")
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
        value = json.loads(raw, object_pairs_hook=pairs)
    except json.JSONDecodeError as exc:
        raise ServiceError("metadata_invalid") from exc
    if duplicate or not isinstance(value, list) or len(value) != len(names):
        raise ServiceError("metadata_invalid")
    result = []
    for expected_name, item in zip(names, value):
        if not isinstance(item, dict) or set(item) != {
            "data_class", "languages", "name", "rights", "size",
        }:
            raise ServiceError("metadata_invalid")
        if item["name"] != expected_name:
            raise ServiceError("metadata_invalid")
        if item["rights"] not in {"confirmed", "unconfirmed", "denied"}:
            raise ServiceError("metadata_invalid")
        if item["data_class"] not in {"public", "internal", "confidential", "restricted"}:
            raise ServiceError("metadata_invalid")
        languages = item["languages"]
        if (
            not isinstance(languages, list)
            or not 1 <= len(languages) <= 16
            or languages != sorted(set(languages))
            or any(not isinstance(language, str) or not _LANGUAGE.fullmatch(language) for language in languages)
        ):
            raise ServiceError("metadata_invalid")
        if type(item["size"]) is not int or not 0 < item["size"] <= maximum_size:
            raise ServiceError("metadata_invalid")
        result.append(dict(item))
    return tuple(result)


def _signature(prefix: bytes) -> bool:
    return (
        prefix.startswith(b"%PDF-")
        or prefix.startswith(b"\x89PNG\r\n\x1a\n")
        or prefix.startswith(b"\xff\xd8\xff")
        or (prefix.startswith(b"RIFF") and len(prefix) >= 12 and prefix[8:12] == b"WEBP")
    )


def _copy_upload(
    stream: Any,
    sources_fd: int,
    name: str,
    declared_size: int,
    per_file_limit: int,
    aggregate_so_far: int,
    aggregate_limit: int,
) -> tuple[int, str]:
    descriptor = None
    size = 0
    prefix = bytearray()
    digest = hashlib.sha256()
    try:
        descriptor = os.open(
            name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            0o600,
            dir_fd=sources_fd,
        )
        while True:
            try:
                chunk = stream.read(_CHUNK)
            except BaseException as exc:
                raise ServiceError("upload_incomplete") from exc
            if chunk == b"":
                break
            if not isinstance(chunk, bytes) or len(chunk) > _CHUNK:
                raise ServiceError("upload_incomplete")
            size += len(chunk)
            if size > per_file_limit or aggregate_so_far + size > aggregate_limit:
                raise ServiceError("upload_limit")
            if len(prefix) < 16:
                prefix.extend(chunk[:16 - len(prefix)])
            digest.update(chunk)
            _write_all(descriptor, chunk)
        if size != declared_size:
            raise ServiceError("upload_size_mismatch")
        if not _signature(bytes(prefix)):
            raise ServiceError("upload_format_invalid")
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = None
        return size, digest.hexdigest()
    except ServiceError:
        raise
    except OSError as exc:
        raise ServiceError("upload_incomplete") from exc
    finally:
        if descriptor is not None:
            os.close(descriptor)
            try:
                os.unlink(name, dir_fd=sources_fd)
            except OSError:
                pass


def _event(batch_id: str, attempt: int, status_value: str) -> dict[str, Any]:
    return {"attempt": attempt, "batch_id": batch_id, "status": status_value}


def _zero_counts() -> dict[str, int]:
    return {"duplicate": 0, "failed": 0, "processed": 0, "rejected": 0}


class DurableBatchService:
    """Single-process owner of content-addressed local upload and job state."""

    def __init__(
        self,
        state_root: os.PathLike[str] | str,
        *,
        config_path: os.PathLike[str] | str = "config/document-ingestion.json",
        runner: Callable[..., Mapping[str, Any]] | None = None,
        runner_kwargs: Mapping[str, Any] | None = None,
        _start_workers: bool = True,
    ) -> None:
        self.config = load_config(config_path)
        self.config_path = config_path
        self.runner = runner or run_batch
        self.runner_kwargs = dict(runner_kwargs or {})
        self.root = _absolute_path(state_root)
        self._root_fd = _open_root(self.root, create=True)
        self._batches_fd = self._lock_fd = None
        self._mutex = threading.RLock()
        self._active: dict[str, threading.Thread] = {}
        self._closed = False
        self._closing = False
        self._start_workers = bool(_start_workers)
        try:
            self._batches_fd = _open_directory(self._root_fd, "batches", create=True)
            self._lock_fd = os.open(
                ".service.lock",
                os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0),
                0o600,
                dir_fd=self._root_fd,
            )
            lock_info = os.fstat(self._lock_fd)
            if not stat.S_ISREG(lock_info.st_mode) or lock_info.st_nlink != 1:
                raise ServiceError("state_root_unsafe")
            try:
                fcntl.flock(self._lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                raise ServiceError("state_root_in_use") from exc
            self._assert_root()
            if self._start_workers:
                self._recover_abandoned()
                self.kick()
        except BaseException:
            self._close_descriptors()
            raise

    def _close_descriptors(self) -> None:
        for attribute in ("_lock_fd", "_batches_fd", "_root_fd"):
            descriptor = getattr(self, attribute, None)
            if descriptor is not None:
                try:
                    os.close(descriptor)
                except OSError:
                    pass
                setattr(self, attribute, None)

    def _assert_open(self) -> None:
        if self._closed:
            raise ServiceError("service_closed")

    def _assert_root(self) -> None:
        self._assert_open()
        try:
            current = _open_root(self.root, create=False)
        except ServiceError as exc:
            raise ServiceError("state_root_changed") from exc
        try:
            expected, actual = os.fstat(self._root_fd), os.fstat(current)
            if (expected.st_dev, expected.st_ino) != (actual.st_dev, actual.st_ino):
                raise ServiceError("state_root_changed")
        finally:
            os.close(current)

    def _remove_stage(self, stage: str) -> None:
        try:
            stage_fd = os.open(stage, _DIRECTORY_FLAGS, dir_fd=self._root_fd)
        except OSError:
            return
        sources_fd = attempts_fd = attempt_fd = None
        try:
            try:
                sources_fd = os.open("sources", _DIRECTORY_FLAGS, dir_fd=stage_fd)
                for name in os.listdir(sources_fd):
                    if _SOURCE_NAME.fullmatch(name):
                        try:
                            os.unlink(name, dir_fd=sources_fd)
                        except OSError:
                            pass
            except OSError:
                pass
            try:
                attempts_fd = os.open("attempts", _DIRECTORY_FLAGS, dir_fd=stage_fd)
                attempt_fd = os.open("000000", _DIRECTORY_FLAGS, dir_fd=attempts_fd)
                for name in ("queued.json", "running.json", "failed.json"):
                    try:
                        os.unlink(name, dir_fd=attempt_fd)
                    except OSError:
                        pass
            except OSError:
                pass
            finally:
                if attempt_fd is not None:
                    os.close(attempt_fd)
                if attempts_fd is not None:
                    try:
                        os.rmdir("000000", dir_fd=attempts_fd)
                    except OSError:
                        pass
                    os.close(attempts_fd)
                if sources_fd is not None:
                    os.close(sources_fd)
            for name in ("manifest.json", "upload.json"):
                try:
                    os.unlink(name, dir_fd=stage_fd)
                except OSError:
                    pass
            for name in ("sources", "attempts"):
                try:
                    os.rmdir(name, dir_fd=stage_fd)
                except OSError:
                    pass
        finally:
            os.close(stage_fd)
        try:
            os.rmdir(stage, dir_fd=self._root_fd)
        except OSError:
            pass

    def _open_batch(self, batch_id: str) -> int:
        if not isinstance(batch_id, str) or not _HASH.fullmatch(batch_id):
            raise ServiceError("batch_not_found")
        self._assert_root()
        try:
            return os.open(batch_id, _DIRECTORY_FLAGS, dir_fd=self._batches_fd)
        except OSError as exc:
            raise ServiceError("batch_not_found") from exc

    def _load_batch(
        self,
        batch_id: str,
        *,
        verify_sources: bool = False,
        expected_manifest: bytes | None = None,
        expected_upload: bytes | None = None,
    ) -> tuple[int, Any, dict[str, Any]]:
        batch_fd = self._open_batch(batch_id)
        sources_fd = None
        try:
            allowed = {"attempts", "manifest.json", "sources", "upload.json"}
            names = set(os.listdir(batch_fd))
            if not names <= allowed | {"result.json"} or not allowed <= names:
                raise ServiceError("state_invalid")
            manifest_raw = _read_at(batch_fd, "manifest.json", _MAX_STATE_BYTES)
            upload_raw = _read_at(batch_fd, "upload.json", _MAX_STATE_BYTES)
            manifest = validate_manifest(manifest_raw, self.config)
            upload = _strict_json(upload_raw, "state_invalid")
            if set(upload) != {"batch_id", "files", "manifest_sha256", "schema_version"}:
                raise ServiceError("state_invalid")
            if (
                upload["schema_version"] != _UPLOAD_SCHEMA
                or upload["batch_id"] != batch_id
                or upload["manifest_sha256"] != manifest.digest
                or not isinstance(upload["files"], list)
                or len(upload["files"]) != len(manifest.items)
            ):
                raise ServiceError("state_invalid")
            paths = []
            for item in upload["files"]:
                if (
                    not isinstance(item, dict)
                    or set(item) != {"path", "sha256", "size"}
                    or not isinstance(item["path"], str)
                    or not isinstance(item["sha256"], str)
                    or not _HASH.fullmatch(item["sha256"])
                    or type(item["size"]) is not int
                    or not 0 < item["size"] <= self.config["limits"]["max_file_bytes"]
                ):
                    raise ServiceError("state_invalid")
                paths.append(item["path"])
            if paths != [item.path for item in manifest.items]:
                raise ServiceError("state_invalid")
            identity = {
                "files": upload["files"],
                "manifest_sha256": manifest.digest,
                "schema_version": _UPLOAD_SCHEMA,
            }
            if hashlib.sha256(canonical_json(identity)).hexdigest() != batch_id:
                raise ServiceError("state_invalid")
            sources_fd = os.open("sources", _DIRECTORY_FLAGS, dir_fd=batch_fd)
            source_names = {path.rsplit("/", 1)[-1] for path in paths}
            if set(os.listdir(sources_fd)) != source_names:
                raise ServiceError("state_invalid")
            for item in upload["files"]:
                source_name = item["path"].rsplit("/", 1)[-1]
                if not _SOURCE_NAME.fullmatch(source_name):
                    raise ServiceError("state_invalid")
                descriptor = os.open(source_name, _FILE_FLAGS, dir_fd=sources_fd)
                try:
                    info = os.fstat(descriptor)
                    if (
                        not stat.S_ISREG(info.st_mode)
                        or info.st_nlink != 1
                        or info.st_size != item["size"]
                    ):
                        raise ServiceError("state_invalid")
                finally:
                    os.close(descriptor)
                if verify_sources:
                    if _hash_at(sources_fd, source_name, item["size"]) != item["sha256"]:
                        raise ServiceError("state_invalid")
            if expected_manifest is not None and manifest_raw != expected_manifest:
                raise ServiceError("batch_conflict")
            if expected_upload is not None and upload_raw != expected_upload:
                raise ServiceError("batch_conflict")
            return batch_fd, manifest, upload
        except (BatchContractError, OSError) as exc:
            os.close(batch_fd)
            raise ServiceError("state_invalid") from exc
        except BaseException:
            os.close(batch_fd)
            raise
        finally:
            if sources_fd is not None:
                os.close(sources_fd)

    def _latest_attempt(self, batch_fd: int, batch_id: str) -> tuple[int, str]:
        try:
            attempts_fd = os.open("attempts", _DIRECTORY_FLAGS, dir_fd=batch_fd)
        except OSError as exc:
            raise ServiceError("state_invalid") from exc
        try:
            names = sorted(os.listdir(attempts_fd))
            if (
                not names
                or any(not _ATTEMPT.fullmatch(name) for name in names)
                or names != [f"{index:06d}" for index in range(len(names))]
            ):
                raise ServiceError("state_invalid")
            states = []
            for number, name in enumerate(names):
                attempt_fd = os.open(name, _DIRECTORY_FLAGS, dir_fd=attempts_fd)
                try:
                    event_names = set(os.listdir(attempt_fd))
                    if not {"queued.json"} <= event_names <= {
                        "queued.json", "running.json", "failed.json",
                    }:
                        raise ServiceError("state_invalid")
                    if _read_at(attempt_fd, "queued.json", 1024) != canonical_json(
                        _event(batch_id, number, "queued")
                    ):
                        raise ServiceError("state_invalid")
                    state_value = "queued"
                    if "running.json" in event_names:
                        if _read_at(attempt_fd, "running.json", 1024) != canonical_json(
                            _event(batch_id, number, "running")
                        ):
                            raise ServiceError("state_invalid")
                        state_value = "running"
                    if "failed.json" in event_names:
                        if state_value != "running" or _read_at(
                            attempt_fd, "failed.json", 1024,
                        ) != canonical_json(_event(batch_id, number, "failed")):
                            raise ServiceError("state_invalid")
                        state_value = "failed"
                    states.append(state_value)
                finally:
                    os.close(attempt_fd)
            if any(state != "running" for state in states[:-1]):
                raise ServiceError("state_invalid")
            return len(names) - 1, states[-1]
        except OSError as exc:
            raise ServiceError("state_invalid") from exc
        finally:
            os.close(attempts_fd)

    def _create_attempt(self, batch_fd: int, batch_id: str, attempt: int) -> None:
        try:
            attempts_fd = os.open("attempts", _DIRECTORY_FLAGS, dir_fd=batch_fd)
        except OSError as exc:
            raise ServiceError("state_invalid") from exc
        attempt_fd = None
        try:
            attempt_fd = _make_directory(attempts_fd, f"{attempt:06d}")
            _publish_at(attempt_fd, "queued.json", _event(batch_id, attempt, "queued"))
            os.fsync(attempt_fd)
            os.fsync(attempts_fd)
        finally:
            if attempt_fd is not None:
                os.close(attempt_fd)
            os.close(attempts_fd)

    def _write_attempt_event(self, batch_fd: int, batch_id: str, attempt: int, state_value: str) -> None:
        try:
            attempts_fd = os.open("attempts", _DIRECTORY_FLAGS, dir_fd=batch_fd)
            attempt_fd = os.open(
                f"{attempt:06d}", _DIRECTORY_FLAGS, dir_fd=attempts_fd,
            )
        except OSError as exc:
            try:
                os.close(attempts_fd)
            except (OSError, UnboundLocalError):
                pass
            raise ServiceError("state_invalid") from exc
        try:
            _publish_at(
                attempt_fd, state_value + ".json",
                _event(batch_id, attempt, state_value),
            )
        finally:
            os.close(attempt_fd)
            os.close(attempts_fd)

    def _state(self, batch_id: str) -> tuple[str, int, dict[str, int]]:
        batch_fd, manifest, _ = self._load_batch(batch_id)
        try:
            attempt, state_value = self._latest_attempt(batch_fd, batch_id)
            has_result = "result.json" in os.listdir(batch_fd)
            if has_result:
                if state_value == "failed":
                    raise ServiceError("state_invalid")
                raw = _read_at(batch_fd, "result.json", _MAX_STATE_BYTES)
                value = _strict_json(raw, "state_invalid")
                if result_bytes(value) != raw or value["manifest_sha256"] != manifest.digest:
                    raise ServiceError("state_invalid")
                return "completed", attempt, dict(value["counts"])
            return state_value, attempt, _zero_counts()
        except BatchContractError as exc:
            raise ServiceError("state_invalid") from exc
        finally:
            os.close(batch_fd)

    def submit(self, files: list[Any], metadata_raw: str | None = None) -> str:
        with self._mutex:
            self._assert_root()
            if not isinstance(files, (list, tuple)) or not 1 <= len(files) <= self.config["limits"]["max_items"]:
                raise ServiceError("file_count_invalid")
            names = tuple(_safe_name(getattr(upload, "filename", None)) for upload in files)
            folded = tuple(name.casefold() for name in names)
            if len(set(folded)) != len(folded):
                raise ServiceError("filename_duplicate")
            policies = _parse_metadata(
                metadata_raw, names, self.config["limits"]["max_file_bytes"],
            )
            stage = ".upload-" + secrets.token_hex(16)
            stage_fd = sources_fd = attempts_fd = attempt_fd = None
            published = False
            try:
                stage_fd = _make_directory(self._root_fd, stage)
                sources_fd = _make_directory(stage_fd, "sources")
                attempts_fd = _make_directory(stage_fd, "attempts")
                attempt_fd = _make_directory(attempts_fd, "000000")
                total = 0
                file_records = []
                manifest_items = []
                for number, (upload, policy) in enumerate(zip(files, policies)):
                    path = f"sources/{number:03d}"
                    stream = getattr(upload, "file", None)
                    if stream is None or not callable(getattr(stream, "read", None)):
                        raise ServiceError("upload_incomplete")
                    size, source_digest = _copy_upload(
                        stream, sources_fd, f"{number:03d}", policy["size"],
                        self.config["limits"]["max_file_bytes"], total,
                        self.config["limits"]["max_aggregate_bytes"],
                    )
                    total += size
                    file_records.append({
                        "path": path, "sha256": source_digest, "size": size,
                    })
                    manifest_items.append({
                        "data_class": policy["data_class"],
                        "languages": policy["languages"],
                        "path": path,
                        "rights": policy["rights"],
                    })
                manifest_value = {
                    "items": manifest_items,
                    "schema_version": "document-batch-manifest.v1",
                }
                manifest_raw = canonical_json(manifest_value)
                manifest = validate_manifest(manifest_raw, self.config)
                identity = {
                    "files": file_records,
                    "manifest_sha256": manifest.digest,
                    "schema_version": _UPLOAD_SCHEMA,
                }
                batch_id = hashlib.sha256(canonical_json(identity)).hexdigest()
                upload_value = {"batch_id": batch_id, **identity}
                upload_raw = canonical_json(upload_value)
                _write_new(stage_fd, "manifest.json", manifest_raw)
                _write_new(stage_fd, "upload.json", upload_raw)
                _publish_at(attempt_fd, "queued.json", _event(batch_id, 0, "queued"))
                for descriptor in (sources_fd, attempt_fd, attempts_fd, stage_fd):
                    os.fsync(descriptor)
                try:
                    _rename_noreplace(self._root_fd, stage, self._batches_fd, batch_id)
                    stage = ""
                    published = True
                    os.fsync(self._batches_fd)
                    self._assert_root()
                except OSError as exc:
                    if exc.errno != errno.EEXIST:
                        raise ServiceError("state_write_failed") from exc
                    try:
                        existing_fd, _, _ = self._load_batch(
                            batch_id, verify_sources=True,
                            expected_manifest=manifest_raw, expected_upload=upload_raw,
                        )
                    except ServiceError as conflict:
                        raise ServiceError("batch_conflict") from conflict
                    os.close(existing_fd)
                    try:
                        self._state(batch_id)
                    except ServiceError as conflict:
                        raise ServiceError("batch_conflict") from conflict
                    published = True
                if self._start_workers:
                    self.kick()
                return batch_id
            except ServiceError as exc:
                if str(exc) == "state_invalid" and published:
                    raise ServiceError("batch_conflict") from exc
                raise
            finally:
                for descriptor in (attempt_fd, attempts_fd, sources_fd, stage_fd):
                    if descriptor is not None:
                        try:
                            os.close(descriptor)
                        except OSError:
                            pass
                if stage:
                    self._remove_stage(stage)

    def status(self, batch_id: str) -> dict[str, Any]:
        with self._mutex:
            state_value, _, counts = self._state(batch_id)
            result = {"batch_id": batch_id, "counts": counts, "status": state_value}
            if state_value == "failed":
                result["reason"] = "processing_failed"
            return result

    def _readable_members(
        self, batch_id: str
    ) -> tuple[str, tuple[dict[str, Any], ...]]:
        try:
            state_value, _, _ = self._state(batch_id)
        except ServiceError as exc:
            if str(exc) == "batch_not_found":
                raise ServiceError("readable_result_not_found") from exc
            raise ServiceError("readable_state_invalid") from exc
        if state_value != "completed":
            raise ServiceError("readable_result_unavailable")
        batch_fd = None
        try:
            batch_fd, manifest, _ = self._load_batch(batch_id)
            raw = _read_at(batch_fd, "result.json", _MAX_STATE_BYTES)
            result = _strict_json(raw, "state_invalid")
            if (
                result_bytes(result) != raw
                or result["manifest_sha256"] != manifest.digest
            ):
                raise ServiceError("state_invalid")
            processed = tuple(
                dict(item)
                for item in result["items"]
                if item["status"] == "processed"
            )
            if len(processed) > 100:
                raise ServiceError("readable_result_too_large")
            return manifest.digest, processed
        except ServiceError as exc:
            if str(exc) == "readable_result_too_large":
                raise
            raise ServiceError("readable_state_invalid") from exc
        except (BatchContractError, OSError, TypeError, KeyError) as exc:
            raise ServiceError("readable_state_invalid") from exc
        finally:
            if batch_fd is not None:
                os.close(batch_fd)

    @staticmethod
    def _progress_value(raw: bytes, name: str) -> dict[str, str]:
        required = {
            "cache_sha256",
            "config_sha256",
            "extractor_sha256",
            "index_sha256",
            "item_path",
            "manifest_sha256",
            "schema_version",
            "source_sha256",
            "status",
        }
        value = _strict_json(raw, "readable_state_invalid")
        hash_fields = (
            "cache_sha256",
            "config_sha256",
            "extractor_sha256",
            "index_sha256",
            "manifest_sha256",
            "source_sha256",
        )
        if (
            set(value) != required
            or value["schema_version"] != "document-batch-progress.v1"
            or value["status"] != "processed"
            or not isinstance(value["item_path"], str)
            or not _SOURCE_PATH.fullmatch(value["item_path"])
            or any(
                not isinstance(value[field], str)
                or not _HASH.fullmatch(value[field])
                for field in hash_fields
            )
            or hashlib.sha256(raw).hexdigest() + ".json" != name
        ):
            raise ServiceError("readable_state_invalid")
        return value

    def _validate_progress_bindings(
        self,
        manifest_sha256: str,
        members: tuple[dict[str, Any], ...],
        chunks_by_source: Mapping[str, tuple[Any, ...]],
    ) -> None:
        expected: dict[tuple[str, str], str] = {}
        for member in members:
            key = (member["sha256"], member["path"])
            if key in expected:
                raise ServiceError("readable_state_invalid")
            chunks = chunks_by_source.get(member["sha256"])
            if chunks is None:
                raise ServiceError("readable_state_invalid")
            binding = {
                "chunk_ids": [chunk.chunk_id for chunk in chunks],
                "schema_version": "knowledge-index.v1",
                "source_sha256": member["sha256"],
            }
            expected[key] = hashlib.sha256(canonical_json(binding)).hexdigest()

        knowledge_fd = progress_fd = None
        found: set[tuple[str, str]] = set()
        try:
            knowledge_fd = _open_directory(self._root_fd, "knowledge")
            progress_fd = _open_directory(knowledge_fd, "batch-progress")
            count = 0
            with os.scandir(progress_fd) as entries:
                for entry in entries:
                    count += 1
                    if count > _MAX_PROGRESS_RECORDS:
                        raise ServiceError("readable_state_invalid")
                    if not re.fullmatch(r"[0-9a-f]{64}\.json", entry.name):
                        raise ServiceError("readable_state_invalid")
                    value = self._progress_value(
                        _read_at(progress_fd, entry.name, _MAX_PROGRESS_BYTES),
                        entry.name,
                    )
                    key = (value["source_sha256"], value["item_path"])
                    if (
                        value["manifest_sha256"] == manifest_sha256
                        and expected.get(key) == value["index_sha256"]
                    ):
                        found.add(key)
            if found != set(expected):
                raise ServiceError("readable_state_invalid")
        except ServiceError as exc:
            if str(exc) == "readable_state_invalid":
                raise
            raise ServiceError("readable_state_invalid") from exc
        except (OSError, TypeError, KeyError) as exc:
            raise ServiceError("readable_state_invalid") from exc
        finally:
            if progress_fd is not None:
                os.close(progress_fd)
            if knowledge_fd is not None:
                os.close(knowledge_fd)

    def _readable_chunks(
        self,
        manifest_sha256: str,
        members: tuple[dict[str, Any], ...],
    ) -> Mapping[str, tuple[Any, ...]]:
        if not members:
            return {}
        sources = tuple(sorted({member["sha256"] for member in members}))
        if len(sources) != len(members):
            raise ServiceError("readable_state_invalid")
        knowledge_fd = None
        try:
            knowledge_fd = _open_directory(self._root_fd, "knowledge")
            info = os.stat(
                "batch-index.sqlite3",
                dir_fd=knowledge_fd,
                follow_symlinks=False,
            )
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_nlink != 1
                or info.st_size <= 0
            ):
                raise ServiceError("readable_state_invalid")
        except (ServiceError, OSError) as exc:
            raise ServiceError("readable_state_invalid") from exc
        finally:
            if knowledge_fd is not None:
                os.close(knowledge_fd)
        try:
            with KnowledgeIndex(
                self.root / "knowledge" / "batch-index.sqlite3", existing=True
            ) as index:
                chunks = index.read_sources(sources)
            self._validate_progress_bindings(
                manifest_sha256, members, chunks
            )
            return chunks
        except IndexLimitError as exc:
            raise ServiceError("readable_result_too_large") from exc
        except ServiceError:
            raise
        except (KnowledgeIndexError, OSError, TypeError, KeyError) as exc:
            raise ServiceError("readable_state_invalid") from exc

    def readable_documents(self, batch_id: str) -> dict[str, Any]:
        with self._mutex:
            manifest_sha256, members = self._readable_members(batch_id)
            chunks = self._readable_chunks(manifest_sha256, members)
            try:
                documents = sorted(
                    (
                        source_metadata(chunks[member["sha256"]], member["sha256"])
                        for member in members
                    ),
                    key=lambda item: item["source_sha256"],
                )
                result = {"batch_id": batch_id, "documents": documents}
                if len(canonical_json(result)) > MAX_LISTING_BYTES:
                    raise ServiceError("readable_result_too_large")
                return result
            except ReadableResultTooLarge as exc:
                raise ServiceError("readable_result_too_large") from exc
            except (ReadableResultError, BatchContractError, KeyError) as exc:
                raise ServiceError("readable_state_invalid") from exc

    def readable_markdown(self, batch_id: str, source_sha256: str) -> bytes:
        if not isinstance(source_sha256, str) or not _HASH.fullmatch(source_sha256):
            raise ServiceError("readable_result_not_found")
        with self._mutex:
            manifest_sha256, members = self._readable_members(batch_id)
            selected = tuple(
                member for member in members if member["sha256"] == source_sha256
            )
            if len(selected) != 1:
                raise ServiceError("readable_result_not_found")
            chunks = self._readable_chunks(manifest_sha256, selected)
            try:
                return render_markdown(chunks[source_sha256], source_sha256)
            except ReadableResultTooLarge as exc:
                raise ServiceError("readable_result_too_large") from exc
            except (ReadableResultError, KeyError) as exc:
                raise ServiceError("readable_state_invalid") from exc

    def _batch_ids(self) -> tuple[str, ...]:
        self._assert_root()
        try:
            names = sorted(os.listdir(self._batches_fd))
        except OSError as exc:
            raise ServiceError("state_invalid") from exc
        if any(not _HASH.fullmatch(name) for name in names):
            raise ServiceError("state_invalid")
        return tuple(names)

    def _recover_abandoned(self) -> None:
        with self._mutex:
            for batch_id in self._batch_ids():
                state_value, attempt, _ = self._state(batch_id)
                if state_value == "running":
                    batch_fd = self._open_batch(batch_id)
                    try:
                        self._create_attempt(batch_fd, batch_id, attempt + 1)
                    finally:
                        os.close(batch_fd)

    def kick(self) -> None:
        with self._mutex:
            self._assert_open()
            for batch_id in self._batch_ids():
                if len(self._active) >= self.config["limits"]["max_workers"]:
                    break
                if batch_id in self._active:
                    continue
                state_value, attempt, _ = self._state(batch_id)
                if state_value != "queued":
                    continue
                thread = threading.Thread(
                    target=self._work, args=(batch_id, attempt), daemon=True,
                    name="document-batch-worker",
                )
                self._active[batch_id] = thread
                thread.start()

    def _work(self, batch_id: str, attempt: int) -> None:
        batch_fd = None
        try:
            with self._mutex:
                batch_fd = self._open_batch(batch_id)
                self._write_attempt_event(batch_fd, batch_id, attempt, "running")
                os.close(batch_fd)
                batch_fd = None
            batch_path = self.root / "batches" / batch_id
            result = self.runner(
                batch_path / "manifest.json",
                batch_path,
                config_path=self.config_path,
                state_root=self.root / "knowledge",
                **self.runner_kwargs,
            )
            payload = result_bytes(result)
            manifest = validate_manifest(batch_path / "manifest.json", self.config)
            decoded = json.loads(payload.decode("ascii"))
            if decoded["manifest_sha256"] != manifest.digest:
                raise ServiceError("result_binding_invalid")
            with self._mutex:
                batch_fd = self._open_batch(batch_id)
                _publish_at(batch_fd, "result.json", decoded)
                os.close(batch_fd)
                batch_fd = None
        except BaseException:
            try:
                with self._mutex:
                    if batch_fd is None:
                        batch_fd = self._open_batch(batch_id)
                    self._write_attempt_event(batch_fd, batch_id, attempt, "failed")
            except BaseException:
                pass
        finally:
            if batch_fd is not None:
                os.close(batch_fd)
            with self._mutex:
                self._active.pop(batch_id, None)
                if not self._closed and not self._closing:
                    self.kick()

    def wait_until_idle(self, timeout: float = 5.0) -> bool:
        if not isinstance(timeout, (int, float)) or timeout < 0:
            raise ServiceError("timeout_invalid")
        deadline = time.monotonic() + timeout
        while True:
            with self._mutex:
                self._assert_open()
                self.kick()
                threads = tuple(self._active.values())
            if not threads:
                return True
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            threads[0].join(min(0.05, remaining))

    def close(self, timeout: float = 5.0) -> bool:
        with self._mutex:
            if self._closed:
                return True
            self._closing = True
        deadline = time.monotonic() + timeout
        while True:
            with self._mutex:
                threads = tuple(self._active.values())
            if not threads:
                break
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                with self._mutex:
                    self._closing = False
                return False
            threads[0].join(min(0.05, remaining))
        with self._mutex:
            self._closed = True
            self._close_descriptors()
        return True


def validate_bind(host: str) -> str:
    if host not in {"127.0.0.1", "::1"}:
        raise ServiceError("loopback_bind_required")
    return host


_PAGE = """<!doctype html>
<meta charset="utf-8"><title>Ice Maker document upload</title>
<h1>Upload a local document batch</h1>
<form id="upload" method="post" action="/api/batches" enctype="multipart/form-data">
<label>Files <input id="files" type="file" name="files" multiple required></label>
<label>Rights <select id="rights"><option value="unconfirmed">Unconfirmed</option><option value="confirmed">Confirmed</option><option value="denied">Denied</option></select></label>
<label>Data class <select id="data_class"><option value="internal">Internal</option><option value="public">Public</option><option value="confidential">Confidential</option><option value="restricted">Restricted</option></select></label>
<label>OCR languages <input id="languages" value="chi_tra,eng" required></label>
<input id="metadata" type="hidden" name="metadata"><button type="submit">Upload</button>
</form>
<p id="results" aria-live="polite"></p>
<script>document.getElementById('upload').addEventListener('submit',async function(e){e.preventDefault();const out=document.getElementById('results');const l=document.getElementById('languages').value.split(',').filter(Boolean).sort();const r=document.getElementById('rights').value;const d=document.getElementById('data_class').value;document.getElementById('metadata').value=JSON.stringify(Array.from(document.getElementById('files').files).map(f=>({data_class:d,languages:l,name:f.name,rights:r,size:f.size})));const response=await fetch('/api/batches',{method:'POST',body:new FormData(this)});if(!response.ok){out.textContent='Upload failed';return;}const batch=(await response.json()).batch_id;out.textContent='Processing '+batch;const poll=async()=>{const status=await (await fetch('/api/batches/'+batch)).json();if(status.status==='completed'){const answer=await fetch('/api/batches/'+batch+'/documents');if(!answer.ok){out.textContent='Readable results unavailable';return;}const docs=(await answer.json()).documents;out.replaceChildren();for(const doc of docs){const link=document.createElement('a');link.href='/batches/'+batch+'/documents/'+doc.source_sha256;link.textContent=doc.source_sha256;out.append(link,document.createElement('br'));}}else if(status.status==='failed'){out.textContent='Processing failed';}else{setTimeout(poll,500);}};poll();});</script>
"""


def create_app(
    state_root: os.PathLike[str] | str,
    *,
    host: str = "127.0.0.1",
    config_path: os.PathLike[str] | str = "config/document-ingestion.json",
    runner: Callable[..., Mapping[str, Any]] | None = None,
    runner_kwargs: Mapping[str, Any] | None = None,
    _start_workers: bool = True,
) -> Any:
    validate_bind(host)
    try:
        from fastapi import FastAPI, File, Form, HTTPException, UploadFile
        from fastapi.exceptions import RequestValidationError
        from fastapi.responses import HTMLResponse, JSONResponse, Response
    except ImportError as exc:
        raise RuntimeError("document service extras are required") from exc
    service = DurableBatchService(
        state_root, config_path=config_path, runner=runner,
        runner_kwargs=runner_kwargs, _start_workers=_start_workers,
    )
    app = FastAPI(title="Ice Maker local document service")
    app.state.document_service = service

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request: Any, _exc: Any) -> Any:
        return JSONResponse(status_code=400, content={"detail": "request_invalid"})

    @app.get("/healthz")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/", response_class=HTMLResponse)
    def page() -> str:
        return _PAGE

    @app.post("/api/batches", status_code=202)
    def upload(
        files: list[UploadFile] = File(...), metadata: str | None = Form(None),
    ) -> dict[str, str]:
        try:
            return {"batch_id": service.submit(files, metadata)}
        except ServiceError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None

    @app.get("/api/batches/{batch_id}")
    def get_status(batch_id: str) -> dict[str, Any]:
        try:
            return service.status(batch_id)
        except ServiceError as exc:
            code = 404 if str(exc) == "batch_not_found" else 409
            raise HTTPException(status_code=code, detail=str(exc)) from None

    def readable_failure(exc: ServiceError) -> None:
        reason = str(exc)
        code = (
            404
            if reason == "readable_result_not_found"
            else 413
            if reason == "readable_result_too_large"
            else 409
        )
        raise HTTPException(status_code=code, detail=reason) from None

    @app.get("/api/batches/{batch_id}/documents")
    def readable_documents(batch_id: str) -> dict[str, Any]:
        try:
            return service.readable_documents(batch_id)
        except ServiceError as exc:
            readable_failure(exc)

    @app.get("/api/batches/{batch_id}/documents/{source_sha256}/markdown")
    def readable_markdown_response(batch_id: str, source_sha256: str) -> Any:
        try:
            body = service.readable_markdown(batch_id, source_sha256)
            disposition = f'attachment; filename="document-{source_sha256}.md"'
            return Response(
                content=body,
                media_type="text/markdown; charset=utf-8",
                headers={"Content-Disposition": disposition},
            )
        except ServiceError as exc:
            readable_failure(exc)

    @app.get("/batches/{batch_id}/documents/{source_sha256}")
    def readable_page(batch_id: str, source_sha256: str) -> Any:
        try:
            markdown = service.readable_markdown(batch_id, source_sha256)
            body = render_html(markdown, batch_id, source_sha256)
            return Response(content=body, media_type="text/html; charset=utf-8")
        except ReadableResultTooLarge as exc:
            readable_failure(ServiceError("readable_result_too_large"))
        except ReadableResultError as exc:
            readable_failure(ServiceError("readable_state_invalid"))
        except ServiceError as exc:
            readable_failure(exc)

    return app


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="document-service")
    parser.add_argument("--state-root", required=True)
    parser.add_argument("--config", required=True)
    parser.add_argument("--host")
    parser.add_argument("--port", type=int)
    parser.add_argument("--uds")
    parser.add_argument("--pdfinfo", required=True)
    parser.add_argument("--pdftotext", required=True)
    parser.add_argument("--pdftoppm", required=True)
    parser.add_argument("--tesseract", required=True)
    parser.add_argument("--poppler-version", required=True)
    parser.add_argument("--tesseract-version", required=True)
    parser.add_argument("--installed-language", action="append", required=True)
    args = parser.parse_args(argv)
    try:
        if args.uds is not None:
            if (
                args.host is not None
                or args.port is not None
                or args.uds != "/data/.document-service-runtime/service.sock"
            ):
                raise ServiceError("transport_invalid")
            host = "127.0.0.1"
            transport = {"uds": args.uds}
        else:
            host = validate_bind(args.host or "127.0.0.1")
            port = 8080 if args.port is None else args.port
            if not 1024 <= port <= 65535:
                raise ServiceError("port_invalid")
            transport = {"host": host, "port": port}
        toolchain = ProductionToolchain(
            args.pdfinfo, args.pdftotext, args.pdftoppm, args.tesseract,
            args.poppler_version, args.tesseract_version,
            tuple(sorted(set(args.installed_language))),
        )
        app = create_app(
            args.state_root, host=host, config_path=args.config,
            runner_kwargs={"toolchain": toolchain},
        )
        import uvicorn
        uvicorn.run(app, access_log=False, **transport)
        return 0
    except (BatchContractError, OSError, ServiceError, RuntimeError):
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
