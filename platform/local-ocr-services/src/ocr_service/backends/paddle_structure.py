from __future__ import annotations

import os
import re
from importlib.metadata import version

from PIL import Image

from ..config import Settings
from .base import (
    BackendResult,
    LayoutBlock,
    OCRRegion,
    StructuredResult,
    canonical_polygon,
    normalized_confidence,
    rectangle_polygon,
)


class PaddleStructureBackend:
    name = "paddle-structure"
    model = "PP-StructureV3-noformula"

    def __init__(self, pipeline: object, package_version: str | None = None) -> None:
        self._pipeline = pipeline
        self.version = package_version or version("paddleocr")

    @classmethod
    def create(cls, settings: Settings) -> PaddleStructureBackend:
        os.environ.setdefault("PADDLE_PDX_CACHE_HOME", settings.model_cache_dir)
        os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "1")
        allow_download = os.environ.get("OCR_ALLOW_MODEL_DOWNLOAD", "0").lower()
        if allow_download not in {"1", "true", "yes"}:
            os.environ.setdefault("HF_HUB_OFFLINE", "1")
            os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

        from paddleocr import PPStructureV3

        pipeline = PPStructureV3(
            device="cpu",
            cpu_threads=settings.engine_threads,
            use_formula_recognition=False,
            use_doc_orientation_classify=True,
            use_doc_unwarping=False,
            use_textline_orientation=True,
        )
        return cls(pipeline)

    def recognize(self, image: Image.Image) -> BackendResult:
        import numpy as np

        outputs = list(self._pipeline.predict(np.asarray(image)))  # type: ignore[attr-defined]
        if not outputs:
            return BackendResult(width=image.width, height=image.height, regions=())
        output = outputs[0]
        return self.normalize_output(
            output.json,
            getattr(output, "markdown", None),
            width=image.width,
            height=image.height,
        )

    @staticmethod
    def normalize_output(
        payload: dict[str, object],
        markdown_payload: object,
        *,
        width: int,
        height: int,
    ) -> BackendResult:
        root = payload.get("res", payload)
        if not isinstance(root, dict):
            raise ValueError("unexpected PP-Structure result")

        overall = root.get("overall_ocr_res", {})
        if not isinstance(overall, dict):
            overall = {}
        texts = list(overall.get("rec_texts", []))
        scores = list(overall.get("rec_scores", []))
        polygons = list(overall.get("rec_polys", []))
        regions = tuple(
            OCRRegion(
                text=str(text),
                confidence=normalized_confidence(score),
                polygon=canonical_polygon(polygon),
            )
            for text, score, polygon in zip(texts, scores, polygons, strict=True)
            if str(text).strip()
        )

        layout = root.get("layout_det_res", {})
        boxes = layout.get("boxes", []) if isinstance(layout, dict) else []
        blocks: list[LayoutBlock] = []
        for box in boxes:
            if not isinstance(box, dict):
                continue
            coordinate = box.get("coordinate")
            if not isinstance(coordinate, (list, tuple)) or len(coordinate) != 4:
                continue
            blocks.append(
                LayoutBlock(
                    block_type=str(box.get("label", "unknown")),
                    confidence=normalized_confidence(box.get("score")),
                    polygon=rectangle_polygon(*coordinate),
                )
            )

        markdown = _markdown_text(markdown_payload)
        structured = StructuredResult(markdown=markdown, blocks=tuple(blocks))
        return BackendResult(
            width=width,
            height=height,
            regions=regions,
            structured=structured,
        )


def _markdown_text(payload: object) -> str | None:
    if not isinstance(payload, dict):
        return None
    value = payload.get("markdown_texts")
    if isinstance(value, list):
        value = "\n\n".join(str(item) for item in value)
    if not isinstance(value, str):
        return None
    without_images = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", value)
    without_images = re.sub(r"<img\b[^>]*>", "", without_images, flags=re.IGNORECASE)
    return without_images
