from __future__ import annotations

from collections import defaultdict

from PIL import Image

from ..config import Settings
from .base import BackendResult, OCRRegion, normalized_confidence, rectangle_polygon


class TesseractBackend:
    name = "tesseract"
    model = "tessdata:chi_tra+chi_sim+eng"

    def __init__(self, languages: str, engine_version: str) -> None:
        self._languages = languages
        self.model = f"tessdata:{languages}"
        self.version = engine_version

    @classmethod
    def create(cls, settings: Settings) -> TesseractBackend:
        import pytesseract

        engine_version = str(pytesseract.get_tesseract_version())
        available = set(pytesseract.get_languages(config=""))
        requested = set(settings.tesseract_languages.split("+"))
        missing = requested - available
        if missing:
            raise RuntimeError(
                f"missing Tesseract languages: {', '.join(sorted(missing))}"
            )
        return cls(settings.tesseract_languages, engine_version)

    def recognize(self, image: Image.Image) -> BackendResult:
        import pytesseract
        from pytesseract import Output

        output = pytesseract.image_to_data(
            image,
            lang=self._languages,
            config="--psm 3",
            output_type=Output.DICT,
        )
        return self.normalize_output(output, width=image.width, height=image.height)

    @staticmethod
    def normalize_output(
        data: dict[str, list[object]], *, width: int, height: int
    ) -> BackendResult:
        grouped: dict[tuple[int, int, int, int], list[dict[str, object]]] = defaultdict(list)
        count = len(data.get("text", []))
        for index in range(count):
            text = str(data["text"][index]).strip()
            confidence = float(data["conf"][index])
            if not text or confidence < 0:
                continue
            key = (
                int(data["page_num"][index]),
                int(data["block_num"][index]),
                int(data["par_num"][index]),
                int(data["line_num"][index]),
            )
            grouped[key].append(
                {
                    "text": text,
                    "confidence": confidence,
                    "left": int(data["left"][index]),
                    "top": int(data["top"][index]),
                    "right": int(data["left"][index]) + int(data["width"][index]),
                    "bottom": int(data["top"][index]) + int(data["height"][index]),
                }
            )

        regions: list[OCRRegion] = []
        for key in sorted(grouped):
            words = grouped[key]
            regions.append(
                OCRRegion(
                    text=" ".join(str(word["text"]) for word in words),
                    confidence=normalized_confidence(
                        sum(float(word["confidence"]) for word in words)
                        / len(words)
                        / 100
                    ),
                    polygon=rectangle_polygon(
                        min(int(word["left"]) for word in words),
                        min(int(word["top"]) for word in words),
                        max(int(word["right"]) for word in words),
                        max(int(word["bottom"]) for word in words),
                    ),
                    page=max(1, key[0]),
                )
            )
        return BackendResult(width=width, height=height, regions=tuple(regions))
