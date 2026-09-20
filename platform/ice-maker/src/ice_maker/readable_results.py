"""Deterministic, inert rendering of validated indexed document chunks."""

from __future__ import annotations

import html
import math
import re
from typing import Iterable

from .extraction import ExtractedChunk
from .knowledge_index import IndexError as KnowledgeIndexError, validate_chunk


MAX_SOURCE_CHUNKS = 10_000
MAX_LISTING_BYTES = 64 * 1024
MAX_MARKDOWN_BYTES = 256 * 1024
MAX_HTML_BYTES = 256 * 1024
_HASH = re.compile(r"^[0-9a-f]{64}$")


class ReadableResultError(ValueError):
    """Readable output cannot be derived safely from the supplied state."""


class ReadableResultTooLarge(ReadableResultError):
    """A readable result exceeds a contract ceiling."""


def _canonical_hash(value: object) -> str:
    if not isinstance(value, str) or not _HASH.fullmatch(value):
        raise ReadableResultError("identifier is invalid")
    return value


def _validated_chunks(
    chunks: Iterable[ExtractedChunk], source_sha256: str
) -> tuple[ExtractedChunk, ...]:
    source_sha256 = _canonical_hash(source_sha256)
    try:
        iterator = iter(chunks)
    except TypeError as exc:
        raise ReadableResultError("source state is invalid") from exc
    values: list[ExtractedChunk] = []
    for item in iterator:
        if len(values) >= MAX_SOURCE_CHUNKS:
            raise ReadableResultTooLarge("readable result is too large")
        try:
            item = validate_chunk(item)
        except KnowledgeIndexError as exc:
            raise ReadableResultError("source state is invalid") from exc
        if item.source_sha256 != source_sha256:
            raise ReadableResultError("source state is invalid")
        values.append(item)
    if not values or len({item.chunk_id for item in values}) != len(values):
        raise ReadableResultError("source state is invalid")
    return tuple(values)


def _native_range(item: ExtractedChunk) -> tuple[int, int]:
    try:
        offset, reserved, length = (
            int(value) for value in item.region[5:].split(",")
        )
    except (AttributeError, ValueError) as exc:
        raise ReadableResultError("source provenance is invalid") from exc
    if not item.region.startswith("text:") or reserved != 0:
        raise ReadableResultError("source provenance is invalid")
    return offset, length


def _rectangle(item: ExtractedChunk) -> tuple[int, int, int, int]:
    try:
        prefix, raw = item.region.split(":", 1)
        left, top, width, height = (int(value) for value in raw.split(","))
    except (AttributeError, ValueError) as exc:
        raise ReadableResultError("source provenance is invalid") from exc
    if prefix != "pixels":
        raise ReadableResultError("source provenance is invalid")
    return left, top, width, height


def _ordered_page(items: list[ExtractedChunk]) -> tuple[ExtractedChunk, ...]:
    if all(item.method == "pdf-text" for item in items):
        ordered = tuple(
            sorted(items, key=lambda item: (*_native_range(item), item.chunk_id))
        )
        expected = 0
        for item in ordered:
            offset, length = _native_range(item)
            if offset != expected or length != len(item.text) or item.confidence != 1.0:
                raise ReadableResultError("source text ranges are invalid")
            expected += length
        return ordered
    if all(item.method in {"ocr", "ocr-pbm"} for item in items):
        return tuple(
            sorted(
                items,
                key=lambda item: (
                    _rectangle(item)[1],
                    _rectangle(item)[0],
                    _rectangle(item)[2],
                    _rectangle(item)[3],
                    item.chunk_id,
                ),
            )
        )
    raise ReadableResultError("source methods are invalid")


def reconstruct_source(
    chunks: Iterable[ExtractedChunk], source_sha256: str
) -> dict[int, tuple[ExtractedChunk, ...]]:
    """Return validated page groups in deterministic reconstruction order."""
    pages: dict[int, list[ExtractedChunk]] = {}
    for item in _validated_chunks(chunks, source_sha256):
        pages.setdefault(item.page_number, []).append(item)
    return {
        page: _ordered_page(items)
        for page, items in sorted(pages.items())
    }


def _covered_region(items: tuple[ExtractedChunk, ...]) -> str:
    if items[0].method == "pdf-text":
        offset, length = _native_range(items[-1])
        return f"text:0,0,{offset + length}"
    rectangles = tuple(_rectangle(item) for item in items)
    left = min(item[0] for item in rectangles)
    top = min(item[1] for item in rectangles)
    right = max(item[0] + item[2] for item in rectangles)
    bottom = max(item[1] + item[3] for item in rectangles)
    return f"pixels:{left},{top},{right - left},{bottom - top}"


def _ocr_lines(items: tuple[ExtractedChunk, ...]) -> tuple[str, ...]:
    lines: list[tuple[list[str], int, int]] = []
    for item in items:
        _left, top, _width, height = _rectangle(item)
        word = item.text
        if item.confidence < 0.80:
            word = f"[LOW CONFIDENCE {item.confidence:.2f}: {word}]"
        if lines:
            words, anchor_top, anchor_height = lines[-1]
            tolerance = max(2, math.floor(min(anchor_height, height) / 2))
            if abs(top - anchor_top) <= tolerance:
                words.append(word)
                continue
        lines.append(([word], top, height))
    return tuple(" ".join(words) for words, _top, _height in lines)


def _encoded_lines(lines: Iterable[str], maximum: int) -> bytes:
    parts: list[bytes] = []
    size = 0
    try:
        for line in lines:
            part = (line + "\n").encode("utf-8")
            size += len(part)
            if size > maximum:
                raise ReadableResultTooLarge("readable result is too large")
            parts.append(part)
    except UnicodeError as exc:
        raise ReadableResultError("source text is invalid") from exc
    return b"".join(parts)


def render_markdown(
    chunks: Iterable[ExtractedChunk], source_sha256: str
) -> bytes:
    """Render one source as bounded UTF-8 Markdown with inert body lines."""
    source_sha256 = _canonical_hash(source_sha256)
    pages = reconstruct_source(chunks, source_sha256)

    def lines() -> Iterable[str]:
        yield f"# Document {source_sha256}"
        yield ""
        for page, items in pages.items():
            confidence = tuple(float(item.confidence) for item in items)
            methods = ", ".join(sorted({item.method for item in items}))
            yield f"## Page {page}"
            yield (
                f"Provenance: page {page}; methods {methods}; "
                f"covered {_covered_region(items)}; confidence min "
                f"{min(confidence):.2f}, mean "
                f"{sum(confidence) / len(confidence):.2f}, max "
                f"{max(confidence):.2f}"
            )
            yield ""
            body = (
                ("".join(item.text for item in items),)
                if items[0].method == "pdf-text"
                else _ocr_lines(items)
            )
            for line in body:
                yield "    " + line
            yield ""

    return _encoded_lines(lines(), MAX_MARKDOWN_BYTES)


def source_metadata(
    chunks: Iterable[ExtractedChunk], source_sha256: str
) -> dict[str, object]:
    """Return bounded non-content metadata after full reconstruction checks."""
    source_sha256 = _canonical_hash(source_sha256)
    pages = reconstruct_source(chunks, source_sha256)
    values = tuple(item for items in pages.values() for item in items)
    try:
        utf8_bytes = sum(len(item.text.encode("utf-8")) for item in values)
    except UnicodeError as exc:
        raise ReadableResultError("source text is invalid") from exc
    confidence = tuple(float(item.confidence) for item in values)
    return {
        "chunk_count": len(values),
        "confidence_max": round(max(confidence), 6),
        "confidence_mean": round(sum(confidence) / len(confidence), 6),
        "confidence_min": round(min(confidence), 6),
        "methods": sorted({item.method for item in values}),
        "pages": sorted(pages),
        "source_sha256": source_sha256,
        "utf8_bytes": utf8_bytes,
    }


def render_html(markdown: bytes, batch_id: str, source_sha256: str) -> bytes:
    """Place Markdown bytes into a fixed escaped browser document."""
    batch_id = _canonical_hash(batch_id)
    source_sha256 = _canonical_hash(source_sha256)
    if not isinstance(markdown, bytes):
        raise ReadableResultError("Markdown is invalid")
    try:
        escaped = html.escape(markdown.decode("utf-8"), quote=True)
    except UnicodeError as exc:
        raise ReadableResultError("Markdown is invalid") from exc
    link = (
        f"/api/batches/{batch_id}/documents/{source_sha256}/markdown"
    )
    page = (
        '<!doctype html><meta charset="utf-8">'
        "<title>Ice Maker readable document</title>"
        f"<pre>{escaped}</pre>"
        f'<p><a href="{link}" download="document-{source_sha256}.md">'
        "Download Markdown</a></p>"
    )
    encoded = page.encode("utf-8")
    if len(encoded) > MAX_HTML_BYTES:
        raise ReadableResultTooLarge("readable result is too large")
    return encoded
