from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass


SUPPORTED_BACKENDS = frozenset({"rapidocr", "tesseract", "paddle-structure"})


def _positive_int(values: Mapping[str, str], name: str, default: int) -> int:
    raw = values.get(name, str(default))
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a positive integer") from exc
    if value <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return value


def _positive_float(values: Mapping[str, str], name: str, default: float) -> float:
    raw = values.get(name, str(default))
    try:
        value = float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a positive number") from exc
    if value <= 0:
        raise ValueError(f"{name} must be a positive number")
    return value


@dataclass(frozen=True, slots=True)
class Settings:
    backend: str
    api_key: str
    max_upload_bytes: int = 10 * 1024 * 1024
    max_image_pixels: int = 25_000_000
    max_image_dimension: int = 16_384
    max_concurrency: int = 1
    max_queue_size: int = 1
    queue_timeout_seconds: float = 5.0
    engine_threads: int = 2
    tesseract_languages: str = "chi_tra+eng"
    model_cache_dir: str = "/opt/ocr-models"

    @classmethod
    def from_env(cls, values: Mapping[str, str] | None = None) -> Settings:
        source = os.environ if values is None else values
        backend = source.get("OCR_BACKEND", "rapidocr").strip().lower()
        if backend not in SUPPORTED_BACKENDS:
            supported = ", ".join(sorted(SUPPORTED_BACKENDS))
            raise ValueError(f"OCR_BACKEND must be one of: {supported}")

        api_key = source.get("OCR_API_KEY", "")
        if len(api_key) < 16:
            raise ValueError("OCR_API_KEY must contain at least 16 characters")

        return cls(
            backend=backend,
            api_key=api_key,
            max_upload_bytes=_positive_int(
                source, "OCR_MAX_UPLOAD_BYTES", 10 * 1024 * 1024
            ),
            max_image_pixels=_positive_int(
                source, "OCR_MAX_IMAGE_PIXELS", 25_000_000
            ),
            max_image_dimension=_positive_int(
                source, "OCR_MAX_IMAGE_DIMENSION", 16_384
            ),
            max_concurrency=_positive_int(source, "OCR_MAX_CONCURRENCY", 1),
            max_queue_size=_positive_int(source, "OCR_MAX_QUEUE_SIZE", 1),
            queue_timeout_seconds=_positive_float(
                source, "OCR_QUEUE_TIMEOUT_SECONDS", 5.0
            ),
            engine_threads=_positive_int(source, "OCR_ENGINE_THREADS", 2),
            tesseract_languages=source.get(
                "OCR_TESSERACT_LANGUAGES", "chi_tra+eng"
            ).strip(),
            model_cache_dir=source.get(
                "OCR_MODEL_CACHE_DIR", "/opt/ocr-models"
            ).strip(),
        )
