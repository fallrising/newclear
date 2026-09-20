from __future__ import annotations

from importlib.metadata import version

from PIL import Image

from ..config import Settings
from .base import (
    BackendResult,
    OCRRegion,
    canonical_polygon,
    normalized_confidence,
)


class RapidOCRBackend:
    name = "rapidocr"
    model = "PP-OCRv6-small"

    def __init__(self, engine: object, package_version: str | None = None) -> None:
        self._engine = engine
        self.version = package_version or version("rapidocr")

    @classmethod
    def create(cls, settings: Settings) -> RapidOCRBackend:
        del settings
        from rapidocr import RapidOCR

        return cls(RapidOCR())

    def recognize(self, image: Image.Image) -> BackendResult:
        import numpy as np

        output = self._engine(np.asarray(image))  # type: ignore[operator]
        return self.normalize_output(output, width=image.width, height=image.height)

    @staticmethod
    def normalize_output(output: object, *, width: int, height: int) -> BackendResult:
        boxes = getattr(output, "boxes", None)
        texts = getattr(output, "txts", None)
        scores = getattr(output, "scores", None)
        boxes = () if boxes is None else boxes
        texts = () if texts is None else texts
        scores = () if scores is None else scores
        regions = tuple(
            OCRRegion(
                text=str(text),
                confidence=normalized_confidence(score),
                polygon=canonical_polygon(box),
            )
            for box, text, score in zip(boxes, texts, scores, strict=True)
            if str(text).strip()
        )
        return BackendResult(width=width, height=height, regions=regions)
