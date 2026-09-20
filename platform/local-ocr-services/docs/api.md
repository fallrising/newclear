# API v1

## Health

`GET /health/live` reports process liveness. `GET /health/ready` returns HTTP 200 only
after the selected engine has loaded, and includes its engine and model names.

## OCR

`POST /v1/ocr` accepts raw PNG, JPEG, or WebP bytes. Required headers:

- `Content-Type`: matching image media type.
- `X-API-Key`: service API key.
- `X-Request-ID`: optional 1–128 character identifier containing letters, digits,
  period, underscore, colon, or hyphen. A UUID is generated when omitted.

Successful responses use this shape:

```json
{
  "schema_version": "1.0",
  "request_id": "product-request-123",
  "engine": {
    "name": "rapidocr",
    "version": "3.9.2",
    "model": "PP-OCRv6-small"
  },
  "image": {"width": 1920, "height": 1080},
  "elapsed_ms": 84.2,
  "regions": [
    {
      "text": "辨識結果",
      "confidence": 0.98,
      "polygon": [
        {"x": 10, "y": 20},
        {"x": 200, "y": 20},
        {"x": 200, "y": 60},
        {"x": 10, "y": 60}
      ],
      "page": 1,
      "block_type": null
    }
  ],
  "structured": null
}
```

Paddle Structure may populate `structured.markdown` and `structured.blocks`. Layout
blocks are separate from OCR text regions.

Errors contain a stable `detail.code` and an actionable `detail.message`. Important
codes include `unauthorized`, `upload_too_large`, `image_too_large`,
`image_dimension_too_large`,
`unsupported_media_type`, `image_type_mismatch`, `multi_frame_image`, `invalid_image`,
`capacity_exhausted`, and `engine_not_ready`.
