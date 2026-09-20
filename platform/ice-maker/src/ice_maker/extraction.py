"""Bounded extraction for *synthetic* PDF fixtures and ASCII PBM images.

This is intentionally not a general PDF parser or OCR engine.  PDFs must carry
the ``%ICE-MAKER-SYNTHETIC-PDF`` marker and ``%%ICE-PAGE N`` comments.  Bitmap
OCR recognizes only the 3x5 uppercase glyphs below, separated by one blank
column.  It exists to make offline fixture tests reproducible; production OCR
remains an external-pending capability.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import tempfile
from typing import Callable


EXTRACTOR_VERSION = "synthetic-extractor-v1"
OCR_VERSION = "synthetic-pbm-3x5-v1"
_MAX_BYTES = 1_000_000
_MAX_PAGES = 32
_MAX_DIMENSION = 256
_MAX_GLYPHS = 128
_MAX_OUTPUT = 16_384
_PAGE = re.compile(br"(?m)^%%ICE-PAGE ([1-9][0-9]*)\r?$")
_TEXT = re.compile(br"BT\s*\(([^()]{0,16384})\)\s*Tj\s*ET")
_SECRET = re.compile(r"(?:api[_-]?key|secret|token|password)\s*[:=]", re.IGNORECASE)
_TEXT_REGION = re.compile(r"text:0,0,([1-9][0-9]{0,4})$")
_PIXEL_REGION = re.compile(r"pixels:0,0,([1-9][0-9]{0,2}),([1-9][0-9]{0,2})$")
_SHA256 = re.compile(r"[0-9a-f]{64}$")

# A, E, H, I, L, O.  Additions deliberately require a version bump and test.
_GLYPHS = {
    ("010", "101", "111", "101", "101"): "A",
    ("111", "100", "110", "100", "111"): "E",
    ("101", "101", "111", "101", "101"): "H",
    ("111", "010", "010", "010", "111"): "I",
    ("100", "100", "100", "100", "111"): "L",
    ("010", "101", "101", "101", "010"): "O",
}


class ExtractionError(ValueError):
    """An unsafe, malformed, unsupported, or corrupt extraction input."""


@dataclass(frozen=True)
class ExtractedPage:
    source_sha256: str
    page_number: int
    region: str
    method: str
    text: str
    confidence: float


@dataclass(frozen=True)
class ExtractedChunk:
    source_sha256: str
    page_number: int
    region: str
    method: str
    text: str
    confidence: float
    chunk_id: str


@dataclass(frozen=True)
class ExtractionResult:
    source_sha256: str
    pages: tuple[ExtractedPage, ...]
    chunks: tuple[ExtractedChunk, ...]
    cache_hit: bool = False


def extract_bytes(source: bytes, *, cache_dir: Path | None = None,
                  ocr_decoder: Callable[[bytes], str] | None = None) -> ExtractionResult:
    """Extract one bounded fixture, optionally reusing caller-owned local cache.

    ``ocr_decoder`` is a test seam only; callers must not use it as a production
    OCR claim.  Its result undergoes the same output controls as pixel decoding.
    """
    if not isinstance(source, bytes) or not source or len(source) > _MAX_BYTES:
        raise ExtractionError("source must be non-empty bounded bytes")
    source_hash = hashlib.sha256(source).hexdigest()
    cache_path = _cache_path(cache_dir, source_hash) if cache_dir is not None else None
    if cache_path is not None and _cache_entry_exists(cache_path):
        return _load_cache(cache_path, source_hash)

    if source.startswith(b"%PDF-"):
        pages = _extract_pdf(source, source_hash, ocr_decoder)
    elif source.startswith(b"P1"):
        pages = (_ocr_page(source, source_hash, 1, ocr_decoder),)
    else:
        raise ExtractionError("unsupported source format")
    if len(pages) > _MAX_PAGES:
        raise ExtractionError("too many pages")
    result = _result(source_hash, pages)
    if cache_path is not None:
        _publish_cache(cache_path, result)
    return result


def _extract_pdf(source: bytes, source_hash: str,
                 ocr_decoder: Callable[[bytes], str] | None) -> tuple[ExtractedPage, ...]:
    if b"%ICE-MAKER-SYNTHETIC-PDF" not in source or b"%%EOF" not in source:
        raise ExtractionError("unsupported synthetic PDF")
    markers = list(_PAGE.finditer(source))
    if not markers or len(markers) > _MAX_PAGES:
        raise ExtractionError("unsupported synthetic PDF")
    pages: list[ExtractedPage] = []
    for expected, marker in enumerate(markers, 1):
        if int(marker.group(1)) != expected:
            raise ExtractionError("unsupported synthetic PDF page markers")
        block = source[marker.end():markers[expected].start() if expected < len(markers) else len(source)]
        text = _TEXT.search(block)
        if text is not None:
            try:
                decoded = text.group(1).decode("ascii")
            except UnicodeDecodeError as exc:
                raise ExtractionError("unsupported synthetic PDF text encoding") from exc
            normalized = _safe_text(decoded)
            pages.append(ExtractedPage(source_hash, expected, f"text:0,0,{len(normalized)}",
                                       "pdf-text", normalized, 1.0))
            continue
        stream = _pbm_stream(block)
        if stream is None:
            raise ExtractionError("unsupported synthetic PDF page")
        pages.append(_ocr_page(stream, source_hash, expected, ocr_decoder))
    return tuple(pages)


def _pbm_stream(block: bytes) -> bytes | None:
    start = block.find(b"P1")
    end = block.find(b"endstream", start)
    if start < 0 or end < 0:
        return None
    return block[start:end]


def _ocr_page(image: bytes, source_hash: str, page: int,
              decoder: Callable[[bytes], str] | None) -> ExtractedPage:
    width, height, rows = _parse_pbm(image)
    if decoder is None:
        text = _decode_glyphs(width, height, rows)
        confidence = 0.99
    else:
        text = decoder(image)
        confidence = 0.50
    normalized = _safe_text(text)
    return ExtractedPage(source_hash, page, f"pixels:0,0,{width},{height}", "ocr-pbm",
                         normalized, confidence)


def _parse_pbm(image: bytes) -> tuple[int, int, tuple[tuple[str, ...], ...]]:
    try:
        text = image.decode("ascii")
    except UnicodeDecodeError as exc:
        raise ExtractionError("PBM must be ASCII") from exc
    tokens = re.findall(r"(?:^|\n)[ \t]*#[^\n]*|[^\s]+", text)
    values = [item for item in tokens if not item.lstrip().startswith("#")]
    if len(values) < 3 or values[0] != "P1":
        raise ExtractionError("unsupported PBM")
    try:
        width, height = int(values[1]), int(values[2])
    except ValueError as exc:
        raise ExtractionError("invalid PBM dimensions") from exc
    if not 1 <= width <= _MAX_DIMENSION or not 1 <= height <= _MAX_DIMENSION:
        raise ExtractionError("PBM dimensions exceed limit")
    pixels = values[3:]
    if len(pixels) != width * height or any(pixel not in {"0", "1"} for pixel in pixels):
        raise ExtractionError("invalid PBM pixels")
    return width, height, tuple(tuple(pixels[row * width:(row + 1) * width]) for row in range(height))


def _decode_glyphs(width: int, height: int, rows: tuple[tuple[str, ...], ...]) -> str:
    if height != 5 or width < 3:
        raise ExtractionError("unknown synthetic glyph")
    letters: list[str] = []
    column = 0
    while column < width:
        if len(letters) >= _MAX_GLYPHS or column + 3 > width:
            raise ExtractionError("unknown synthetic glyph")
        glyph = tuple("".join(rows[row][column:column + 3]) for row in range(5))
        letter = _GLYPHS.get(glyph)
        if letter is None:
            raise ExtractionError("unknown synthetic glyph")
        letters.append(letter)
        column += 3
        if column == width:
            break
        if any(rows[row][column] != "0" for row in range(5)):
            raise ExtractionError("unknown synthetic glyph")
        column += 1
    return "".join(letters)


def _safe_text(value: str) -> str:
    if not isinstance(value, str):
        raise ExtractionError("unsafe extracted output")
    normalized = " ".join(value.split())
    if (not normalized or len(normalized) > _MAX_OUTPUT or any(ord(char) < 32 or ord(char) > 126 for char in normalized)
            or _SECRET.search(normalized)):
        raise ExtractionError("unsafe extracted output")
    return normalized


def _result(source_hash: str, pages: tuple[ExtractedPage, ...]) -> ExtractionResult:
    chunks = tuple(ExtractedChunk(page.source_sha256, page.page_number, page.region, page.method,
                                  page.text, page.confidence,
                                  _chunk_id(page)) for page in pages)
    return ExtractionResult(source_hash, pages, chunks)


def _chunk_id(page: ExtractedPage) -> str:
    data = f"{page.source_sha256}\0{page.page_number}\0{page.region}\0{page.method}\0{page.text}".encode()
    return hashlib.sha256(data).hexdigest()


def _cache_path(cache_dir: Path, source_hash: str) -> Path:
    if not _SHA256.fullmatch(source_hash):
        raise ExtractionError("invalid cache name")
    root = _ensure_cache_directory(Path(cache_dir))
    return root / f"{source_hash}.json"


def _ensure_cache_directory(root: Path) -> Path:
    """Create a cache directory without traversing any symlink component."""
    if any(part in {"", ".", ".."} for part in root.parts):
        raise ExtractionError("unsafe cache directory")
    absolute = root.absolute()
    current = Path(absolute.anchor)
    for name in absolute.parts[1:]:
        if name in {"", ".", ".."}:
            raise ExtractionError("unsafe cache directory")
        current /= name
        try:
            mode = os.lstat(current).st_mode
        except FileNotFoundError:
            try:
                os.mkdir(current)
            except FileExistsError:
                pass
            try:
                mode = os.lstat(current).st_mode
            except FileNotFoundError as exc:
                raise ExtractionError("cache directory changed") from exc
        except OSError as exc:
            raise ExtractionError("invalid cache directory") from exc
        if stat.S_ISLNK(mode):
            raise ExtractionError("symlinked cache is not allowed")
        if not stat.S_ISDIR(mode):
            raise ExtractionError("invalid cache directory")
    return absolute


def _cache_entry_exists(path: Path) -> bool:
    _ensure_cache_directory(path.parent)
    try:
        mode = os.lstat(path).st_mode
    except FileNotFoundError:
        return False
    if stat.S_ISLNK(mode):
        raise ExtractionError("symlinked cache is not allowed")
    if not stat.S_ISREG(mode):
        raise ExtractionError("corrupt cache")
    return True


def _cache_payload(result: ExtractionResult) -> dict[str, object]:
    body: dict[str, object] = {
        "extractor_version": EXTRACTOR_VERSION,
        "ocr_version": OCR_VERSION,
        "source_sha256": result.source_sha256,
        "pages": [asdict(page) for page in result.pages],
        "chunks": [asdict(chunk) for chunk in result.chunks],
    }
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
    body["canonical_digest"] = hashlib.sha256(canonical).hexdigest()
    return body


def _publish_cache(path: Path, result: ExtractionResult) -> None:
    _ensure_cache_directory(path.parent)
    if _cache_entry_exists(path):
        _verify_collision(path, result)
        return
    data = json.dumps(_cache_payload(result), sort_keys=True, separators=(",", ":")).encode()
    descriptor, temporary = tempfile.mkstemp(prefix=".extract-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, path)  # atomic publication and never replaces.
        except FileExistsError:
            _verify_collision(path, result)
    except OSError as exc:
        raise ExtractionError("cache publication failed") from exc
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def _verify_collision(path: Path, result: ExtractionResult) -> None:
    """A concurrent winner is safe only when it is exactly our result."""
    winner = _load_cache(path, result.source_sha256)
    if (winner.source_sha256 != result.source_sha256 or winner.pages != result.pages
            or winner.chunks != result.chunks):
        raise ExtractionError("cache publication collision")


def _load_cache(path: Path, source_hash: str) -> ExtractionResult:
    _ensure_cache_directory(path.parent)
    try:
        mode = os.lstat(path).st_mode
    except OSError as exc:
        raise ExtractionError("corrupt cache") from exc
    if stat.S_ISLNK(mode):
        raise ExtractionError("symlinked cache is not allowed")
    if not stat.S_ISREG(mode):
        raise ExtractionError("corrupt cache")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_no_duplicate_object)
        _validate_cache_envelope(payload, source_hash)
        body = {key: value for key, value in payload.items() if key != "canonical_digest"}
        canonical = json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
        if payload["canonical_digest"] != hashlib.sha256(canonical).hexdigest():
            raise ValueError
        pages = tuple(_page_from_cache(item, source_hash, number) for number, item in enumerate(payload["pages"], 1))
        chunks = tuple(_chunk_from_cache(item, page) for item, page in zip(payload["chunks"], pages))
        result = ExtractionResult(source_hash, pages, chunks, True)
        expected = _result(source_hash, pages)
        if expected.chunks != chunks:
            raise ValueError
        return result
    except (ExtractionError, KeyError, TypeError, ValueError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ExtractionError("corrupt cache") from exc


def _no_duplicate_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _validate_cache_envelope(payload: object, source_hash: str) -> None:
    keys = {"extractor_version", "ocr_version", "source_sha256", "pages", "chunks", "canonical_digest"}
    if not isinstance(payload, dict) or set(payload) != keys:
        raise ValueError("invalid cache schema")
    if (payload["extractor_version"] != EXTRACTOR_VERSION or payload["ocr_version"] != OCR_VERSION
            or payload["source_sha256"] != source_hash or not _SHA256.fullmatch(source_hash)
            or not isinstance(payload["canonical_digest"], str) or not _SHA256.fullmatch(payload["canonical_digest"])):
        raise ValueError("invalid cache metadata")
    if (not isinstance(payload["pages"], list) or not isinstance(payload["chunks"], list)
            or not payload["pages"] or len(payload["pages"]) > _MAX_PAGES
            or len(payload["pages"]) != len(payload["chunks"])):
        raise ValueError("invalid cache cardinality")


def _page_from_cache(item: object, expected_source: str, expected_number: int) -> ExtractedPage:
    keys = {"source_sha256", "page_number", "region", "method", "text", "confidence"}
    if not isinstance(item, dict) or set(item) != keys:
        raise ValueError("invalid cache page")
    source, number, region, method, text, confidence = (item[key] for key in
                                                          ("source_sha256", "page_number", "region", "method", "text", "confidence"))
    if (not isinstance(source, str) or source != expected_source or not _SHA256.fullmatch(source) or type(number) is not int
            or number != expected_number or not isinstance(region, str) or not isinstance(method, str)
            or type(confidence) not in {int, float} or not math.isfinite(confidence)):
        raise ValueError("invalid cache page")
    if _safe_text(text) != text:
        raise ValueError("invalid cache text")
    if method == "pdf-text":
        match = _TEXT_REGION.fullmatch(region)
        if match is None or int(match.group(1)) != len(text) or confidence != 1.0:
            raise ValueError("invalid text page")
    elif method == "ocr-pbm":
        match = _PIXEL_REGION.fullmatch(region)
        if (match is None or int(match.group(1)) > _MAX_DIMENSION or int(match.group(2)) > _MAX_DIMENSION
                or confidence < 0.0 or confidence > 1.0):
            raise ValueError("invalid OCR page")
    else:
        raise ValueError("invalid cache method")
    return ExtractedPage(source, number, region, method, text, float(confidence))


def _chunk_from_cache(item: object, page: ExtractedPage) -> ExtractedChunk:
    keys = {"source_sha256", "page_number", "region", "method", "text", "confidence", "chunk_id"}
    if not isinstance(item, dict) or set(item) != keys:
        raise ValueError("invalid cache chunk")
    if any(item[key] != getattr(page, key) for key in keys - {"chunk_id"}):
        raise ValueError("cache chunk/page mismatch")
    identifier = item["chunk_id"]
    if not isinstance(identifier, str) or not _SHA256.fullmatch(identifier) or identifier != _chunk_id(page):
        raise ValueError("invalid cache chunk")
    return ExtractedChunk(page.source_sha256, page.page_number, page.region, page.method,
                          page.text, page.confidence, identifier)
