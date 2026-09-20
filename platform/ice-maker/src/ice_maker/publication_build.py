"""Confined, all-or-nothing filesystem boundary for publications."""
from __future__ import annotations

import ctypes
from dataclasses import dataclass
import errno
import os
from pathlib import Path
import secrets
import stat
from typing import Callable

from .publication import (
    AssembledBook,
    PublicationError,
    assemble_book,
    parse_manifest,
    parse_record,
    render_html as _render_html,
    render_markdown as _render_markdown,
)


class BuildError(ValueError):
    """A publication build could not safely load or publish its inputs."""


@dataclass(frozen=True, slots=True)
class PublicationFiles:
    """The complete, atomically published artifact pair."""

    markdown: Path
    html: Path
    book: AssembledBook


_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
_DIRECTORY = getattr(os, "O_DIRECTORY", 0)
_RENAME_NOREPLACE = 1
_MAX_PATH_BYTES = 4096


def _raw_path(value: str | os.PathLike[str], label: str) -> str:
    try:
        raw = os.fspath(value)
    except TypeError as exc:
        raise BuildError(label) from exc
    if (
        type(raw) is not str
        or not raw
        or len(os.fsencode(raw)) > _MAX_PATH_BYTES
        or "\x00" in raw
        or "\\" in raw
        or any(ord(character) < 32 or ord(character) == 127 for character in raw)
    ):
        raise BuildError(label)
    return raw


def _relative(value: str | os.PathLike[str], label: str) -> tuple[str, ...]:
    raw = _raw_path(value, label)
    if raw.startswith("/") or "//" in raw:
        raise BuildError(label)
    parts = tuple(raw.split("/"))
    if (
        any(part in {"", ".", ".."} for part in parts)
        or ":" in parts[0]
    ):
        raise BuildError(label)
    return parts


def _root_path(value: str | os.PathLike[str]) -> Path:
    raw = _raw_path(value, "repository root is unsafe")
    if raw == ".":
        candidate = Path.cwd()
    elif raw.startswith("/"):
        parts = raw.split("/")[1:]
        if not parts or any(part in {"", ".", ".."} for part in parts):
            raise BuildError("repository root is unsafe")
        candidate = Path(raw)
    else:
        parts = _relative(raw, "repository root is unsafe")
        candidate = Path.cwd().joinpath(*parts)
    return candidate


def _open_directory_no_follow(path: Path) -> int:
    """Open an absolute directory without resolving any link component."""
    if not _NOFOLLOW or not _DIRECTORY or not path.is_absolute():
        raise OSError(errno.ENOSYS, "no-follow directory opens are unavailable")
    directory = os.open(path.anchor, os.O_RDONLY | _DIRECTORY | _NOFOLLOW)
    try:
        for component in path.parts[1:]:
            next_fd = os.open(
                component,
                os.O_RDONLY | _DIRECTORY | _NOFOLLOW,
                dir_fd=directory,
            )
            os.close(directory)
            directory = next_fd
        return directory
    except Exception:
        os.close(directory)
        raise


def _open_repository(value: str | os.PathLike[str]) -> tuple[Path, int]:
    path = _root_path(value)
    try:
        descriptor = _open_directory_no_follow(path)
        if not stat.S_ISDIR(os.fstat(descriptor).st_mode):
            raise OSError(errno.ENOTDIR, "repository root is not a directory")
    except OSError as exc:
        raise BuildError("repository root is unsafe") from exc
    return path, descriptor


def _same_public_identity(path: Path, descriptor: int) -> bool:
    try:
        current = _open_directory_no_follow(path)
    except OSError:
        return False
    try:
        expected = os.fstat(descriptor)
        actual = os.fstat(current)
        return (expected.st_dev, expected.st_ino) == (actual.st_dev, actual.st_ino)
    finally:
        os.close(current)


def _read_beneath(root_fd: int, relative: tuple[str, ...], label: str) -> bytes:
    """Read one stable regular file beneath the pinned repository descriptor."""
    directory = os.dup(root_fd)
    try:
        for component in relative[:-1]:
            next_fd = os.open(
                component,
                os.O_RDONLY | _DIRECTORY | _NOFOLLOW,
                dir_fd=directory,
            )
            os.close(directory)
            directory = next_fd
        file_fd = os.open(relative[-1], os.O_RDONLY | _NOFOLLOW, dir_fd=directory)
        try:
            before = os.fstat(file_fd)
            if (
                not stat.S_ISREG(before.st_mode)
                or not 0 < before.st_size <= 1_048_576
            ):
                raise BuildError(label)
            content = bytearray()
            while len(content) < before.st_size:
                chunk = os.read(
                    file_fd,
                    min(65_536, before.st_size - len(content)),
                )
                if not chunk:
                    raise BuildError(label)
                content.extend(chunk)
            after = os.fstat(file_fd)
            identity = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
            if any(getattr(before, name) != getattr(after, name) for name in identity):
                raise BuildError(label)
            return bytes(content)
        finally:
            os.close(file_fd)
    except BuildError:
        raise
    except OSError as exc:
        raise BuildError(label) from exc
    finally:
        os.close(directory)


def _output_relative(
    repository_path: Path,
    value: str | os.PathLike[str],
) -> tuple[str, ...]:
    raw = _raw_path(value, "output root is unsafe")
    if raw.startswith("/"):
        parts = raw.split("/")[1:]
        if any(part in {"", ".", ".."} for part in parts):
            raise BuildError("output root is unsafe")
        output = Path(raw)
        try:
            relative = output.relative_to(repository_path)
        except ValueError as exc:
            raise BuildError("output root is unsafe") from exc
        components = relative.parts
    else:
        components = _relative(raw, "output root is unsafe")
    if len(components) < 2 or components[0] != ".ice-maker":
        raise BuildError("output root is unsafe")
    return tuple(components)


def _ensure_output_root(repository_fd: int, components: tuple[str, ...]) -> int:
    """Create/open the confined output root relative to the pinned repository."""
    directory = os.dup(repository_fd)
    try:
        for component in components:
            try:
                next_fd = os.open(
                    component,
                    os.O_RDONLY | _DIRECTORY | _NOFOLLOW,
                    dir_fd=directory,
                )
            except FileNotFoundError:
                os.mkdir(component, mode=0o700, dir_fd=directory)
                next_fd = os.open(
                    component,
                    os.O_RDONLY | _DIRECTORY | _NOFOLLOW,
                    dir_fd=directory,
                )
            os.close(directory)
            directory = next_fd
        return directory
    except Exception:
        os.close(directory)
        raise


def _write_staged(directory_fd: int, name: str, data: bytes) -> None:
    fd = os.open(
        name,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | _NOFOLLOW,
        0o600,
        dir_fd=directory_fd,
    )
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
    except Exception:
        try:
            os.unlink(name, dir_fd=directory_fd)
        except OSError:
            pass
        raise


def _rename_noreplace(directory_fd: int, source: str, destination: str) -> None:
    """Atomically publish one directory without replacing a collision."""
    try:
        renameat2 = ctypes.CDLL(None, use_errno=True).renameat2
    except (AttributeError, OSError) as exc:
        raise OSError(
            errno.ENOSYS,
            "atomic no-replace publication is unavailable",
        ) from exc
    renameat2.argtypes = (
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_uint,
    )
    renameat2.restype = ctypes.c_int
    if renameat2(
        directory_fd,
        source.encode("ascii"),
        directory_fd,
        destination.encode("ascii"),
        _RENAME_NOREPLACE,
    ) != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))


def _new_stage(directory_fd: int) -> str:
    for _ in range(128):
        name = f".publication-{secrets.token_hex(16)}"
        try:
            os.mkdir(name, mode=0o700, dir_fd=directory_fd)
            return name
        except FileExistsError:
            continue
    raise OSError(errno.EEXIST, "could not reserve publication staging directory")


def _remove_stage(directory_fd: int, stage: str) -> None:
    try:
        stage_fd = os.open(
            stage,
            os.O_RDONLY | _DIRECTORY | _NOFOLLOW,
            dir_fd=directory_fd,
        )
    except OSError:
        return
    try:
        for name in ("book.md", "book.html"):
            try:
                os.unlink(name, dir_fd=stage_fd)
            except FileNotFoundError:
                pass
    finally:
        os.close(stage_fd)
    try:
        os.rmdir(stage, dir_fd=directory_fd)
    except OSError:
        pass


def _publish_pair(
    output_fd: int,
    output_path: Path,
    manifest_id: str,
    markdown: bytes,
    html: bytes,
) -> tuple[Path, Path]:
    stage: str | None = None
    try:
        stage = _new_stage(output_fd)
        stage_fd = os.open(
            stage,
            os.O_RDONLY | _DIRECTORY | _NOFOLLOW,
            dir_fd=output_fd,
        )
        try:
            _write_staged(stage_fd, "book.md", markdown)
            _write_staged(stage_fd, "book.html", html)
            os.fsync(stage_fd)
        finally:
            os.close(stage_fd)
        _rename_noreplace(output_fd, stage, manifest_id)
        stage = None
        os.fsync(output_fd)
        book = output_path / manifest_id
        return book / "book.md", book / "book.html"
    except (OSError, ValueError) as exc:
        message = (
            "publication output collision"
            if getattr(exc, "errno", None) == errno.EEXIST
            else "publication output failed"
        )
        raise BuildError(message) from exc
    finally:
        if stage is not None:
            _remove_stage(output_fd, stage)


def build_publication(
    repository_root: str | os.PathLike[str],
    manifest_path: str | os.PathLike[str],
    output_root: str | os.PathLike[str],
    source_commit: str,
    *,
    render_markdown: Callable[[AssembledBook], bytes] = _render_markdown,
    render_html: Callable[[AssembledBook], bytes] = _render_html,
) -> PublicationFiles:
    """Load one pinned source snapshot and atomically publish both formats."""
    repository_path, repository_fd = _open_repository(repository_root)
    output_fd: int | None = None
    try:
        manifest_relative = _relative(manifest_path, "manifest path is unsafe")
        if ".ice-maker" in manifest_relative:
            raise BuildError("manifest path is unsafe")
        manifest = parse_manifest(
            _read_beneath(repository_fd, manifest_relative, "manifest is unreadable")
        )
        chapter_paths = tuple(
            _relative(item, "source path is unsafe")
            for item in manifest.chapters
        )
        if any(".ice-maker" in path for path in chapter_paths):
            raise BuildError("source path is unsafe")
        records = tuple(
            parse_record(
                _read_beneath(repository_fd, path, "source is unreadable")
            )
            for path in chapter_paths
        )
        if tuple(record.source for record in records) != manifest.chapters:
            raise BuildError("source identity mismatch")
        book = assemble_book(manifest, records, source_commit)
        markdown = render_markdown(book)
        html = render_html(book)
        if type(markdown) is not bytes or type(html) is not bytes:
            raise BuildError("renderer output is invalid")
        output_parts = _output_relative(repository_path, output_root)
        if not _same_public_identity(repository_path, repository_fd):
            raise BuildError("repository root changed during build")
        output_fd = _ensure_output_root(repository_fd, output_parts)
        if not _same_public_identity(repository_path, repository_fd):
            raise BuildError("repository root changed during build")
        output_path = repository_path.joinpath(*output_parts)
        markdown_path, html_path = _publish_pair(
            output_fd,
            output_path,
            manifest.manifest_id,
            markdown,
            html,
        )
        return PublicationFiles(markdown_path, html_path, book)
    except BuildError:
        raise
    except Exception as exc:
        raise BuildError("publication build failed") from exc
    finally:
        if output_fd is not None:
            os.close(output_fd)
        os.close(repository_fd)
