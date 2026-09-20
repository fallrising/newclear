from __future__ import annotations

from typing import Annotated, Any

from pydantic import BaseModel, Field


class PointResponse(BaseModel):
    x: int
    y: int


PolygonResponse = Annotated[list[PointResponse], Field(min_length=4, max_length=4)]


class EngineResponse(BaseModel):
    name: str
    version: str
    model: str


class ImageResponse(BaseModel):
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class RegionResponse(BaseModel):
    text: str
    confidence: float | None = Field(default=None, ge=0, le=1)
    polygon: PolygonResponse
    page: int = Field(default=1, ge=1)
    block_type: str | None = None


class LayoutBlockResponse(BaseModel):
    block_type: str
    confidence: float | None = Field(default=None, ge=0, le=1)
    polygon: PolygonResponse
    page: int = Field(default=1, ge=1)


class StructuredResponse(BaseModel):
    markdown: str | None = None
    blocks: list[LayoutBlockResponse]


class OCRResponse(BaseModel):
    schema_version: str = "1.0"
    request_id: str
    engine: EngineResponse
    image: ImageResponse
    elapsed_ms: float = Field(ge=0)
    regions: list[RegionResponse]
    structured: StructuredResponse | None = None


class HealthResponse(BaseModel):
    status: str
    engine: str | None = None
    model: str | None = None


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    detail: ErrorDetail


def error_openapi(description: str) -> dict[str, Any]:
    return {"model": ErrorResponse, "description": description}
