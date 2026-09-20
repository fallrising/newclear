from __future__ import annotations

from io import BytesIO

from fastapi import Request
from PIL import Image, ImageOps, UnidentifiedImageError

from .errors import ServiceError


MEDIA_FORMATS = {
    "image/png": "PNG",
    "image/jpeg": "JPEG",
    "image/webp": "WEBP",
}


def normalized_media_type(value: str | None) -> str:
    return (value or "").split(";", 1)[0].strip().lower()


def detected_format(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "PNG"
    if data.startswith(b"\xff\xd8\xff"):
        return "JPEG"
    if len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "WEBP"
    return None


async def read_bounded_body(request: Request, max_bytes: int) -> bytes:
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            declared = int(content_length)
        except ValueError as exc:
            raise ServiceError(
                400, "invalid_content_length", "Content-Length must be an integer"
            ) from exc
        if declared < 0:
            raise ServiceError(
                400, "invalid_content_length", "Content-Length cannot be negative"
            )
        if declared > max_bytes:
            raise ServiceError(
                413, "upload_too_large", f"image body exceeds {max_bytes} bytes"
            )

    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > max_bytes:
            raise ServiceError(
                413, "upload_too_large", f"image body exceeds {max_bytes} bytes"
            )
        body.extend(chunk)
    if not body:
        raise ServiceError(422, "invalid_image", "image body is empty")
    return bytes(body)


def decode_image(
    data: bytes, media_type: str, max_pixels: int, max_dimension: int
) -> Image.Image:
    expected_format = MEDIA_FORMATS.get(media_type)
    if expected_format is None:
        raise ServiceError(
            415,
            "unsupported_media_type",
            "Content-Type must be image/png, image/jpeg, or image/webp",
        )

    actual_format = detected_format(data)
    if actual_format != expected_format:
        raise ServiceError(
            422,
            "image_type_mismatch",
            "image signature does not match Content-Type",
        )

    try:
        with Image.open(BytesIO(data)) as header:
            width, height = header.size
            frames = int(getattr(header, "n_frames", 1))
            if frames != 1:
                raise ServiceError(
                    422, "multi_frame_image", "animated or multi-frame images are unsupported"
                )
            _check_dimensions(width, height, max_pixels, max_dimension)
            header.verify()

        with Image.open(BytesIO(data)) as decoded:
            decoded.load()
            oriented = ImageOps.exif_transpose(decoded)
            _check_dimensions(
                oriented.width, oriented.height, max_pixels, max_dimension
            )
            return oriented.convert("RGB")
    except ServiceError:
        raise
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as exc:
        raise ServiceError(422, "invalid_image", "image could not be decoded") from exc


def _check_dimensions(
    width: int, height: int, max_pixels: int, max_dimension: int
) -> None:
    if width <= 0 or height <= 0:
        raise ServiceError(422, "invalid_image", "image dimensions must be positive")
    if width > max_dimension or height > max_dimension:
        raise ServiceError(
            413,
            "image_dimension_too_large",
            f"image width and height must not exceed {max_dimension} pixels",
        )
    if width * height > max_pixels:
        raise ServiceError(
            413,
            "image_too_large",
            f"decoded image exceeds {max_pixels} pixels",
        )
