"""Pure, deterministic publication values and renderers."""
from __future__ import annotations

from dataclasses import dataclass
import html
import json
import re


class PublicationError(ValueError):
    """Publication input is malformed, unsafe, or inconsistent."""


_SHA = re.compile(r"^[0-9a-f]{64}$")
_COMMIT = re.compile(r"^[0-9a-f]{40}$")
_ID = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
_ANCHOR = _ID
_SECRET = re.compile(r"(?i)(?:api[_-]?key|token|password|secret)\s*[:=]")
_MAX_TEXT = 16_384
_MAX_JSON_BYTES = 1_048_576
_MAX_CHAPTERS = 100
_MAX_CITATIONS = 100
_MAX_REFS = 32


def _text(value: object, label: str, maximum: int = _MAX_TEXT) -> str:
    if (type(value) is not str or not value.strip() or len(value) > maximum
            or any(ord(c) < 32 or ord(c) > 126 for c in value)
            or _SECRET.search(value)):
        raise PublicationError(label)
    return value


def _path(value: object) -> str:
    if type(value) is not str or not value or len(value) > 512 or "\\" in value or value.startswith("/"):
        raise PublicationError("source path is unsafe")
    parts = value.split("/")
    if (any(part in {"", ".", ".."} for part in parts)
            or any(part in {".ice-maker", "generated", "build", "dist"} for part in parts)
            or ":" in parts[0]):
        raise PublicationError("source path is unsafe")
    return value


def _anchor(value: object, label: str = "unsafe chapter anchor") -> str:
    if type(value) is not str or not _ANCHOR.fullmatch(value):
        raise PublicationError(label)
    return value


def _obj(value: object, keys: set[str], label: str) -> dict[str, object]:
    if type(value) is not dict or set(value) != keys:
        raise PublicationError(label)
    return value


def _pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _json(value: bytes | str) -> object:
    if type(value) is bytes:
        if len(value) > _MAX_JSON_BYTES:
            raise PublicationError("JSON is too large")
        try:
            value = value.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise PublicationError("JSON is malformed") from exc
    elif type(value) is not str:
        raise PublicationError("JSON is malformed")
    if len(value.encode("utf-8")) > _MAX_JSON_BYTES:
        raise PublicationError("JSON is too large")
    try:
        return json.loads(value, object_pairs_hook=_pairs)
    except (ValueError, TypeError, UnicodeError) as exc:
        raise PublicationError("JSON is malformed") from exc


@dataclass(frozen=True, slots=True)
class Citation:
    source_sha256: str
    chunk_id: str

    def __post_init__(self) -> None:
        if type(self.source_sha256) is not str or not _SHA.fullmatch(self.source_sha256):
            raise PublicationError("citation source is malformed")
        if type(self.chunk_id) is not str or not _SHA.fullmatch(self.chunk_id):
            raise PublicationError("citation chunk is malformed")

    @property
    def identity(self) -> str:
        return f"{self.source_sha256}#{self.chunk_id}"


def _citation_tuple(value: object, allow_empty: bool = False) -> tuple[Citation, ...]:
    if type(value) is not tuple or (not allow_empty and not value) or len(value) > _MAX_CITATIONS:
        raise PublicationError("citations are unbounded or mutable")
    if any(type(item) is not Citation for item in value):
        raise PublicationError("citation is malformed")
    if len({item.identity for item in value}) != len(value):
        raise PublicationError("duplicate citation")
    return value


@dataclass(frozen=True, slots=True)
class Manifest:
    manifest_id: str
    title: str
    chapters: tuple[str, ...]

    def __post_init__(self) -> None:
        if type(self.manifest_id) is not str or not _ID.fullmatch(self.manifest_id):
            raise PublicationError("manifest identity is malformed")
        _text(self.title, "manifest title", 512)
        if type(self.chapters) is not tuple or not 0 < len(self.chapters) <= _MAX_CHAPTERS:
            raise PublicationError("manifest chapters are malformed")
        paths = tuple(_path(item) for item in self.chapters)
        if len(set(paths)) != len(paths):
            raise PublicationError("duplicate chapter source")
        object.__setattr__(self, "chapters", paths)


@dataclass(frozen=True, slots=True)
class Chapter:
    source: str
    note_id: str
    title: str
    text: str
    synthetic: bool
    citations: tuple[Citation, ...]
    references: tuple[str, ...]

    def __post_init__(self) -> None:
        _path(self.source)
        _anchor(self.note_id)
        _text(self.title, "chapter title", 512)
        _text(self.text, "chapter text")
        if type(self.synthetic) is not bool or not self.synthetic:
            raise PublicationError("record must be explicitly synthetic")
        citations = _citation_tuple(self.citations)
        by_chunk: dict[str, str] = {}
        for citation in citations:
            prior = by_chunk.setdefault(citation.chunk_id, citation.source_sha256)
            if prior != citation.source_sha256:
                raise PublicationError("citation drift")
        if type(self.references) is not tuple or len(self.references) > _MAX_REFS:
            raise PublicationError("references are malformed")
        refs = tuple(_anchor(item, "references are malformed") for item in self.references)
        if len(set(refs)) != len(refs):
            raise PublicationError("references are malformed")
        object.__setattr__(self, "references", refs)

    @property
    def anchor(self) -> str:
        return self.note_id


@dataclass(frozen=True, slots=True)
class AssembledBook:
    manifest: Manifest
    chapters: tuple[Chapter, ...]
    bibliography: tuple[Citation, ...]
    source_commit: str

    def __post_init__(self) -> None:
        if type(self.manifest) is not Manifest:
            raise PublicationError("manifest is not canonical")
        if type(self.chapters) is not tuple or len(self.chapters) != len(self.manifest.chapters):
            raise PublicationError("chapter sources are missing")
        if any(type(item) is not Chapter for item in self.chapters):
            raise PublicationError("chapter is not canonical")
        if tuple(item.source for item in self.chapters) != self.manifest.chapters:
            raise PublicationError("chapter sources are duplicated or out of order")
        if len({item.note_id for item in self.chapters}) != len(self.chapters):
            raise PublicationError("duplicate chapter anchor")
        ids = {item.note_id for item in self.chapters}
        for chapter in self.chapters:
            if any(ref not in ids or ref == chapter.note_id for ref in chapter.references):
                raise PublicationError("cross-reference is unresolved or self-referential")
        expected: list[Citation] = []
        seen: set[str] = set()
        chunks: dict[str, str] = {}
        for chapter in self.chapters:
            for citation in chapter.citations:
                prior = chunks.setdefault(citation.chunk_id, citation.source_sha256)
                if prior != citation.source_sha256:
                    raise PublicationError("citation drift")
                if citation.identity not in seen:
                    seen.add(citation.identity)
                    expected.append(citation)
        if type(self.bibliography) is not tuple or self.bibliography != tuple(expected):
            raise PublicationError("bibliography is not canonical")
        _citation_tuple(self.bibliography, allow_empty=True)
        if type(self.source_commit) is not str or not _COMMIT.fullmatch(self.source_commit):
            raise PublicationError("source commit is malformed")


def parse_manifest(value: bytes | str) -> Manifest:
    obj = _obj(_json(value), {"schema_version", "manifest_id", "title", "chapters"}, "manifest schema")
    if (obj["schema_version"] != "publication-manifest.v1"
            or type(obj["chapters"]) is not list
            or not 0 < len(obj["chapters"]) <= _MAX_CHAPTERS):
        raise PublicationError("manifest schema")
    return Manifest(obj["manifest_id"], obj["title"], tuple(_path(item) for item in obj["chapters"]))


def parse_record(value: bytes | str) -> Chapter:
    obj = _obj(_json(value), {"schema_version", "source", "note_id", "title", "text", "synthetic", "citations", "references"}, "record schema")
    if (obj["schema_version"] != "knowledge-record.v1"
            or type(obj["citations"]) is not list
            or not 0 < len(obj["citations"]) <= _MAX_CITATIONS
            or type(obj["references"]) is not list
            or len(obj["references"]) > _MAX_REFS):
        raise PublicationError("record schema")
    citations = tuple(Citation(**_obj(item, {"source_sha256", "chunk_id"}, "citation schema")) for item in obj["citations"])
    return Chapter(obj["source"], obj["note_id"], obj["title"], obj["text"], obj["synthetic"], citations, tuple(obj["references"]))


def assemble_book(manifest: Manifest, records: tuple[Chapter, ...], source_commit: str) -> AssembledBook:
    if type(manifest) is not Manifest or type(records) is not tuple:
        raise PublicationError("manifest and chapters must be canonical")
    if len(records) != len(manifest.chapters) or any(type(x) is not Chapter for x in records):
        raise PublicationError("chapter sources are missing")
    bibliography: list[Citation] = []
    seen: set[str] = set()
    for chapter in records:
        for citation in chapter.citations:
            if citation.identity not in seen:
                seen.add(citation.identity)
                bibliography.append(citation)
    return AssembledBook(manifest, records, tuple(bibliography), source_commit)


def compile_publication(manifest: Manifest | bytes | str, records: tuple[Chapter, ...], source_commit: str) -> AssembledBook:
    return assemble_book(manifest if type(manifest) is Manifest else parse_manifest(manifest), records, source_commit)


def render_markdown(book: AssembledBook) -> bytes:
    if type(book) is not AssembledBook:
        raise PublicationError("book is not canonical")
    lines = [f"# {book.manifest.title}", "", f"Manifest: `{book.manifest.manifest_id}`", "", "Synthetic: `true`", "", f"Source commit: `{book.source_commit}`", ""]
    for chapter in book.chapters:
        lines += [f'<a id="{chapter.anchor}"></a>', f"## {chapter.title}", "", chapter.text, ""]
        lines.extend(f"See [{ref}](#{ref})." for ref in chapter.references)
        lines.append("")
    lines += ["## Bibliography", ""] + [f"- `{c.identity}`" for c in book.bibliography] + [""]
    return "\n".join(lines).encode("utf-8")


def render_html(book: AssembledBook) -> bytes:
    if type(book) is not AssembledBook:
        raise PublicationError("book is not canonical")
    e = html.escape
    out = ["<!doctype html>", '<html><head><meta charset="utf-8"><title>', e(book.manifest.title), "</title></head><body>", f"<h1>{e(book.manifest.title)}</h1>", f"<p>Manifest: <code>{e(book.manifest.manifest_id)}</code></p>", "<p>Synthetic: <code>true</code></p>", f"<p>Source commit: <code>{e(book.source_commit)}</code></p>"]
    for chapter in book.chapters:
        out += [f'<section id="{e(chapter.anchor, quote=True)}"><h2>{e(chapter.title)}</h2><p>{e(chapter.text)}</p>']
        out += [f'<p>See <a href="#{e(ref, quote=True)}">{e(ref)}</a>.</p>' for ref in chapter.references]
        out.append("</section>")
    out += ["<h2>Bibliography</h2><ul>"] + [f"<li><code>{e(c.identity)}</code></li>" for c in book.bibliography] + ["</ul></body></html>"]
    return "".join(out).encode("utf-8")
