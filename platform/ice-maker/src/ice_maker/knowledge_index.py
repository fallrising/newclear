"""Deterministic, local-only FTS5 storage for immutable extracted chunks."""

from __future__ import annotations

from dataclasses import dataclass
import fcntl
import hashlib
import math
import os
from pathlib import Path
import re
import sqlite3
import stat
import time
import unicodedata
from types import MappingProxyType
from typing import Iterable, Mapping

from .extraction import ExtractedChunk
from .knowledge_store import load_taxonomy


class IndexError(ValueError):
    """An unsafe database, malformed chunk, or invalid proposal."""


class IndexLimitError(IndexError):
    """A bounded source read exceeded a public ceiling."""


SCHEMA_VERSION = "knowledge-index.v1"
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_TEXT_REGION = re.compile(r"^text:(?:0|[1-9][0-9]{0,6}),0,[1-9][0-9]{0,5}$")
_PIXEL_REGION = re.compile(r"^pixels:(?:0|[1-9][0-9]{0,5}),(?:0|[1-9][0-9]{0,5}),[1-9][0-9]{0,5},[1-9][0-9]{0,5}$")
_SECRET = re.compile(r"(?i)(?:api[_-]?key|token|password|secret)\s*[:=]")
_MAX_TEXT = 16_384
_MAX_CHUNKS = 10_000
_MAX_INDEX_CHUNKS = 1_000_000
_MAX_CONCLUSIONS = 100
_MAX_PAGE = 1_000
_MAX_COORDINATE = 100_000
_MAX_TEXT_OFFSET = 8_388_608
_LOCK_TIMEOUT_SECONDS = 5.0
_LOCK_POLL_SECONDS = 0.01


@dataclass(frozen=True)
class Proposal:
    """An immutable local candidate; promotion is deliberately another stage."""

    status: str
    destination: str
    query: str
    conclusions: tuple[str, ...]
    related_comparisons: tuple[Mapping[str, object], ...]
    citations: tuple[Mapping[str, object], ...]
    conclusion_citations: tuple[Mapping[str, object], ...]


def _safe_database_path(
    value: os.PathLike[str] | str, *, create_parents: bool = True
) -> Path:
    try:
        raw = os.fspath(value)
    except TypeError as exc:
        raise IndexError("database path is unsafe") from exc
    if not isinstance(raw, str) or not raw or "\x00" in raw:
        raise IndexError("database path is unsafe")
    target = Path(raw)
    if any(part in {"", ".", ".."} for part in target.parts):
        raise IndexError("database path is unsafe")
    absolute = target.absolute()
    current = Path(absolute.anchor)
    for part in absolute.parts[1:-1]:
        current /= part
        try:
            mode = os.lstat(current).st_mode
        except FileNotFoundError:
            if not create_parents:
                raise IndexError("database directory is unsafe")
            current.mkdir()
            mode = os.lstat(current).st_mode
        except OSError as exc:
            raise IndexError("database directory is unsafe") from exc
        if not stat.S_ISDIR(mode) or stat.S_ISLNK(mode):
            raise IndexError("database directory is unsafe")
    for candidate in (absolute, Path(str(absolute) + "-wal"),
                      Path(str(absolute) + "-shm"), Path(str(absolute) + "-journal")):
        try:
            mode = os.lstat(candidate).st_mode
        except FileNotFoundError:
            continue
        except OSError as exc:
            raise IndexError("database path is unsafe") from exc
        if stat.S_ISLNK(mode) or not stat.S_ISREG(mode):
            raise IndexError("database path is unsafe")
    return absolute


def _bounded(items: Iterable[object], maximum: int, message: str) -> tuple[object, ...]:
    result = []
    try:
        iterator = iter(items)
    except TypeError as exc:
        raise IndexError(message) from exc
    for _ in range(maximum + 1):
        try:
            result.append(next(iterator))
        except StopIteration:
            return tuple(result)
    raise IndexError(message)


def _safe_text(value: object, maximum: int, message: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise IndexError(message)
    normalized = unicodedata.normalize("NFKC", value)
    if normalized != value or _SECRET.search(value):
        raise IndexError(message)
    for char in value:
        code = ord(char)
        if (not char.isprintable() or unicodedata.category(char) in {"Cs", "Cf"}
                or (code & 0xFFFF) in {0xFFFE, 0xFFFF}):
            raise IndexError(message)
    return value


def _validate_chunk(item: object) -> ExtractedChunk:
    if type(item) is not ExtractedChunk:
        raise IndexError("chunk must be an immutable ExtractedChunk")
    chunk = item
    if (not _SHA256.fullmatch(chunk.source_sha256) or not _SHA256.fullmatch(chunk.chunk_id)
            or type(chunk.page_number) is not int or not 1 <= chunk.page_number <= _MAX_PAGE
            or chunk.method not in {"pdf-text", "ocr-pbm", "ocr"}
            or not isinstance(chunk.region, str) or not isinstance(chunk.text, str)
            or len(chunk.text) == 0 or len(chunk.text) > _MAX_TEXT
            or type(chunk.confidence) not in {int, float}
            or not math.isfinite(chunk.confidence) or not 0 <= chunk.confidence <= 1):
        raise IndexError("chunk is malformed or unsafe")
    if chunk.method == "pdf-text":
        if not _TEXT_REGION.fullmatch(chunk.region):
            raise IndexError("chunk provenance mismatch")
        offset, _, length = (int(value) for value in chunk.region[5:].split(","))
        if (length != len(chunk.text) or offset + length > _MAX_TEXT_OFFSET
                or chunk.confidence != 1.0):
            raise IndexError("chunk provenance mismatch")
    elif not _PIXEL_REGION.fullmatch(chunk.region):
        raise IndexError("chunk provenance mismatch")
    else:
        left, top, width, height = (int(value) for value in chunk.region[7:].split(","))
        if (any(value > _MAX_COORDINATE for value in (left, top, width, height))
                or left + width > _MAX_COORDINATE or top + height > _MAX_COORDINATE):
            raise IndexError("chunk provenance mismatch")
    try:
        if len(chunk.text.encode("utf-8")) > _MAX_TEXT:
            raise IndexError("chunk is malformed or unsafe")
    except UnicodeError as exc:
        raise IndexError("chunk is malformed or unsafe") from exc
    _safe_text(chunk.text, _MAX_TEXT, "chunk is malformed or unsafe")
    expected = hashlib.sha256(f"{chunk.source_sha256}\0{chunk.page_number}\0{chunk.region}\0{chunk.method}\0{chunk.text}".encode()).hexdigest()
    if expected != chunk.chunk_id:
        raise IndexError("chunk identity mismatch")
    return chunk


def validate_chunk(item: object) -> ExtractedChunk:
    """Validate one chunk at the public persistence/rendering boundary."""
    return _validate_chunk(item)


def validate_chunks(chunks: Iterable[ExtractedChunk]) -> tuple[ExtractedChunk, ...]:
    """Seal the public chunk batch before persistence at another boundary."""
    items = tuple(_validate_chunk(item) for item in _bounded(chunks, _MAX_CHUNKS, "too many chunks"))
    if not items or len({item.chunk_id for item in items}) != len(items):
        raise IndexError("duplicate or empty chunk IDs")
    return items


class KnowledgeIndex:
    def __init__(
        self,
        database: os.PathLike[str] | str,
        taxonomy: Mapping[str, tuple[str, ...]] | None = None,
        *,
        existing: bool = False,
    ):
        self.path = _safe_database_path(database, create_parents=not existing)
        supplied_taxonomy = load_taxonomy() if taxonomy is None else taxonomy
        expected_taxonomy = {
            "domains": ("operations", "software", "systems"),
            "concepts": ("consistency", "idempotency", "privacy", "provenance"),
            "relations": ("contrasts_with", "depends_on", "derived_from", "example_of", "implements"),
        }
        if not isinstance(supplied_taxonomy, Mapping) or dict(supplied_taxonomy) != expected_taxonomy:
            raise IndexError("taxonomy is malformed or non-canonical")
        self.taxonomy = MappingProxyType({key: tuple(value) for key, value in expected_taxonomy.items()})
        self._database_descriptor: int | None = None
        try:
            self._database_descriptor, self._db_identity = self._lock_database(
                self.path, shared=existing
            )
            if existing:
                self._connection = sqlite3.connect(self.path)
                self._connection.execute("PRAGMA foreign_keys = ON")
                self._validate_schema()
                current = self._connection.execute(
                    "SELECT value FROM index_metadata WHERE key='schema'"
                ).fetchone()
                if current is None or current[0] != SCHEMA_VERSION:
                    raise IndexError("unsupported index schema")
                self._assert_safe_paths()
                return
            self._connection = sqlite3.connect(self.path)
            self._connection.execute("PRAGMA foreign_keys = ON")
            self._connection.execute("PRAGMA journal_mode = WAL")
            # sqlite3's legacy transaction handling does not implicitly wrap
            # DDL. Start explicitly so a validation failure rolls it all back.
            self._connection.execute("BEGIN IMMEDIATE")
            with self._connection:
                self._connection.execute("CREATE TABLE IF NOT EXISTS index_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
                self._connection.execute("""CREATE TABLE IF NOT EXISTS chunks (
                  chunk_id TEXT PRIMARY KEY, source_sha256 TEXT NOT NULL, page_number INTEGER NOT NULL,
                  region TEXT NOT NULL, method TEXT NOT NULL, text TEXT NOT NULL, confidence REAL NOT NULL
                )""")
                self._connection.execute("""CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
                  text, content='chunks', content_rowid='rowid', tokenize='unicode61'
                )""")
                current = self._connection.execute("SELECT value FROM index_metadata WHERE key='schema'").fetchone()
                if current is None:
                    if self._connection.execute("SELECT count(*) FROM sqlite_master WHERE name IN ('chunks','chunks_fts')").fetchone()[0] != 2:
                        raise IndexError("index schema is corrupt")
                    self._connection.execute("INSERT INTO index_metadata VALUES ('schema', ?)", (SCHEMA_VERSION,))
                elif current[0] != SCHEMA_VERSION:
                    raise IndexError("unsupported index schema")
                self._validate_schema()
                # Keep all local validation before the creation transaction
                # commits, so a failed initialization cannot publish a schema.
                self._assert_safe_paths()
        except IndexError:
            if hasattr(self, "_connection"):
                self._connection.close()
            self._close_database_descriptor()
            raise
        except sqlite3.Error as exc:
            if hasattr(self, "_connection"):
                self._connection.close()
            self._close_database_descriptor()
            raise IndexError("FTS5 database unavailable") from exc

    @staticmethod
    def _lock_database(path: Path, *, shared: bool) -> tuple[int, tuple[int, int]]:
        flags = os.O_RDONLY if shared else os.O_RDWR | os.O_CREAT
        flags |= getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
        descriptor = None
        try:
            descriptor = os.open(path, flags, 0o600)
            info = os.fstat(descriptor)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise IndexError("database must be a single-linked regular file")
            operation = (fcntl.LOCK_SH if shared else fcntl.LOCK_EX) | fcntl.LOCK_NB
            deadline = time.monotonic() + _LOCK_TIMEOUT_SECONDS
            while True:
                try:
                    fcntl.flock(descriptor, operation)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise IndexError("database lock timed out")
                    time.sleep(_LOCK_POLL_SECONDS)
            current = os.lstat(path)
            if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino):
                raise IndexError("database was replaced unsafely")
            return descriptor, (info.st_dev, info.st_ino)
        except IndexError:
            if descriptor is not None:
                os.close(descriptor)
            raise
        except OSError as exc:
            if descriptor is not None:
                os.close(descriptor)
            raise IndexError("database lock is unavailable") from exc

    def _close_database_descriptor(self) -> None:
        descriptor = self._database_descriptor
        if descriptor is not None:
            self._database_descriptor = None
            try:
                fcntl.flock(descriptor, fcntl.LOCK_UN)
            finally:
                os.close(descriptor)

    @staticmethod
    def _regular_identity(path: Path) -> tuple[int, int]:
        try:
            info = os.lstat(path)
        except OSError as exc:
            raise IndexError("database was replaced unsafely") from exc
        if not stat.S_ISREG(info.st_mode):
            raise IndexError("database must be a regular file")
        return info.st_dev, info.st_ino

    def _assert_safe_paths(self) -> None:
        if self._regular_identity(self.path) != self._db_identity:
            raise IndexError("database was replaced unsafely")
        _safe_database_path(self.path, create_parents=False)

    def _validate_schema(self) -> None:
        expected = {"index_metadata", "chunks", "chunks_fts"}
        objects = {row[0] for row in self._connection.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table','shadow')")}
        if not expected <= objects:
            raise IndexError("index schema is corrupt")
        columns = tuple(row[1] for row in self._connection.execute("PRAGMA table_info(chunks)"))
        if columns != ("chunk_id", "source_sha256", "page_number", "region", "method", "text", "confidence"):
            raise IndexError("index schema is corrupt")
        fts_sql = self._connection.execute(
            "SELECT sql FROM sqlite_master WHERE name='chunks_fts'").fetchone()
        if not fts_sql or "content='chunks'" not in fts_sql[0]:
            raise IndexError("FTS schema is corrupt")

    def _validate_rows(self) -> None:
        rows = self._connection.execute(
            "SELECT source_sha256,page_number,region,method,text,confidence,chunk_id,rowid FROM chunks ORDER BY rowid"
        ).fetchall()
        if len(rows) > _MAX_INDEX_CHUNKS:
            raise IndexError("index contains too many chunks")
        for row in rows:
            item = _validate_chunk(ExtractedChunk(*row[:7]))
            fts_text = self._connection.execute("SELECT text FROM chunks_fts WHERE rowid=?", (row[7],)).fetchone()
            if fts_text is None or fts_text[0] != item.text:
                raise IndexError("FTS content is corrupt")
        if self._connection.execute("SELECT count(*) FROM chunks_fts").fetchone()[0] != len(rows):
            raise IndexError("FTS index is corrupt")

    def _validate_fts_index(self) -> None:
        """Ask FTS5 to compare its index with the external content table.

        The rank=1 form is essential: a plain integrity-check validates only
        FTS shadow tables and does not detect a missing external-content index.
        """
        try:
            self._connection.execute(
                "INSERT INTO chunks_fts(chunks_fts, rank) VALUES ('integrity-check', 1)"
            )
        except sqlite3.Error as exc:
            raise IndexError("FTS index is corrupt") from exc

    def close(self) -> None:
        try:
            self._connection.close()
        finally:
            self._close_database_descriptor()

    def __enter__(self) -> "KnowledgeIndex":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def count(self) -> int:
        self._assert_safe_paths()
        return int(self._connection.execute("SELECT count(*) FROM chunks").fetchone()[0])

    def index_chunks(self, chunks: Iterable[ExtractedChunk]) -> int:
        items = validate_chunks(chunks)
        inserted = 0
        try:
            self._assert_safe_paths()
            with self._connection:
                existing_count = int(
                    self._connection.execute("SELECT count(*) FROM chunks").fetchone()[0]
                )
                if existing_count > _MAX_INDEX_CHUNKS:
                    raise IndexError("index contains too many chunks")
                for item in items:
                    row = self._connection.execute("SELECT source_sha256,page_number,region,method,text,confidence FROM chunks WHERE chunk_id=?", (item.chunk_id,)).fetchone()
                    values = (item.source_sha256, item.page_number, item.region, item.method, item.text, float(item.confidence))
                    if row is not None:
                        if tuple(row) != values:
                            raise IndexError("duplicate chunk conflict")
                        continue
                    if existing_count + inserted >= _MAX_INDEX_CHUNKS:
                        raise IndexError("index contains too many chunks")
                    self._connection.execute("INSERT INTO chunks VALUES (?,?,?,?,?,?,?)", (item.chunk_id, *values))
                    rowid = self._connection.execute("SELECT rowid FROM chunks WHERE chunk_id=?", (item.chunk_id,)).fetchone()[0]
                    self._connection.execute("INSERT INTO chunks_fts(rowid,text) VALUES (?,?)", (rowid, item.text))
                    inserted += 1
                self._assert_safe_paths()
        except sqlite3.Error as exc:
            raise IndexError("index transaction failed") from exc
        return inserted

    def search(self, query: str, *, limit: int = 20) -> tuple[ExtractedChunk, ...]:
        query = _safe_text(query, 512, "query is malformed")
        if type(limit) is not int or not 1 <= limit <= 100:
            raise IndexError("search limit is out of bounds")
        try:
            self._assert_safe_paths()
            self._validate_schema()
            self._validate_fts_index()
            self._validate_rows()
            rows = self._connection.execute("""SELECT c.source_sha256,c.page_number,c.region,c.method,c.text,c.confidence,c.chunk_id
                FROM chunks_fts JOIN chunks c ON c.rowid=chunks_fts.rowid WHERE chunks_fts MATCH ?
                ORDER BY bm25(chunks_fts), c.chunk_id LIMIT ?""", (query, limit)).fetchall()
        except sqlite3.Error as exc:
            raise IndexError("invalid FTS query") from exc
        result = []
        for row in rows:
            item = _validate_chunk(ExtractedChunk(*row))
            fts_text = self._connection.execute("SELECT text FROM chunks_fts WHERE rowid=(SELECT rowid FROM chunks WHERE chunk_id=?)", (item.chunk_id,)).fetchone()
            if fts_text is None or fts_text[0] != item.text:
                raise IndexError("FTS content is corrupt")
            result.append(item)
        self._assert_safe_paths()
        return tuple(result)

    def read_sources(
        self, source_sha256s: Iterable[str]
    ) -> Mapping[str, tuple[ExtractedChunk, ...]]:
        """Read a bounded set of complete sources in durable insertion order."""
        raw_sources = _bounded(source_sha256s, 100, "too many sources")
        if (
            not raw_sources
            or any(
                not isinstance(source, str) or not _SHA256.fullmatch(source)
                for source in raw_sources
            )
            or len(set(raw_sources)) != len(raw_sources)
        ):
            raise IndexError("sources are invalid")
        sources = tuple(sorted(raw_sources))
        result: dict[str, tuple[ExtractedChunk, ...]] = {}
        try:
            self._assert_safe_paths()
            self._validate_schema()
            self._validate_fts_index()
            self._validate_rows()
            for source in sources:
                rows = self._connection.execute(
                    "SELECT source_sha256,page_number,region,method,text,confidence,chunk_id "
                    "FROM chunks WHERE source_sha256=? ORDER BY rowid LIMIT ?",
                    (source, _MAX_CHUNKS + 1),
                ).fetchall()
                if not rows:
                    raise IndexError("source is unavailable")
                if len(rows) > _MAX_CHUNKS:
                    raise IndexLimitError("source contains too many chunks")
                values = tuple(
                    _validate_chunk(ExtractedChunk(*row)) for row in rows
                )
                # The per-chunk bound makes this aggregate finite; compute it
                # before returning so callers never consume unbounded text.
                if sum(len(item.text.encode("utf-8")) for item in values) > (
                    _MAX_CHUNKS * _MAX_TEXT
                ):
                    raise IndexLimitError("source text is too large")
                result[source] = values
            self._assert_safe_paths()
        except UnicodeError as exc:
            raise IndexError("source text is invalid") from exc
        except sqlite3.Error as exc:
            raise IndexError("source index is unavailable") from exc
        return MappingProxyType(result)

    def read_source(self, source_sha256: str) -> tuple[ExtractedChunk, ...]:
        """Read exactly one validated source without exposing other content."""
        return self.read_sources((source_sha256,))[source_sha256]

    def propose(self, query: str, destination: str, *, conclusions: Iterable[str], limit: int = 20) -> Proposal:
        if not isinstance(destination, str) or not re.fullmatch(r"(?:domains|concepts|relations)/[a-z][a-z0-9_]{0,63}", destination):
            if destination != "taxonomy_proposal":
                raise IndexError("proposal destination is not taxonomy-valid")
        elif destination.split("/", 1)[1] not in self.taxonomy[destination.split("/", 1)[0]]:
            raise IndexError("proposal destination is not taxonomy-valid")
        words = tuple(_safe_text(item, 2_000, "proposal conclusions are malformed")
                      for item in _bounded(conclusions, _MAX_CONCLUSIONS, "too many conclusions"))
        if not words:
            raise IndexError("proposal conclusions are malformed")
        related = self.search(query, limit=limit)
        citations = tuple(MappingProxyType({"chunk_id": item.chunk_id, "source_sha256": item.source_sha256,
            "page_number": item.page_number, "region": item.region, "method": item.method}) for item in related)
        if not citations:
            raise IndexError("proposal requires cited source chunks")
        comparisons = tuple(MappingProxyType({"chunk_id": item["chunk_id"], "relation": "related",
            "source_sha256": item["source_sha256"]}) for item in citations)
        bindings = tuple(MappingProxyType({"conclusion": conclusion,
            "citation_ids": tuple(item["chunk_id"] for item in citations)}) for conclusion in words)
        return Proposal("unpromoted", destination, query, words, comparisons, citations, bindings)


KnowledgeIndexer = KnowledgeIndex
