import pytest

from ocr_service.config import Settings


def test_settings_require_an_api_key() -> None:
    with pytest.raises(ValueError, match="OCR_API_KEY"):
        Settings.from_env({"OCR_BACKEND": "rapidocr"})


def test_settings_reject_a_short_api_key() -> None:
    with pytest.raises(ValueError, match="at least 16"):
        Settings.from_env({"OCR_BACKEND": "rapidocr", "OCR_API_KEY": "too-short"})


def test_settings_reject_an_unknown_backend() -> None:
    with pytest.raises(ValueError, match="OCR_BACKEND"):
        Settings.from_env(
            {"OCR_BACKEND": "cloud-ocr", "OCR_API_KEY": "0123456789abcdef"}
        )


def test_settings_parse_resource_limits() -> None:
    settings = Settings.from_env(
        {
            "OCR_BACKEND": "tesseract",
            "OCR_API_KEY": "0123456789abcdef",
            "OCR_MAX_UPLOAD_BYTES": "2048",
            "OCR_MAX_IMAGE_PIXELS": "4096",
            "OCR_MAX_IMAGE_DIMENSION": "1024",
            "OCR_MAX_CONCURRENCY": "2",
            "OCR_MAX_QUEUE_SIZE": "4",
            "OCR_QUEUE_TIMEOUT_SECONDS": "1.5",
            "OCR_ENGINE_THREADS": "3",
        }
    )

    assert settings.backend == "tesseract"
    assert settings.max_upload_bytes == 2048
    assert settings.max_image_pixels == 4096
    assert settings.max_image_dimension == 1024
    assert settings.max_concurrency == 2
    assert settings.max_queue_size == 4
    assert settings.queue_timeout_seconds == 1.5
    assert settings.engine_threads == 3


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("OCR_MAX_UPLOAD_BYTES", "0"),
        ("OCR_MAX_IMAGE_PIXELS", "-1"),
        ("OCR_MAX_IMAGE_DIMENSION", "0"),
        ("OCR_MAX_CONCURRENCY", "0"),
        ("OCR_MAX_QUEUE_SIZE", "0"),
        ("OCR_QUEUE_TIMEOUT_SECONDS", "0"),
        ("OCR_ENGINE_THREADS", "many"),
    ],
)
def test_settings_reject_invalid_limits(name: str, value: str) -> None:
    with pytest.raises(ValueError, match=name):
        Settings.from_env(
            {
                "OCR_BACKEND": "rapidocr",
                "OCR_API_KEY": "0123456789abcdef",
                name: value,
            }
        )
