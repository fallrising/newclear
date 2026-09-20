from __future__ import annotations

import hmac
import logging
import re
import time
import uuid
from collections.abc import Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Request, Response

from .api_models import (
    EngineResponse,
    HealthResponse,
    ImageResponse,
    LayoutBlockResponse,
    OCRResponse,
    PointResponse,
    RegionResponse,
    StructuredResponse,
    error_openapi,
)
from .backends.base import BackendResult, OCRBackend, Polygon
from .backends.registry import load_backend
from .concurrency import AdmissionController, InferenceCapacityError
from .config import Settings
from .errors import ServiceError
from .image_io import decode_image, normalized_media_type, read_bounded_body


LOGGER = logging.getLogger("ocr_service")
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
BackendLoader = Callable[[Settings], OCRBackend]


def create_app(
    settings: Settings | None = None,
    backend_loader: BackendLoader = load_backend,
    inference_gate: object | None = None,
) -> FastAPI:
    service_settings = settings or Settings.from_env()
    admission = AdmissionController(
        max_concurrency=service_settings.max_concurrency,
        max_queue_size=service_settings.max_queue_size,
        queue_timeout=service_settings.queue_timeout_seconds,
    )
    runner = inference_gate or admission

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            app.state.backend = backend_loader(service_settings)
            app.state.load_failed = False
        except Exception:
            LOGGER.exception("OCR engine initialization failed")
            app.state.backend = None
            app.state.load_failed = True
        yield

    app = FastAPI(
        title="Local OCR Service",
        version="1.0.0",
        lifespan=lifespan,
    )

    @app.get(
        "/health/live", response_model=HealthResponse, response_model_exclude_none=True
    )
    async def live() -> HealthResponse:
        return HealthResponse(status="alive")

    @app.get(
        "/health/ready",
        response_model=HealthResponse,
        responses={503: error_openapi("OCR engine is not loaded")},
    )
    async def ready(request: Request) -> HealthResponse:
        backend = getattr(request.app.state, "backend", None)
        if backend is None:
            _raise(503, "engine_not_ready", "OCR engine is not ready")
        return HealthResponse(
            status="ready", engine=backend.name, model=backend.model
        )

    @app.post(
        "/v1/ocr",
        response_model=OCRResponse,
        openapi_extra={
            "requestBody": {
                "required": True,
                "content": {
                    "image/png": {"schema": {"type": "string", "format": "binary"}},
                    "image/jpeg": {"schema": {"type": "string", "format": "binary"}},
                    "image/webp": {"schema": {"type": "string", "format": "binary"}},
                },
            }
        },
        responses={
            400: error_openapi("Invalid request metadata"),
            401: error_openapi("Missing or invalid API key"),
            413: error_openapi("Encoded or decoded image is too large"),
            415: error_openapi("Unsupported media type"),
            422: error_openapi("Malformed or unsupported image"),
            503: error_openapi("Engine is not ready or capacity is exhausted"),
        },
    )
    async def ocr(
        request: Request,
        response: Response,
        x_api_key: str | None = Header(default=None, alias="X-API-Key"),
        x_request_id: str | None = Header(default=None, alias="X-Request-ID"),
    ) -> OCRResponse:
        _authenticate(x_api_key, service_settings.api_key)
        request_id = _request_id(x_request_id)
        response.headers["X-Request-ID"] = request_id

        backend = getattr(request.app.state, "backend", None)
        if backend is None:
            _raise(503, "engine_not_ready", "OCR engine is not ready")

        try:
            async with admission.admit():
                media_type = normalized_media_type(request.headers.get("content-type"))
                if media_type not in {"image/png", "image/jpeg", "image/webp"}:
                    raise ServiceError(
                        415,
                        "unsupported_media_type",
                        "Content-Type must be image/png, image/jpeg, or image/webp",
                    )
                body = await read_bounded_body(
                    request, service_settings.max_upload_bytes
                )
                image = decode_image(
                    body,
                    media_type,
                    service_settings.max_image_pixels,
                    service_settings.max_image_dimension,
                )
                started = time.perf_counter()
                result = await runner.run(lambda: backend.recognize(image))
                elapsed_ms = (time.perf_counter() - started) * 1000
        except ServiceError as exc:
            _raise(exc.status_code, exc.code, exc.message)
        except InferenceCapacityError:
            _raise(
                503,
                "capacity_exhausted",
                "OCR capacity is exhausted; retry later",
                headers={"Retry-After": "1"},
            )
        except HTTPException:
            raise
        except Exception:
            LOGGER.exception("OCR inference failed", extra={"request_id": request_id})
            _raise(500, "inference_failed", "OCR inference failed")

        return _response(request_id, backend, result, elapsed_ms)

    return app


def _authenticate(provided: str | None, expected: str) -> None:
    if provided is None or not hmac.compare_digest(
        provided.encode("utf-8"), expected.encode("utf-8")
    ):
        _raise(
            401,
            "unauthorized",
            "missing or invalid API key",
            headers={"WWW-Authenticate": "ApiKey"},
        )


def _request_id(provided: str | None) -> str:
    if provided is None:
        return str(uuid.uuid4())
    if not REQUEST_ID_PATTERN.fullmatch(provided):
        _raise(400, "invalid_request_id", "X-Request-ID has an invalid format")
    return provided


def _points(polygon: Polygon) -> list[PointResponse]:
    return [PointResponse(x=x, y=y) for x, y in polygon]


def _response(
    request_id: str, backend: OCRBackend, result: BackendResult, elapsed_ms: float
) -> OCRResponse:
    structured = None
    if result.structured is not None:
        structured = StructuredResponse(
            markdown=result.structured.markdown,
            blocks=[
                LayoutBlockResponse(
                    block_type=block.block_type,
                    confidence=block.confidence,
                    polygon=_points(block.polygon),
                    page=block.page,
                )
                for block in result.structured.blocks
            ],
        )

    return OCRResponse(
        request_id=request_id,
        engine=EngineResponse(
            name=backend.name, version=backend.version, model=backend.model
        ),
        image=ImageResponse(width=result.width, height=result.height),
        elapsed_ms=elapsed_ms,
        regions=[
            RegionResponse(
                text=region.text,
                confidence=region.confidence,
                polygon=_points(region.polygon),
                page=region.page,
                block_type=region.block_type,
            )
            for region in result.regions
        ],
        structured=structured,
    )


def _raise(
    status_code: int,
    code: str,
    message: str,
    *,
    headers: dict[str, str] | None = None,
) -> None:
    raise HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
        headers=headers,
    )
