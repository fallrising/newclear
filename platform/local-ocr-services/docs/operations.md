# Operations

## Security boundary

The Compose file binds every engine to `127.0.0.1` by default. Put an operator-owned
reverse proxy in front of these ports and configure TLS, IP allowlists, request-body and
connection limits, request timeouts, and rate limiting there. Do not change
`OCR_BIND_IP` to `0.0.0.0` on an Internet-facing host without that boundary.

Generate a distinct random `OCR_API_KEY` per environment. The OCR endpoint requires it
in `X-API-Key`; health endpoints intentionally do not. Restart containers to rotate the
key. Input bytes and API keys are not logged by the application.

## Start one or more engines

```sh
cp .env.example .env
# Generate a key with: openssl rand -hex 32
# Replace change-me in .env, then export this trusted local file for curl as well.
set -a
. ./.env
set +a
docker compose --profile rapidocr up --build -d
docker compose --profile tesseract up --build -d
docker compose --profile paddle-structure up --build -d
```

Use `--profile all` to start all three. They have no `depends_on` relationship, so a
failed or resource-starved engine does not block the others.

The Paddle Structure build downloads and exercises its model pipeline, then makes the
cache read-only inside the image. It is intentionally much larger and slower to build
than the other profiles.

## Call the API

```sh
curl --fail-with-body \
  -H "X-API-Key: ${OCR_API_KEY}" \
  -H "Content-Type: image/png" \
  -H "X-Request-ID: product-request-123" \
  --data-binary @scan.png \
  http://127.0.0.1:8011/v1/ocr
```

Valid media types are PNG, JPEG, and WebP. The byte signature must agree with the
header. Animated and multi-frame inputs are rejected. OCR regions are normalized to
line-level clockwise polygons in oriented-image pixel coordinates.

Markdown returned by Paddle Structure is untrusted text and may contain inline HTML;
sanitize it before rendering. The service removes image references and does not serve
generated assets.

## Parallelism

Each container runs one Uvicorn worker and loads one model. Tune
`OCR_MAX_CONCURRENCY`, `OCR_MAX_QUEUE_SIZE`, `OCR_ENGINE_THREADS`, CPU, and memory using
representative load. Increase replicas before increasing Uvicorn workers; every worker
would load another model copy.

If a caller disconnects during OCR, the CPU inference thread cannot be cancelled. The
service keeps its inference slot reserved until that thread finishes so the configured
engine concurrency remains a hard bound.

Call different loopback ports concurrently or place multiple replicas behind the
reverse proxy. Treat HTTP 503 with `Retry-After` as backpressure rather than retrying in
a tight loop.

## Offline verification

Build images where dependency and model registries are available. Transfer images to
the isolated server by digest. On that server, first verify the manifest-backed startup,
then run OCR with outbound networking denied:

```sh
docker run --rm --network none \
  -e OCR_API_KEY=replace-with-a-test-key \
  local-ocr-services/rapidocr:0.1.0 \
  python -m ocr_service.warmup
```

Repeat for each image. A successful network-disabled run proves that the exact image can
operate under that network policy; it does not prove that no socket call was attempted.
Record image digests, artifact manifest output, sample accuracy, p50/p95 latency, peak
RSS, CPU utilization, and saturation behavior before production promotion.

## Troubleshooting

- `engine_not_ready`: inspect container logs; dependencies, language data, or model
  artifacts failed to load.
- `capacity_exhausted`: reduce client concurrency, increase replicas, or tune the two
  capacity settings after measuring memory and latency.
- Container exits before startup: the baked artifact manifest is missing or a checksum
  differs.
- HTTP 401: configure the same API key at the caller and service; never print it while
  diagnosing.
