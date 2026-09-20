from __future__ import annotations

from ..config import Settings
from .base import OCRBackend


def load_backend(settings: Settings) -> OCRBackend:
    if settings.backend == "rapidocr":
        from .rapidocr import RapidOCRBackend

        return RapidOCRBackend.create(settings)
    if settings.backend == "tesseract":
        from .tesseract import TesseractBackend

        return TesseractBackend.create(settings)
    if settings.backend == "paddle-structure":
        from .paddle_structure import PaddleStructureBackend

        return PaddleStructureBackend.create(settings)
    raise ValueError(f"unsupported backend: {settings.backend}")
