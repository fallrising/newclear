from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Protocol

from PIL import Image


Point = tuple[int, int]
Polygon = tuple[Point, Point, Point, Point]


def canonical_polygon(points: object) -> Polygon:
    values = list(points)  # type: ignore[arg-type]
    if len(values) != 4:
        raise ValueError("a polygon must contain exactly four points")

    converted = [(int(round(float(point[0]))), int(round(float(point[1])))) for point in values]
    center_x = sum(point[0] for point in converted) / 4
    center_y = sum(point[1] for point in converted) / 4
    ordered = sorted(
        converted,
        key=lambda point: math.atan2(point[1] - center_y, point[0] - center_x),
    )
    start = min(range(4), key=lambda index: (sum(ordered[index]), ordered[index][1]))
    rotated = ordered[start:] + ordered[:start]
    return (rotated[0], rotated[1], rotated[2], rotated[3])


def rectangle_polygon(left: object, top: object, right: object, bottom: object) -> Polygon:
    return canonical_polygon(
        (
            (float(left), float(top)),
            (float(right), float(top)),
            (float(right), float(bottom)),
            (float(left), float(bottom)),
        )
    )


def normalized_confidence(value: object) -> float | None:
    if value is None:
        return None
    number = float(value)
    if math.isnan(number):
        return None
    return min(1.0, max(0.0, number))


@dataclass(frozen=True, slots=True)
class OCRRegion:
    text: str
    confidence: float | None
    polygon: Polygon
    page: int = 1
    block_type: str | None = None


@dataclass(frozen=True, slots=True)
class LayoutBlock:
    block_type: str
    confidence: float | None
    polygon: Polygon
    page: int = 1


@dataclass(frozen=True, slots=True)
class StructuredResult:
    markdown: str | None
    blocks: tuple[LayoutBlock, ...]


@dataclass(frozen=True, slots=True)
class BackendResult:
    width: int
    height: int
    regions: tuple[OCRRegion, ...]
    structured: StructuredResult | None = None


class OCRBackend(Protocol):
    name: str
    version: str
    model: str

    def recognize(self, image: Image.Image) -> BackendResult: ...
