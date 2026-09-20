"""Fail-closed local PNG/JPEG/WebP OCR boundary.

Only immutable metadata crosses this module's public boundary.  Pillow objects,
source bytes, paths, and scratch names remain private to ``extract_raster``.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import resource
import signal
import stat
import subprocess
import tempfile
import time
import unicodedata
import warnings
from typing import Any, Callable, Mapping, Sequence

from .document_batch import CODE_MAXIMA, CONFIG_SCHEMA, SourceDescriptor


class ProductionExtractionError(ValueError):
    """A stable, safe failure at the untrusted image/OCR boundary."""


EXTRACTOR_VERSION = "production-raster-ocr-v1"
METHOD = "ocr-tesseract-tsv"
PDF_EXTRACTOR_VERSION = "production-pdf-v2"
PDF_TEXT_METHOD = "pdf-text"
PDF_OCR_METHOD = "ocr"
MIN_USEFUL_PDF_TEXT_BYTES = 20
_FORMATS = frozenset(("png", "jpeg", "webp"))
_MODES = frozenset(("1", "L", "LA", "RGB", "RGBA"))
_HEADER = ("level", "page_num", "block_num", "par_num", "line_num", "word_num",
           "left", "top", "width", "height", "conf", "text")
_SECRET = re.compile(r"(?:api[_-]?key|secret|token|password)\s*[:=]", re.I)
_HASH = re.compile(r"^[0-9a-f]{64}$")
_LANGUAGE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
_VERSION = re.compile(r"^[A-Za-z0-9 ._+()=-]{1,256}$")
_INTEGER = re.compile(r"^(?:0|[1-9][0-9]*)$")
_CONFIDENCE = re.compile(r"^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$")
_MAX_WORD_TEXT = 512
_MAX_ROWS = 500_000


def _safe_text(value: Any, *, limit: int = _MAX_WORD_TEXT) -> str:
    if not isinstance(value, str):
        raise ProductionExtractionError("unsafe OCR text")
    normalized = unicodedata.normalize("NFKC", " ".join(value.split()))
    if not normalized or len(normalized) > limit or _SECRET.search(normalized):
        raise ProductionExtractionError("unsafe OCR text")
    for char in normalized:
        code = ord(char)
        if (unicodedata.category(char) in {"Cc", "Cs"} or 0x202A <= code <= 0x202E
                or 0x2066 <= code <= 0x2069 or (code & 0xFFFF) in {0xFFFE, 0xFFFF}):
            raise ProductionExtractionError("unsafe OCR text")
    return normalized


@dataclass(frozen=True, slots=True)
class Tile:
    left: int
    top: int
    width: int
    height: int

    def __post_init__(self) -> None:
        values = (self.left, self.top, self.width, self.height)
        if (
            any(type(value) is not int for value in values)
            or self.left < 0
            or self.top < 0
            or self.width <= 0
            or self.height <= 0
        ):
            raise ProductionExtractionError("invalid tile")


@dataclass(frozen=True, slots=True)
class DecodedImage:
    source_sha256: str
    format: str
    width: int
    height: int
    mode: str

    def __post_init__(self) -> None:
        if (
            not isinstance(self.source_sha256, str)
            or not _HASH.fullmatch(self.source_sha256)
            or not isinstance(self.format, str)
            or self.format not in _FORMATS
            or type(self.width) is not int
            or type(self.height) is not int
            or self.width <= 0
            or self.height <= 0
            or not isinstance(self.mode, str)
            or self.mode not in _MODES
        ):
            raise ProductionExtractionError("invalid decoded image")


@dataclass(frozen=True, slots=True)
class OcrWord:
    text: str
    confidence: float
    left: int
    top: int
    width: int
    height: int

    def __post_init__(self) -> None:
        if (
            _safe_text(self.text) != self.text
            or isinstance(self.confidence, bool)
            or not isinstance(self.confidence, (int, float))
            or not math.isfinite(self.confidence)
            or not 0 <= self.confidence <= 1
            or any(
                type(value) is not int
                for value in (self.left, self.top, self.width, self.height)
            )
            or self.left < 0
            or self.top < 0
            or self.width <= 0
            or self.height <= 0
        ):
            raise ProductionExtractionError("invalid OCR word")

    @property
    def region(self) -> tuple[int, int, int, int]:
        return (self.left, self.top, self.width, self.height)


@dataclass(frozen=True, slots=True)
class RasterExtraction:
    source_sha256: str
    method: str
    extractor_version: str
    config_sha256: str
    tool_version: str
    tool_version_sha256: str
    width: int
    height: int
    tiles: tuple[Tile, ...]
    words: tuple[OcrWord, ...]
    text: str
    confidence: float

    def __post_init__(self) -> None:
        valid_dimensions = (
            type(self.width) is int
            and type(self.height) is int
            and self.width > 0
            and self.height > 0
        )
        valid_tiles = (
            valid_dimensions
            and isinstance(self.tiles, tuple)
            and bool(self.tiles)
            and all(type(tile) is Tile for tile in self.tiles)
        )
        if valid_tiles:
            valid_tiles = (
                self.tiles[0].top == 0
                and self.tiles[-1].top + self.tiles[-1].height == self.height
                and all(
                    tile.left == 0
                    and tile.width == self.width
                    and tile.top + tile.height <= self.height
                    for tile in self.tiles
                )
                and all(
                    previous.top < current.top <= previous.top + previous.height
                    for previous, current in zip(self.tiles, self.tiles[1:])
                )
            )
        valid_words = (
            isinstance(self.words, tuple)
            and bool(self.words)
            and all(type(word) is OcrWord for word in self.words)
        )
        if valid_words:
            order = lambda word: (
                word.top,
                word.left,
                word.height,
                word.width,
                word.text,
            )
            valid_words = (
                tuple(sorted(self.words, key=order)) == self.words
                and len({(word.text, word.region) for word in self.words})
                == len(self.words)
                and all(
                    word.left + word.width <= self.width
                    and word.top + word.height <= self.height
                    for word in self.words
                )
            )
        text_is_valid = False
        if isinstance(self.text, str):
            try:
                text_is_valid = (
                    len(self.text.encode("utf-8"))
                    <= CODE_MAXIMA["max_ocr_output_bytes"]
                    and _safe_text(
                        self.text,
                        limit=CODE_MAXIMA["max_ocr_output_bytes"],
                    )
                    == self.text
                )
            except UnicodeError:
                text_is_valid = False
        expected_confidence = (
            math.fsum(word.confidence for word in self.words) / len(self.words)
            if valid_words
            else math.nan
        )
        if (
            not isinstance(self.source_sha256, str)
            or not _HASH.fullmatch(self.source_sha256)
            or self.method != METHOD
            or self.extractor_version != EXTRACTOR_VERSION
            or not isinstance(self.config_sha256, str)
            or not _HASH.fullmatch(self.config_sha256)
            or not isinstance(self.tool_version, str)
            or not _VERSION.fullmatch(self.tool_version)
            or _SECRET.search(self.tool_version)
            or not isinstance(self.tool_version_sha256, str)
            or self.tool_version_sha256
            != hashlib.sha256(self.tool_version.encode("ascii")).hexdigest()
            or not valid_dimensions
            or not valid_tiles
            or not valid_words
            or not text_is_valid
            or self.text != " ".join(word.text for word in self.words)
            or isinstance(self.confidence, bool)
            or not isinstance(self.confidence, (int, float))
            or not math.isfinite(self.confidence)
            or not 0 <= self.confidence <= 1
            or not math.isclose(
                self.confidence,
                expected_confidence,
                rel_tol=0,
                abs_tol=1e-12,
            )
        ):
            raise ProductionExtractionError("invalid raster evidence")


@dataclass(frozen=True, slots=True)
class PdfPageExtraction:
    """Immutable, page-scoped PDF evidence without source bytes or paths."""
    source_sha256: str
    page: int
    method: str
    text: str
    confidence: float
    text_region: tuple[int, int] | None
    ocr_words: tuple[OcrWord, ...]
    raster_sha256: str | None
    raster_width: int | None
    raster_height: int | None
    extractor_version: str
    config_sha256: str
    tool_versions_sha256: str
    chunk_id: str

    def __post_init__(self) -> None:
        try:
            valid_text = (
                isinstance(self.text, str)
                and _safe_text(self.text, limit=CODE_MAXIMA["max_ocr_output_bytes"])
                == self.text
                and len(self.text.encode("utf-8")) <= CODE_MAXIMA["max_ocr_output_bytes"]
            )
        except (ProductionExtractionError, UnicodeError, TypeError):
            valid_text = False
        native = self.method == PDF_TEXT_METHOD
        ocr = self.method == PDF_OCR_METHOD
        valid_words = isinstance(self.ocr_words, tuple) and all(
            type(word) is OcrWord for word in self.ocr_words
        )
        expected_confidence = 1.0 if native else (
            math.fsum(word.confidence for word in self.ocr_words) / len(self.ocr_words)
            if valid_words and self.ocr_words else math.nan
        )
        valid_native = (
            native and type(self.text_region) is tuple and len(self.text_region) == 2
            and all(type(value) is int for value in self.text_region)
            and valid_text
            and self.text_region == (0, len(self.text))
            and valid_words and not self.ocr_words
            and self.raster_sha256 is None and self.raster_width is None
            and self.raster_height is None
        )
        valid_ocr = (
            ocr and self.text_region is None and valid_words and bool(self.ocr_words)
            and self.text == " ".join(word.text for word in self.ocr_words)
            and isinstance(self.raster_sha256, str) and _HASH.fullmatch(self.raster_sha256)
            and type(self.raster_width) is int and type(self.raster_height) is int
            and self.raster_width > 0 and self.raster_height > 0
            and tuple(sorted(self.ocr_words, key=lambda word: (
                word.top, word.left, word.height, word.width, word.text,
            ))) == self.ocr_words
            and len({(word.text, word.region) for word in self.ocr_words}) == len(self.ocr_words)
            and all(word.left + word.width <= self.raster_width
                    and word.top + word.height <= self.raster_height
                    for word in self.ocr_words)
        )
        identity = ""
        try:
            identity = canonical_pdf_chunk_id(
                self.source_sha256, self.page, self.method, self.config_sha256,
                self.tool_versions_sha256, text=self.text,
                text_region=self.text_region, ocr_words=self.ocr_words,
                raster_sha256=self.raster_sha256, raster_width=self.raster_width,
                raster_height=self.raster_height,
            )
        except (TypeError, ProductionExtractionError):
            pass
        if (
            not isinstance(self.source_sha256, str) or not _HASH.fullmatch(self.source_sha256)
            or type(self.page) is not int or not 1 <= self.page <= CODE_MAXIMA["max_pdf_pages"]
            or not (native or ocr)
            or not valid_text or not (valid_native or valid_ocr)
            or self.extractor_version != PDF_EXTRACTOR_VERSION
            or not isinstance(self.config_sha256, str) or not _HASH.fullmatch(self.config_sha256)
            or not isinstance(self.tool_versions_sha256, str) or not _HASH.fullmatch(self.tool_versions_sha256)
            or not isinstance(self.chunk_id, str) or self.chunk_id != identity
            or isinstance(self.confidence, bool) or not isinstance(self.confidence, (int, float))
            or not math.isfinite(self.confidence) or not 0 <= self.confidence <= 1
            or not math.isclose(self.confidence, expected_confidence, rel_tol=0, abs_tol=1e-12)
        ):
            raise ProductionExtractionError("invalid PDF page evidence")


def canonical_pdf_chunk_id(source_sha256: str, page: int, method: str,
                           config_sha256: str, tool_versions_sha256: str, *, text: str,
                           text_region: tuple[int, int] | None,
                           ocr_words: tuple[OcrWord, ...],
                           raster_sha256: str | None = None,
                           raster_width: int | None = None,
                           raster_height: int | None = None) -> str:
    """Return a citation ID bound to immutable, canonical page evidence."""
    if (
        not isinstance(source_sha256, str) or not _HASH.fullmatch(source_sha256)
        or type(page) is not int or page <= 0 or method not in {PDF_TEXT_METHOD, PDF_OCR_METHOD}
        or not isinstance(config_sha256, str) or not _HASH.fullmatch(config_sha256)
        or not isinstance(tool_versions_sha256, str) or not _HASH.fullmatch(tool_versions_sha256)
    ):
        return ""
    if not isinstance(text, str) or not isinstance(ocr_words, tuple):
        return ""
    rectangles: list[dict[str, Any]] = []
    for word in ocr_words:
        if type(word) is not OcrWord:
            return ""
        rectangles.append({"confidence": word.confidence, "height": word.height,
                           "left": word.left, "text": word.text, "top": word.top,
                           "width": word.width})
    return hashlib.sha256(
        json.dumps(
            {"config_sha256": config_sha256, "method": method, "page": page,
             "source_sha256": source_sha256, "tool_versions_sha256": tool_versions_sha256,
             "text": text, "text_region": text_region, "ocr_rectangles": rectangles,
             "raster_sha256": raster_sha256, "raster_width": raster_width,
             "raster_height": raster_height},
            sort_keys=True, separators=(",", ":"), ensure_ascii=True,
        ).encode("ascii")
    ).hexdigest()


def _canonical_languages(value: Any, *, require_nonempty: bool = True) -> bool:
    return (
        isinstance(value, tuple)
        and (bool(value) or not require_nonempty)
        and all(isinstance(language, str) and _LANGUAGE.fullmatch(language)
                for language in value)
        and tuple(sorted(set(value))) == value
    )


def pdf_cache_key(source_sha256: str, config_sha256: str, poppler_version: str,
                  tesseract_version: str, languages: tuple[str, ...]) -> str:
    if (
        not isinstance(source_sha256, str) or not _HASH.fullmatch(source_sha256)
        or not isinstance(config_sha256, str) or not _HASH.fullmatch(config_sha256)
        or not isinstance(poppler_version, str) or not _VERSION.fullmatch(poppler_version)
        or _SECRET.search(poppler_version)
        or not isinstance(tesseract_version, str) or not _VERSION.fullmatch(tesseract_version)
        or _SECRET.search(tesseract_version)
        or not _canonical_languages(languages)
    ):
        raise ProductionExtractionError("PDF cache inputs are invalid")
    return hashlib.sha256(json.dumps(
        {"config_sha256": config_sha256, "extractor_version": PDF_EXTRACTOR_VERSION,
         "languages": languages,
         "poppler_version": poppler_version, "source_sha256": source_sha256,
         "tesseract_version": tesseract_version},
        sort_keys=True, separators=(",", ":"), ensure_ascii=True,
    ).encode("ascii")).hexdigest()


def _tool_versions_digest(poppler_version: str, tesseract_version: str) -> str:
    if (not isinstance(poppler_version, str) or not _VERSION.fullmatch(poppler_version)
            or _SECRET.search(poppler_version)
            or not isinstance(tesseract_version, str) or not _VERSION.fullmatch(tesseract_version)
            or _SECRET.search(tesseract_version)):
        raise ProductionExtractionError("PDF tool versions are invalid")
    return hashlib.sha256(json.dumps(
        {"poppler": poppler_version, "tesseract": tesseract_version},
        sort_keys=True, separators=(",", ":"), ensure_ascii=True,
    ).encode("ascii")).hexdigest()


@dataclass(frozen=True, slots=True)
class PdfExtraction:
    source_sha256: str
    pages: tuple[PdfPageExtraction, ...]
    extractor_version: str
    config_sha256: str
    tool_versions_sha256: str
    poppler_version: str
    tesseract_version: str
    languages: tuple[str, ...]
    cache_key: str

    def __post_init__(self) -> None:
        try:
            valid_pages = (
                isinstance(self.pages, tuple) and bool(self.pages)
                and len(self.pages) <= CODE_MAXIMA["max_pdf_pages"]
                and all(type(page) is PdfPageExtraction for page in self.pages)
                and [page.page for page in self.pages] == list(range(1, len(self.pages) + 1))
                and len({page.chunk_id for page in self.pages}) == len(self.pages)
            )
            valid_languages = _canonical_languages(self.languages)
            valid_tools = (isinstance(self.poppler_version, str) and _VERSION.fullmatch(self.poppler_version)
                           and isinstance(self.tesseract_version, str) and _VERSION.fullmatch(self.tesseract_version))
        except (TypeError, ProductionExtractionError):
            valid_pages = valid_languages = valid_tools = False
        if (
            not isinstance(self.source_sha256, str) or not _HASH.fullmatch(self.source_sha256)
            or self.extractor_version != PDF_EXTRACTOR_VERSION
            or not valid_pages
            or any(page.source_sha256 != self.source_sha256 for page in self.pages)
            or any(page.config_sha256 != self.config_sha256 for page in self.pages)
            or any(page.tool_versions_sha256 != self.tool_versions_sha256 for page in self.pages)
            or not valid_tools
            or self.tool_versions_sha256 != _tool_versions_digest(
                self.poppler_version, self.tesseract_version,
            )
            or not valid_languages
            or self.cache_key != pdf_cache_key(
                self.source_sha256, self.config_sha256,
                self.poppler_version, self.tesseract_version, self.languages,
            )
        ):
            raise ProductionExtractionError("invalid PDF extraction evidence")


def _signature(source: bytes) -> str:
    if len(source) >= 8 and source.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if len(source) >= 4 and source[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if len(source) >= 12 and source[:4] == b"RIFF" and source[8:12] == b"WEBP":
        return "webp"
    raise ProductionExtractionError("unsupported image signature")


def _decode(source: bytes, max_pixels: int, max_dimension: int, decoder: Callable[[bytes], tuple[str, int, int, str, object]] | None) -> tuple[DecodedImage, object]:
    signature = _signature(source)
    digest = hashlib.sha256(source).hexdigest()
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error")
            actual, width, height, mode, raster = (decoder(source) if decoder else _pillow_decode(source, max_pixels, max_dimension))
    except ProductionExtractionError:
        raise
    except Exception as exc:
        raise ProductionExtractionError("image decode failed") from exc
    if actual != signature:
        raise ProductionExtractionError("image codec does not match signature")
    if (type(width) is not int or type(height) is not int or width <= 0 or height <= 0
            or width > max_dimension or height > max_dimension or width * height > max_pixels or mode not in _MODES or raster is None):
        raise ProductionExtractionError("image dimensions exceed limit")
    return DecodedImage(digest, actual, width, height, mode), raster


def decode_image(source: bytes, *, expected_sha256: str | None = None, limits: Mapping[str, int] | None = None,
                 decoder: Callable[[bytes], tuple[str, int, int, str, object]] | None = None) -> DecodedImage:
    if not isinstance(source, bytes) or not source:
        raise ProductionExtractionError("invalid image source")
    digest = hashlib.sha256(source).hexdigest()
    if expected_sha256 is not None and (not isinstance(expected_sha256, str) or not _HASH.fullmatch(expected_sha256) or digest != expected_sha256):
        raise ProductionExtractionError("source digest mismatch")
    values = dict(limits or {})
    pixels = values.get(
        "max_decoded_pixels",
        CODE_MAXIMA["max_decoded_pixels"],
    )
    dimension = values.get(
        "max_image_dimension",
        CODE_MAXIMA["max_image_dimension"],
    )
    if any(type(v) is not int or v <= 0 for v in (pixels, dimension)):
        raise ProductionExtractionError("invalid image limits")
    return _decode(source, pixels, dimension, decoder)[0]


def _pillow_decode(source: bytes, max_pixels: int, max_dimension: int) -> tuple[str, int, int, str, object]:
    try:
        from PIL import Image, UnidentifiedImageError
    except ImportError as exc:
        raise ProductionExtractionError("image codec unavailable") from exc
    try:
        with Image.open(io.BytesIO(source)) as probe:
            actual, (width, height), mode = (probe.format or "").lower(), probe.size, probe.mode
            if actual not in _FORMATS or width <= 0 or height <= 0 or width > max_dimension or height > max_dimension or width * height > max_pixels or mode not in _MODES:
                raise ProductionExtractionError("image dimensions exceed limit")
            probe.verify()
        with Image.open(io.BytesIO(source)) as image:
            if (image.format or "").lower() != actual or image.size != (width, height) or image.mode != mode:
                raise ProductionExtractionError("image decode failed")
            image.load()
            return actual, width, height, mode, image.copy()
    except ProductionExtractionError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ProductionExtractionError("image decode failed") from exc


def tile_image(width: int, height: int, tile_height: int, overlap: int) -> tuple[Tile, ...]:
    if any(type(v) is not int for v in (width, height, tile_height, overlap)) or width <= 0 or height <= 0 or tile_height <= 0 or overlap < 0 or overlap >= tile_height:
        raise ProductionExtractionError("invalid tiling limits")
    tiles: list[Tile] = []
    top = 0
    while top < height:
        tile = Tile(0, top, width, min(tile_height, height - top))
        tiles.append(tile)
        if tile.top + tile.height == height:
            break
        top += tile_height - overlap
    return tuple(tiles)


def _integer(value: str) -> int:
    if not _INTEGER.fullmatch(value):
        raise ProductionExtractionError("OCR TSV values are invalid")
    return int(value)


def parse_tsv(data: bytes, tile: Tile, image_size: tuple[int, int], *, max_words: int = 100_000,
              max_output_bytes: int = CODE_MAXIMA["max_ocr_output_bytes"], max_rows: int = _MAX_ROWS) -> tuple[OcrWord, ...]:
    if (not isinstance(data, bytes) or not 0 < len(data) <= max_output_bytes or type(max_words) is not int or type(max_rows) is not int or max_words <= 0 or max_rows <= 0
            or type(image_size) is not tuple or len(image_size) != 2):
        raise ProductionExtractionError("OCR output exceeds limit")
    image_width, image_height = image_size
    if type(image_width) is not int or type(image_height) is not int or image_width <= 0 or image_height <= 0 or tile.left + tile.width > image_width or tile.top + tile.height > image_height:
        raise ProductionExtractionError("invalid image bounds")
    try:
        lines = data.decode("utf-8").splitlines()
    except UnicodeDecodeError as exc:
        raise ProductionExtractionError("OCR output is not UTF-8") from exc
    if not lines or len(lines) - 1 > max_rows or tuple(lines[0].split("\t")) != _HEADER:
        raise ProductionExtractionError("OCR TSV header is invalid")
    words: list[OcrWord] = []
    for row in lines[1:]:
        columns = row.split("\t")
        if len(columns) != 12:
            raise ProductionExtractionError("OCR TSV row is invalid")
        level, page, block, paragraph, line, word_number, left, top, width, height = (_integer(x) for x in (*columns[:6], *columns[6:10]))
        if level not in {1, 2, 3, 4, 5} or page != 1 or any(x < 0 for x in (block, paragraph, line, word_number)) or width < 0 or height < 0 or left < 0 or top < 0 or left + width > tile.width or top + height > tile.height:
            raise ProductionExtractionError("OCR TSV hierarchy is invalid")
        text = columns[11]
        if level != 5:
            if columns[10] != "-1" or text or width <= 0 or height <= 0:
                raise ProductionExtractionError("OCR TSV hierarchy is invalid")
            continue
        if not _CONFIDENCE.fullmatch(columns[10]) or width <= 0 or height <= 0 or word_number < 1 or line < 1 or paragraph < 1 or block < 1:
            raise ProductionExtractionError("OCR confidence is invalid")
        confidence = float(columns[10])
        if not math.isfinite(confidence) or confidence > 100:
            raise ProductionExtractionError("OCR confidence is invalid")
        if not text.split():
            continue
        words.append(OcrWord(_safe_text(text), confidence / 100, tile.left + left, tile.top + top, width, height))
        if len(words) > max_words:
            raise ProductionExtractionError("OCR word limit exceeded")
    return tuple(words)


def deduplicate_words(words: Sequence[OcrWord], *, maximum: int = 100_000) -> tuple[OcrWord, ...]:
    if type(maximum) is not int or maximum <= 0 or len(words) > maximum:
        raise ProductionExtractionError("OCR word limit exceeded")
    unique: dict[tuple[str, tuple[int, int, int, int]], OcrWord] = {}
    for word in words:
        if type(word) is not OcrWord:
            raise ProductionExtractionError("invalid OCR word")
        unique.setdefault((word.text, word.region), word)
    return tuple(sorted(unique.values(), key=lambda word: (word.top, word.left, word.height, word.width, word.text)))


def _config(config: Mapping[str, Any]) -> tuple[Mapping[str, int], str]:
    if not isinstance(config, Mapping) or set(config) != {"schema_version", "limits"} or config["schema_version"] != CONFIG_SCHEMA or not isinstance(config["limits"], Mapping) or set(config["limits"]) != set(CODE_MAXIMA):
        raise ProductionExtractionError("configuration schema is invalid")
    limits: dict[str, int] = {}
    for key, maximum in CODE_MAXIMA.items():
        value = config["limits"][key]
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0 or value > maximum:
            raise ProductionExtractionError("configuration exceeds supported envelope")
        limits[key] = value
    if limits["tile_overlap_pixels"] >= limits["tile_height_pixels"]:
        raise ProductionExtractionError("invalid tiling limits")
    canonical = json.dumps({"schema_version": CONFIG_SCHEMA, "limits": limits}, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    return limits, hashlib.sha256(canonical).hexdigest()


def _regular_absolute(value: Path | str, label: str, executable: bool = False) -> Path:
    try: path = Path(value)
    except TypeError as exc: raise ProductionExtractionError(label + " unavailable") from exc
    if not path.is_absolute() or ".." in path.parts:
        raise ProductionExtractionError(label + " unavailable")
    current = Path(path.anchor)
    try:
        for part in path.parts[1:]:
            current /= part
            if stat.S_ISLNK(os.lstat(current).st_mode):
                raise ProductionExtractionError(label + " unavailable")
        mode = os.stat(path).st_mode
    except OSError as exc:
        raise ProductionExtractionError(label + " unavailable") from exc
    if not stat.S_ISREG(mode) or (executable and not os.access(path, os.X_OK)):
        raise ProductionExtractionError(label + " unavailable")
    return path


def _tool_inputs(executable: str, input_path: Path, languages: tuple[str, ...], installed_languages: tuple[str, ...], tool_version: str) -> tuple[Path, Path]:
    tool, image = _regular_absolute(executable, "OCR executable", True), _regular_absolute(input_path, "OCR input")
    if (not isinstance(languages, tuple) or not languages or tuple(sorted(set(languages))) != languages
            or not isinstance(installed_languages, tuple) or tuple(sorted(set(installed_languages))) != installed_languages
            or any(not isinstance(x, str) or not _LANGUAGE.fullmatch(x) for x in (*languages, *installed_languages))
            or not set(languages).issubset(installed_languages) or not isinstance(tool_version, str) or not _VERSION.fullmatch(tool_version)):
        raise ProductionExtractionError("OCR languages are invalid")
    return tool, image


def run_tesseract(input_path: Path, *, executable: str, languages: tuple[str, ...], installed_languages: tuple[str, ...], tool_version: str, timeout_seconds: int, max_output_bytes: int = CODE_MAXIMA["max_ocr_output_bytes"], runner: Callable[..., subprocess.CompletedProcess[bytes]] | None = None, process_factory: Callable[..., Any] | None = None, poll_interval: float = .01, kill_group: Callable[[int], None] | None = None) -> bytes:
    tool, image = _tool_inputs(executable, input_path, languages, installed_languages, tool_version)
    if (
        type(timeout_seconds) is not int
        or timeout_seconds <= 0
        or type(max_output_bytes) is not int
        or max_output_bytes <= 0
        or isinstance(poll_interval, bool)
        or not isinstance(poll_interval, (int, float))
        or not math.isfinite(poll_interval)
        or not 0 < poll_interval <= 1
    ):
        raise ProductionExtractionError("OCR limits are invalid")
    argv = [str(tool), str(image), "stdout", "-l", "+".join(languages), "tsv"]
    kwargs = {"shell": False, "cwd": str(image.parent), "env": {"LANG": "C", "LC_ALL": "C", "PATH": ""}, "stdin": subprocess.DEVNULL, "stdout": subprocess.PIPE, "stderr": subprocess.PIPE, "timeout": timeout_seconds, "start_new_session": True, "check": False}
    if runner is not None:
        try: completed = runner(argv, **kwargs)
        except subprocess.TimeoutExpired as exc: raise ProductionExtractionError("OCR timed out") from exc
        except OSError as exc: raise ProductionExtractionError("OCR execution failed") from exc
        if (not isinstance(completed, subprocess.CompletedProcess) or type(completed.returncode) is not int or not isinstance(completed.stdout, bytes) or not isinstance(completed.stderr, bytes)):
            raise ProductionExtractionError("OCR execution failed")
        if completed.returncode != 0: raise ProductionExtractionError("OCR execution failed")
        if len(completed.stdout) > max_output_bytes or len(completed.stderr) > max_output_bytes: raise ProductionExtractionError("OCR output exceeds limit")
        return completed.stdout
    return _run_process(argv, timeout_seconds, max_output_bytes, process_factory or subprocess.Popen, poll_interval, kill_group)


def _run_process(argv: list[str], timeout: int, maximum: int, factory: Callable[..., Any], poll_interval: float, kill_group: Callable[[int], None] | None) -> bytes:
    process: Any | None = None
    terminated = False

    def terminate() -> None:
        nonlocal terminated
        if process is None or terminated:
            return
        terminated = True
        try:
            (kill_group or (lambda pid: os.killpg(pid, signal.SIGKILL)))(
                process.pid
            )
        except (OSError, ProcessLookupError):
            pass
        try:
            process.wait()
        except Exception:
            pass

    def limit_output() -> None:
        hard_limit = resource.getrlimit(resource.RLIMIT_FSIZE)[1]
        requested = maximum + 1
        if hard_limit != resource.RLIM_INFINITY:
            requested = min(requested, hard_limit)
        resource.setrlimit(resource.RLIMIT_FSIZE, (requested, requested))

    try:
        with tempfile.TemporaryDirectory(prefix="ice-maker-ocr-") as directory:
            root = Path(directory)
            output = root / "stdout"
            error = root / "stderr"
            with output.open("xb") as stdout, error.open("xb") as stderr:
                process = factory(
                    argv,
                    shell=False,
                    cwd=str(root),
                    env={"LANG": "C", "LC_ALL": "C", "PATH": ""},
                    stdin=subprocess.DEVNULL,
                    stdout=stdout,
                    stderr=stderr,
                    start_new_session=True,
                    preexec_fn=limit_output,
                )
                started = time.monotonic()
                while process.poll() is None:
                    if output.stat().st_size > maximum or error.stat().st_size > maximum:
                        terminate()
                        raise ProductionExtractionError("OCR output exceeds limit")
                    if time.monotonic() - started > timeout:
                        terminate()
                        raise ProductionExtractionError("OCR timed out")
                    time.sleep(poll_interval)
                code = process.wait()
                output_size = output.stat().st_size
                error_size = error.stat().st_size
                if code != 0:
                    terminate()
                    if output_size > maximum or error_size > maximum:
                        raise ProductionExtractionError("OCR output exceeds limit")
                    raise ProductionExtractionError("OCR execution failed")
                # Reap the complete session even after a successful parent exit:
                # a hostile OCR child must not outlive this private scratch tree.
                terminate()
            if output.stat().st_size > maximum or error.stat().st_size > maximum:
                raise ProductionExtractionError("OCR output exceeds limit")
            return output.read_bytes()
    except ProductionExtractionError:
        terminate()
        raise
    except Exception as exc:
        terminate()
        raise ProductionExtractionError("OCR execution failed") from exc


def _encode_tile(raster: object, tile: Tile, path: Path, codec: str) -> None:
    cropped = None
    try:
        cropped = raster.crop((tile.left, tile.top, tile.left + tile.width, tile.top + tile.height))
        cropped.save(path, format={"png": "PNG", "jpeg": "JPEG", "webp": "WEBP"}[codec])
    except Exception as exc:
        raise ProductionExtractionError("tile encoding failed") from exc
    finally:
        close = getattr(cropped, "close", None)
        if callable(close):
            close()


def extract_raster(source: bytes, descriptor: SourceDescriptor, *, config: Mapping[str, Any], executable: str, languages: tuple[str, ...], installed_languages: tuple[str, ...], tool_version: str, decoder: Callable[[bytes], tuple[str, int, int, str, object]] | None = None, runner: Callable[..., subprocess.CompletedProcess[bytes]] | None = None, tile_encoder: Callable[[object, Tile, Path, str], None] | None = None, max_workers: int | None = None, process_factory: Callable[..., Any] | None = None, kill_group: Callable[[int], None] | None = None) -> RasterExtraction:
    """Decode, tile, OCR and publish one all-or-nothing immutable result."""
    limits, config_digest = _config(config)
    if type(descriptor) is not SourceDescriptor or descriptor.signature not in _FORMATS or not isinstance(source, bytes) or len(source) != descriptor.size or hashlib.sha256(source).hexdigest() != descriptor.sha256 or _signature(source) != descriptor.signature:
        raise ProductionExtractionError("source descriptor mismatch")
    workers = limits["max_workers"] if max_workers is None else max_workers
    if isinstance(workers, bool) or not isinstance(workers, int) or workers <= 0 or workers > limits["max_workers"] or workers > CODE_MAXIMA["max_workers"]:
        raise ProductionExtractionError("OCR worker limit is invalid")
    image, raster = _decode(
        source,
        limits["max_decoded_pixels"],
        limits["max_image_dimension"],
        decoder,
    )
    maximum_tile_height = limits["max_tile_pixels"] // image.width
    tile_height = min(limits["tile_height_pixels"], maximum_tile_height)
    overlap = limits["tile_overlap_pixels"] if image.height > tile_height else 0
    if tile_height <= 0 or (image.height > tile_height and overlap >= tile_height):
        raise ProductionExtractionError("tile dimensions exceed limit")
    tiles = tile_image(image.width, image.height, tile_height, overlap)
    if any(
        tile.width * tile.height > limits["max_tile_pixels"]
        for tile in tiles
    ):
        raise ProductionExtractionError("tile dimensions exceed limit")
    words: list[OcrWord] = []
    try:
        with tempfile.TemporaryDirectory(prefix="ice-maker-raster-") as directory:
            root = Path(directory)
            for number, tile in enumerate(tiles):
                tile_path = root / (str(number) + "." + image.format)
                try:
                    (tile_encoder or _encode_tile)(
                        raster,
                        tile,
                        tile_path,
                        image.format,
                    )
                except ProductionExtractionError:
                    raise
                except Exception as exc:
                    raise ProductionExtractionError("tile encoding failed") from exc
                output = run_tesseract(
                    tile_path,
                    executable=executable,
                    languages=languages,
                    installed_languages=installed_languages,
                    tool_version=tool_version,
                    timeout_seconds=limits["timeout_seconds"],
                    max_output_bytes=limits["max_ocr_output_bytes"],
                    runner=runner,
                    process_factory=process_factory,
                    kill_group=kill_group,
                )
                words.extend(
                    parse_tsv(
                        output,
                        tile,
                        (image.width, image.height),
                        max_words=100_000,
                        max_output_bytes=limits["max_ocr_output_bytes"],
                    )
                )
                if len(words) > 100_000:
                    raise ProductionExtractionError("OCR word limit exceeded")
    finally:
        close = getattr(raster, "close", None)
        if callable(close):
            try:
                close()
            except Exception as exc:
                raise ProductionExtractionError("image cleanup failed") from exc
    accepted = deduplicate_words(words, maximum=100_000)
    if not accepted: raise ProductionExtractionError("OCR produced no words")
    text = " ".join(word.text for word in accepted)
    if len(text.encode("utf-8")) > limits["max_ocr_output_bytes"]:
        raise ProductionExtractionError("OCR output exceeds limit")
    confidence = math.fsum(word.confidence for word in accepted) / len(accepted)
    return RasterExtraction(image.source_sha256, METHOD, EXTRACTOR_VERSION, config_digest, tool_version, hashlib.sha256(tool_version.encode("ascii")).hexdigest(), image.width, image.height, tiles, accepted, text, confidence)


def _run_pdf_tool(argv: list[str], *, timeout_seconds: int, maximum: int,
                  runner: Callable[..., subprocess.CompletedProcess[bytes]] | None,
                  process_factory: Callable[..., Any] | None,
                  kill_group: Callable[[int], None] | None) -> bytes:
    """Use the OCR process boundary for Poppler too; never expose its stderr."""
    if type(timeout_seconds) is not int or timeout_seconds <= 0 or type(maximum) is not int or maximum <= 0:
        raise ProductionExtractionError("PDF tool limits are invalid")
    if runner is None:
        return _run_process(argv, timeout_seconds, maximum, process_factory or subprocess.Popen, .01, kill_group)
    try:
        completed = runner(argv, shell=False, cwd=tempfile.gettempdir(),
                           env={"LANG": "C", "LC_ALL": "C", "PATH": ""},
                           stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, timeout=timeout_seconds,
                           start_new_session=True, check=False)
    except subprocess.TimeoutExpired as exc:
        raise ProductionExtractionError("PDF tool timed out") from exc
    except OSError as exc:
        raise ProductionExtractionError("PDF tool execution failed") from exc
    if (not isinstance(completed, subprocess.CompletedProcess)
            or type(completed.returncode) is not int
            or not isinstance(completed.stdout, bytes)
            or not isinstance(completed.stderr, bytes)):
        raise ProductionExtractionError("PDF tool execution failed")
    if len(completed.stdout) > maximum or len(completed.stderr) > maximum:
        raise ProductionExtractionError("PDF tool output exceeds limit")
    if completed.returncode != 0:
        raise ProductionExtractionError("PDF tool execution failed")
    return completed.stdout


def _parse_pdfinfo(data: bytes, maximum_pages: int) -> int:
    if not isinstance(data, bytes) or not data or type(maximum_pages) is not int or maximum_pages <= 0:
        raise ProductionExtractionError("PDF metadata is invalid")
    try:
        lines = data.decode("utf-8").splitlines()
    except UnicodeDecodeError as exc:
        raise ProductionExtractionError("PDF metadata is invalid") from exc
    # These are the stable labels emitted by the supported Poppler contract.
    # Rejecting a new/localized label is intentional: metadata is a parser
    # boundary, not advisory display output.
    allowed = frozenset((
        "Title", "Subject", "Keywords", "Author", "Creator", "Producer",
        "CreationDate", "ModDate", "Custom Metadata", "Metadata Stream",
        "Tagged", "UserProperties", "Suspects", "Form", "JavaScript", "Pages",
        "Encrypted", "Page size", "Page rot", "File size", "Optimized", "PDF version",
    ))
    values: dict[str, str] = {}
    for line in lines:
        if not line or ":" not in line:
            raise ProductionExtractionError("PDF metadata is invalid")
        label, value = line.split(":", 1)
        if (
            label not in allowed
            or label in values
            or not value.startswith(" ")
            or any(
                unicodedata.category(char) in {"Cc", "Cs"}
                or 0x202A <= ord(char) <= 0x202E
                or 0x2066 <= ord(char) <= 0x2069
                or (ord(char) & 0xFFFF) in {0xFFFE, 0xFFFF}
                for char in value
            )
        ):
            raise ProductionExtractionError("PDF metadata is invalid")
        values[label] = value.strip()
    if (not {"Pages", "Encrypted"}.issubset(values)
            or values["Encrypted"] != "no" or not _INTEGER.fullmatch(values["Pages"])):
        raise ProductionExtractionError("PDF metadata is invalid")
    pages = int(values["Pages"])
    if not 1 <= pages <= maximum_pages:
        raise ProductionExtractionError("PDF page count is outside bounds")
    return pages


def _native_pdf_text(data: bytes, maximum: int) -> str | None:
    if not isinstance(data, bytes) or len(data) > maximum:
        raise ProductionExtractionError("PDF text output exceeds limit")
    try:
        decoded = data.decode("utf-8")
        if "\f" in decoded:
            raise ProductionExtractionError("PDF text is unsafe")
        text = _safe_text(decoded, limit=maximum)
    except (UnicodeDecodeError, ProductionExtractionError):
        # Empty text is an OCR routing signal; malformed or unsafe text is not.
        if data.strip():
            raise ProductionExtractionError("PDF text is unsafe")
        return None
    return text if len(text.encode("utf-8")) >= MIN_USEFUL_PDF_TEXT_BYTES else None


def _verified_pdf_raster(root: Path, prefix: Path, maximum: int) -> bytes:
    """Read exactly Poppler's expected single-file PNG without following links."""
    if type(maximum) is not int or maximum <= 0 or prefix.parent != root:
        raise ProductionExtractionError("PDF raster output is invalid")
    expected_name = prefix.name + ".png"
    directory_fd = -1
    raster_fd = -1
    try:
        directory_fd = os.open(
            root,
            os.O_RDONLY
            | getattr(os, "O_DIRECTORY", 0)
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_CLOEXEC", 0),
        )
        if frozenset(os.listdir(directory_fd)) != frozenset(("source.pdf", expected_name)):
            raise ProductionExtractionError("PDF raster output is invalid")
        raster_fd = os.open(
            expected_name,
            os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0),
            dir_fd=directory_fd,
        )
        before = os.fstat(raster_fd)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_nlink != 1
            or before.st_size <= 0
            or before.st_size > maximum
        ):
            raise ProductionExtractionError("PDF raster output is invalid")
        chunks: list[bytes] = []
        size = 0
        while size <= maximum:
            chunk = os.read(raster_fd, min(64 * 1024, maximum + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
        data = b"".join(chunks)
        after = os.fstat(raster_fd)
        named = os.stat(expected_name, dir_fd=directory_fd, follow_symlinks=False)
        identity = lambda value: (
            value.st_dev,
            value.st_ino,
            value.st_mode,
            value.st_nlink,
            value.st_size,
            value.st_mtime_ns,
        )
        if (
            not data
            or len(data) > maximum
            or identity(before) != identity(after)
            or identity(after) != identity(named)
            or _signature(data) != "png"
        ):
            raise ProductionExtractionError("PDF raster output is invalid")
        os.unlink(expected_name, dir_fd=directory_fd)
    except ProductionExtractionError:
        raise
    except OSError as exc:
        raise ProductionExtractionError("PDF raster output is invalid") from exc
    finally:
        if raster_fd >= 0:
            os.close(raster_fd)
        if directory_fd >= 0:
            os.close(directory_fd)
    return data


def extract_pdf(source: bytes, descriptor: SourceDescriptor, *, config: Mapping[str, Any],
                pdfinfo_executable: str, pdftotext_executable: str,
                pdftoppm_executable: str, poppler_version: str,
                ocr_executable: str, languages: tuple[str, ...],
                installed_languages: tuple[str, ...], tesseract_version: str,
                runner: Callable[..., subprocess.CompletedProcess[bytes]] | None = None,
                decoder: Callable[[bytes], tuple[str, int, int, str, object]] | None = None,
                tile_encoder: Callable[[object, Tile, Path, str], None] | None = None,
                process_factory: Callable[..., Any] | None = None,
                kill_group: Callable[[int], None] | None = None) -> PdfExtraction:
    """Extract one PDF in strict page order, publishing no partial evidence."""
    limits, config_digest = _config(config)
    if (type(descriptor) is not SourceDescriptor or descriptor.signature != "pdf"
            or not isinstance(source, bytes) or not source.startswith(b"%PDF-")
            or len(source) != descriptor.size or len(source) > limits["max_file_bytes"]
            or hashlib.sha256(source).hexdigest() != descriptor.sha256):
        raise ProductionExtractionError("source descriptor mismatch")
    info_tool = _regular_absolute(pdfinfo_executable, "PDF info executable", True)
    text_tool = _regular_absolute(pdftotext_executable, "PDF text executable", True)
    image_tool = _regular_absolute(pdftoppm_executable, "PDF raster executable", True)
    ocr_tool = _regular_absolute(ocr_executable, "OCR executable", True)
    if (not _canonical_languages(languages)
            or not _canonical_languages(installed_languages, require_nonempty=False)
            or not set(languages).issubset(installed_languages)
            or not isinstance(tesseract_version, str) or not _VERSION.fullmatch(tesseract_version)):
        raise ProductionExtractionError("OCR languages are invalid")
    tool_digest = _tool_versions_digest(poppler_version, tesseract_version)
    cache_key = pdf_cache_key(descriptor.sha256, config_digest, poppler_version, tesseract_version, languages)
    try:
        with tempfile.TemporaryDirectory(prefix="ice-maker-pdf-") as directory:
            root = Path(directory)
            pdf_path = root / "source.pdf"
            pdf_path.write_bytes(source)
            page_count = _parse_pdfinfo(_run_pdf_tool(
                [str(info_tool), str(pdf_path)], timeout_seconds=limits["timeout_seconds"],
                maximum=limits["max_ocr_output_bytes"], runner=runner,
                process_factory=process_factory, kill_group=kill_group,
            ), limits["max_pdf_pages"])
            pages: list[PdfPageExtraction] = []
            for page in range(1, page_count + 1):
                page_arg = str(page)
                native = _native_pdf_text(_run_pdf_tool(
                    [str(text_tool), "-enc", "UTF-8", "-eol", "unix", "-nopgbrk",
                     "-f", page_arg, "-l", page_arg, str(pdf_path), "-"],
                    timeout_seconds=limits["timeout_seconds"], maximum=limits["max_ocr_output_bytes"],
                    runner=runner, process_factory=process_factory, kill_group=kill_group,
                ), limits["max_ocr_output_bytes"])
                if native is not None:
                    chunk_id = canonical_pdf_chunk_id(
                        descriptor.sha256, page, PDF_TEXT_METHOD, config_digest, tool_digest,
                        text=native, text_region=(0, len(native)), ocr_words=(),
                    )
                    pages.append(PdfPageExtraction(descriptor.sha256, page, PDF_TEXT_METHOD, native, 1.0,
                                                   (0, len(native)), (), None, None, None, PDF_EXTRACTOR_VERSION,
                                                   config_digest, tool_digest, chunk_id))
                    continue
                prefix = root / ("page-" + page_arg)
                _run_pdf_tool(
                    [str(image_tool), "-f", page_arg, "-l", page_arg, "-singlefile", "-png",
                     str(pdf_path), str(prefix)],
                    timeout_seconds=limits["timeout_seconds"], maximum=limits["max_file_bytes"],
                    runner=runner, process_factory=process_factory, kill_group=kill_group,
                )
                raster = _verified_pdf_raster(root, prefix, limits["max_file_bytes"])
                signature = "png"
                rendered = SourceDescriptor(descriptor.item, len(raster), hashlib.sha256(raster).hexdigest(), signature)
                ocr = extract_raster(raster, rendered, config=config, executable=str(ocr_tool),
                                     languages=languages, installed_languages=installed_languages,
                                     tool_version=tesseract_version, decoder=decoder, runner=runner,
                                     tile_encoder=tile_encoder, process_factory=process_factory,
                                     kill_group=kill_group)
                chunk_id = canonical_pdf_chunk_id(
                    descriptor.sha256, page, PDF_OCR_METHOD, config_digest, tool_digest,
                    text=ocr.text, text_region=None, ocr_words=ocr.words,
                    raster_sha256=rendered.sha256, raster_width=ocr.width,
                    raster_height=ocr.height,
                )
                pages.append(PdfPageExtraction(descriptor.sha256, page, PDF_OCR_METHOD, ocr.text,
                                               ocr.confidence, None, ocr.words, rendered.sha256, ocr.width,
                                               ocr.height, PDF_EXTRACTOR_VERSION,
                                               config_digest, tool_digest, chunk_id))
    except ProductionExtractionError:
        raise
    except OSError as exc:
        raise ProductionExtractionError("PDF extraction failed") from exc
    return PdfExtraction(descriptor.sha256, tuple(pages), PDF_EXTRACTOR_VERSION, config_digest,
                         tool_digest, poppler_version, tesseract_version, languages, cache_key)
