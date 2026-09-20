from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import threading

from fastapi.testclient import TestClient
from PIL import Image

from ocr_service.app import create_app
from ocr_service.backends.base import BackendResult, OCRRegion
from ocr_service.concurrency import InferenceCapacityError
from ocr_service.config import Settings


API_KEY = "0123456789abcdef"


class FakeBackend:
    name = "fake"
    version = "test"
    model = "fixture-v1"

    def __init__(self) -> None:
        self.calls = 0

    def recognize(self, image: Image.Image) -> BackendResult:
        self.calls += 1
        return BackendResult(
            width=image.width,
            height=image.height,
            regions=(
                OCRRegion(
                    text="繁體 OCR",
                    confidence=0.98,
                    polygon=((1, 2), (9, 2), (9, 8), (1, 8)),
                ),
            ),
        )


class RejectingGate:
    async def run(self, operation: Callable[[], BackendResult]) -> BackendResult:
        del operation
        raise InferenceCapacityError


class BlockingBackend(FakeBackend):
    def __init__(self) -> None:
        super().__init__()
        self.started = threading.Event()
        self.release = threading.Event()

    def recognize(self, image: Image.Image) -> BackendResult:
        self.calls += 1
        if self.calls == 1:
            self.started.set()
            self.release.wait(timeout=2)
        return BackendResult(width=image.width, height=image.height, regions=())


def settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "backend": "rapidocr",
        "api_key": API_KEY,
        "max_upload_bytes": 1024,
        "max_image_pixels": 10_000,
        "max_image_dimension": 100,
        "max_concurrency": 1,
        "max_queue_size": 1,
        "queue_timeout_seconds": 0.01,
        "engine_threads": 1,
        "tesseract_languages": "chi_tra+eng",
    }
    values.update(overrides)
    return Settings(**values)


def png_bytes(width: int = 10, height: int = 10) -> bytes:
    output = BytesIO()
    Image.new("RGB", (width, height), "white").save(output, format="PNG")
    return output.getvalue()


def animated_webp_bytes() -> bytes:
    output = BytesIO()
    frames = [Image.new("RGB", (4, 4), color) for color in ("white", "black")]
    frames[0].save(
        output, format="WEBP", save_all=True, append_images=frames[1:], duration=50
    )
    return output.getvalue()


def rotated_jpeg_bytes() -> bytes:
    output = BytesIO()
    image = Image.new("RGB", (4, 2), "white")
    exif = image.getexif()
    exif[274] = 6
    image.save(output, format="JPEG", exif=exif)
    return output.getvalue()


def client_for(
    backend: FakeBackend,
    *,
    app_settings: Settings | None = None,
    gate: object | None = None,
) -> TestClient:
    app = create_app(
        settings=app_settings or settings(),
        backend_loader=lambda _: backend,
        inference_gate=gate,
    )
    return TestClient(app)


def post_image(client: TestClient, body: bytes, **headers: str):
    request_headers = {"Content-Type": "image/png", **headers}
    return client.post("/v1/ocr", headers=request_headers, content=body)


def test_health_endpoints_report_loaded_engine() -> None:
    backend = FakeBackend()
    with client_for(backend) as client:
        assert client.get("/health/live").json() == {"status": "alive"}
        ready = client.get("/health/ready")

    assert ready.status_code == 200
    assert ready.json() == {
        "status": "ready",
        "engine": "fake",
        "model": "fixture-v1",
    }


def test_readiness_reports_engine_load_failure_without_killing_liveness() -> None:
    def fail_loader(_: Settings) -> FakeBackend:
        raise RuntimeError("model unavailable")

    app = create_app(settings=settings(), backend_loader=fail_loader)
    with TestClient(app) as client:
        assert client.get("/health/live").status_code == 200
        ready = client.get("/health/ready")

    assert ready.status_code == 503
    assert ready.json()["detail"]["code"] == "engine_not_ready"


def test_ocr_requires_valid_api_key_before_engine_execution() -> None:
    backend = FakeBackend()
    with client_for(backend) as client:
        missing = post_image(client, png_bytes())
        invalid = post_image(client, png_bytes(), **{"X-API-Key": "wrong"})

    assert missing.status_code == 401
    assert invalid.status_code == 401
    assert backend.calls == 0


def test_non_ascii_api_key_is_rejected_without_crashing() -> None:
    backend = FakeBackend()
    with client_for(backend) as client:
        response = client.post(
            "/v1/ocr",
            headers=[
                (b"content-type", b"image/png"),
                (b"x-api-key", b"\xff" * 16),
            ],
            content=png_bytes(),
        )

    assert response.status_code == 401
    assert backend.calls == 0


def test_authentication_precedes_declared_body_size_validation() -> None:
    backend = FakeBackend()
    with client_for(backend, app_settings=settings(max_upload_bytes=8)) as client:
        response = client.post(
            "/v1/ocr",
            headers={"Content-Type": "image/png", "Content-Length": "9999"},
            content=png_bytes(),
        )

    assert response.status_code == 401
    assert backend.calls == 0


def test_ocr_rejects_unsupported_media_type_before_engine_execution() -> None:
    backend = FakeBackend()
    with client_for(backend) as client:
        response = client.post(
            "/v1/ocr",
            headers={"X-API-Key": API_KEY, "Content-Type": "text/plain"},
            content=b"not an image",
        )

    assert response.status_code == 415
    assert response.json()["detail"]["code"] == "unsupported_media_type"
    assert backend.calls == 0


def test_ocr_rejects_oversized_upload_before_engine_execution() -> None:
    backend = FakeBackend()
    with client_for(backend, app_settings=settings(max_upload_bytes=8)) as client:
        response = post_image(client, png_bytes(), **{"X-API-Key": API_KEY})

    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "upload_too_large"
    assert backend.calls == 0


def test_ocr_rejects_signature_mismatch_before_engine_execution() -> None:
    backend = FakeBackend()
    with client_for(backend) as client:
        response = post_image(client, b"not-a-png", **{"X-API-Key": API_KEY})

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "image_type_mismatch"
    assert backend.calls == 0


def test_ocr_rejects_truncated_image_before_engine_execution() -> None:
    backend = FakeBackend()
    truncated_png = b"\x89PNG\r\n\x1a\ntruncated"
    with client_for(backend) as client:
        response = post_image(
            client, truncated_png, **{"X-API-Key": API_KEY}
        )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_image"
    assert backend.calls == 0


def test_ocr_rejects_excessive_decoded_pixels_before_engine_execution() -> None:
    backend = FakeBackend()
    with client_for(backend, app_settings=settings(max_image_pixels=99)) as client:
        response = post_image(client, png_bytes(), **{"X-API-Key": API_KEY})

    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "image_too_large"
    assert backend.calls == 0


def test_ocr_rejects_excessive_image_dimension_before_engine_execution() -> None:
    backend = FakeBackend()
    with client_for(
        backend,
        app_settings=settings(max_image_pixels=20_000, max_image_dimension=100),
    ) as client:
        response = post_image(
            client, png_bytes(width=101, height=1), **{"X-API-Key": API_KEY}
        )

    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "image_dimension_too_large"
    assert backend.calls == 0


def test_ocr_rejects_animated_webp_before_engine_execution() -> None:
    backend = FakeBackend()
    app = create_app(settings=settings(), backend_loader=lambda _: backend)
    with TestClient(app) as client:
        response = client.post(
            "/v1/ocr",
            headers={"X-API-Key": API_KEY, "Content-Type": "image/webp"},
            content=animated_webp_bytes(),
        )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "multi_frame_image"
    assert backend.calls == 0


def test_ocr_applies_exif_orientation_before_inference() -> None:
    backend = FakeBackend()
    app = create_app(settings=settings(), backend_loader=lambda _: backend)
    with TestClient(app) as client:
        response = client.post(
            "/v1/ocr",
            headers={"X-API-Key": API_KEY, "Content-Type": "image/jpeg"},
            content=rotated_jpeg_bytes(),
        )

    assert response.status_code == 200
    assert response.json()["image"] == {"width": 2, "height": 4}
    assert backend.calls == 1


def test_ocr_rejects_invalid_request_id() -> None:
    backend = FakeBackend()
    with client_for(backend) as client:
        response = post_image(
            client,
            png_bytes(),
            **{"X-API-Key": API_KEY, "X-Request-ID": "unsafe request id"},
        )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_request_id"
    assert backend.calls == 0


def test_ocr_returns_normalized_contract_and_propagates_safe_request_id() -> None:
    backend = FakeBackend()
    with client_for(backend) as client:
        response = post_image(
            client,
            png_bytes(),
            **{"X-API-Key": API_KEY, "X-Request-ID": "product-123"},
        )

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "product-123"
    body = response.json()
    assert body["schema_version"] == "1.0"
    assert body["request_id"] == "product-123"
    assert body["engine"] == {
        "name": "fake",
        "version": "test",
        "model": "fixture-v1",
    }
    assert body["image"] == {"width": 10, "height": 10}
    assert body["regions"] == [
        {
            "text": "繁體 OCR",
            "confidence": 0.98,
            "polygon": [
                {"x": 1, "y": 2},
                {"x": 9, "y": 2},
                {"x": 9, "y": 8},
                {"x": 1, "y": 8},
            ],
            "page": 1,
            "block_type": None,
        }
    ]
    assert body["elapsed_ms"] >= 0
    assert body["structured"] is None
    assert backend.calls == 1


def test_ocr_returns_503_when_inference_capacity_is_saturated() -> None:
    backend = FakeBackend()
    with client_for(backend, gate=RejectingGate()) as client:
        response = post_image(client, png_bytes(), **{"X-API-Key": API_KEY})

    assert response.status_code == 503
    assert response.headers["Retry-After"] == "1"
    assert response.json()["detail"]["code"] == "capacity_exhausted"
    assert backend.calls == 0


def test_full_admission_rejects_request_without_reading_streamed_body() -> None:
    backend = BlockingBackend()
    body = png_bytes()
    second_body_read = threading.Event()
    rejected_body_read = threading.Event()

    def stream(mark_read: threading.Event):
        mark_read.set()
        yield body

    with client_for(
        backend,
        app_settings=settings(queue_timeout_seconds=1.0),
    ) as client, ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(post_image, client, body, **{"X-API-Key": API_KEY})
        assert backend.started.wait(timeout=1)
        second = pool.submit(
            client.post,
            "/v1/ocr",
            headers={"X-API-Key": API_KEY, "Content-Type": "image/png"},
            content=stream(second_body_read),
        )
        assert second_body_read.wait(timeout=1)

        try:
            rejected = client.post(
                "/v1/ocr",
                headers={"X-API-Key": API_KEY, "Content-Type": "image/png"},
                content=stream(rejected_body_read),
            )
        finally:
            backend.release.set()

        assert first.result(timeout=2).status_code == 200
        assert second.result(timeout=2).status_code == 200

    assert rejected.status_code == 503
    assert rejected.json()["detail"]["code"] == "capacity_exhausted"
    assert not rejected_body_read.is_set()


def test_openapi_documents_raw_supported_image_bodies() -> None:
    backend = FakeBackend()
    with client_for(backend) as client:
        document = client.get("/openapi.json").json()

    content = document["paths"]["/v1/ocr"]["post"]["requestBody"]["content"]
    assert set(content) == {"image/png", "image/jpeg", "image/webp"}
