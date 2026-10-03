# Local OCR Services

> **Portfolio doc tier: B (maintain / public contract)** — Keep the contract usable; do not expand into a second product line without an owner override. Policy: [docs/portfolio-doc-tiers.md](../../docs/portfolio-doc-tiers.md). Investment notes: [PORTFOLIO.md](../../PORTFOLIO.md).


CPU-first OCR services that run on infrastructure you control. The repository exposes a
shared HTTP v1 contract while keeping each engine independently buildable and scalable.

| Profile | Purpose | Default host port | Typical memory limit |
| --- | --- | ---: | ---: |
| `rapidocr` | Default Traditional/Simplified Chinese and English OCR | 8011 | 4 GiB |
| `tesseract` | Low-resource clean printed-document baseline | 8012 | 2 GiB |
| `paddle-structure` | Layout, tables, reading order, and Markdown | 8013 | 16 GiB |

## Quick start

```sh
cp .env.example .env
# Generate a key with: openssl rand -hex 32
# Replace change-me in .env, then export this trusted local file for curl as well.
set -a
. ./.env
set +a
docker compose --profile rapidocr up --build -d
curl http://127.0.0.1:8011/health/ready
```

Call OCR with raw image bytes:

```sh
curl --fail-with-body \
  -H "X-API-Key: ${OCR_API_KEY}" \
  -H "Content-Type: image/png" \
  --data-binary @scan.png \
  http://127.0.0.1:8011/v1/ocr
```

See [API v1](docs/api.md), [operations](docs/operations.md), the
[verification record](docs/verification.md), and the
[living specification](docs/specs/deployable-ocr-services.md).

## Development checks

The host only needs Git, Docker, and Docker Compose:

```sh
make check
```

The repository currently has no declared source-code license. Third-party engines,
models, language data, base images, and Python packages retain their own licenses and
notices; review them before redistribution.
