# Deployable Local OCR Services

## Context

Product repositories need OCR without embedding a large, engine-specific runtime in
each product. The services must run on infrastructure controlled by the operator and
must be callable concurrently by external product servers.

## Goal

Provide one repository that builds independently deployable CPU OCR services with a
stable HTTP contract, secure defaults, health checks, bounded resource use, and no
runtime dependency on cloud APIs.

The initial engine profiles are:

- `rapidocr`: default general-purpose Simplified/Traditional Chinese and English OCR.
- `tesseract`: low-resource baseline for clean printed documents.
- `paddle-structure`: document layout, reading order, tables, and Markdown output.

## Non-goals

- A public SaaS control plane, billing, account management, or a web UI.
- GPU images in the first release.
- An internal durable job queue or batch scheduler.
- Training or fine-tuning OCR models.
- Guaranteed accuracy or latency before representative data is tested on the target
  server.
- Publishing a GitHub repository, container image, or external deployment.

## Acceptance Criteria

- Given any engine image, when `/health/live` is requested, then the process reports
  liveness without invoking OCR.
- Given a loaded engine, when `/health/ready` is requested, then the response names the
  engine and reports readiness.
- Given a valid API key and supported raw image body, when `POST /v1/ocr` is called, then the
  response follows the shared v1 schema and includes engine identity, image metadata,
  elapsed time, and normalized text regions.
- Given the `paddle-structure` engine, when a structured document is accepted, then the
  response may additionally include normalized blocks and Markdown.
- Given a missing or invalid API key, when OCR is requested, then no engine execution
  starts and HTTP 401 is returned.
- Given an oversized upload, unsupported media type, malformed image, or excessive
  decoded pixel count, when OCR is requested, then it is rejected before engine
  execution with an actionable 4xx response.
- Given the configured running-plus-waiting admission capacity is full, when a new
  request arrives, then HTTP 503 is returned before reading the body.
- Given an admitted request waits for an inference slot beyond the configured queue
  timeout, then HTTP 503 is returned and every capacity token is released.
- Given a Compose profile is selected, when its configuration is rendered, then only
  the requested OCR engine and its health check are required.
- Given a built runtime image with its model cache populated, when outbound network is
  unavailable, then health checks and OCR continue to operate successfully.

## Constraints

- CPU-first, Linux x86_64, Python 3.11.
- Engine containers are independent; one unavailable engine must not prevent another
  engine from starting.
- One Uvicorn worker per container because each worker loads its own model. Horizontal
  replicas provide additional parallelism.
- Default upload limit: 10 MiB. Default decoded image limit: 25 million pixels and
  16,384 pixels on either axis.
- Default engine concurrency: one request per container, one queued request, and a
  bounded wait. Both limits are configurable positive integers.
- API keys come from environment or an orchestrator-managed secret and are never
  committed or logged.
- The service does not fetch caller-provided URLs. Callers upload bytes directly.
- TLS, public ingress request-body limits, rate limiting, connection limits, timeouts,
  and IP allowlists terminate at an operator-owned reverse proxy. Compose binds engine
  ports to loopback by default; public interfaces are not the default.

## Assumptions and Unknowns

- Verified: RapidOCR 3.9.2 provides PP-OCRv6-small ONNX models and supports CPU
  inference through ONNX Runtime.
- Verified: PaddleOCR 3.7.0 exposes `PPStructureV3` and structured JSON/Markdown
  results.
- Verified: Tesseract exposes word confidence and bounding boxes through TSV output.
- Assumed: the first consumers need raster images before multi-page PDF ingestion.
- Unknown: target-server CPU generation, RAM, request mix, acceptable latency, and
  OCR accuracy on production samples.
- Unknown: whether the target environment permits model download during image build.
  Production artifacts must eventually pin model files and checksums.

## Design

### Repository layout

The Python application owns HTTP, authentication, validation, concurrency, and the v1
response models. Engine adapters live behind one protocol and are selected by
`OCR_BACKEND`. Dependency sets and Dockerfiles remain separate so a lightweight engine
does not inherit Paddle dependencies.

### API

- `GET /health/live`: process liveness; no authentication.
- `GET /health/ready`: model readiness and engine identity; no authentication.
- `POST /v1/ocr`: raw image bytes with `Content-Type: image/png`, `image/jpeg`, or
  `image/webp`; requires `X-API-Key`. The API does not use multipart parsing.

The stable response contains `schema_version`, `request_id`, engine `name`, package
`version`, model identity, oriented image dimensions, elapsed milliseconds, and
`regions`. OCR regions are line-granularity for every engine; Tesseract words are grouped
by its page/block/paragraph/line identifiers. Confidence is normalized to `[0, 1]` or
`null` when the engine does not provide one.

Coordinates are integer pixels in the image after EXIF transposition. Four-point
polygons are returned clockwise, starting at the upper-left point. OCR text regions and
Paddle layout blocks are separate arrays. Layout blocks contain only type, confidence,
and polygon; they do not masquerade as text. Structured output is optional and additive.
Generated Markdown is untrusted text, may contain inline HTML, and must be sanitized by
consumers before rendering. The initial API does not return or serve extracted assets;
local filesystem asset references are omitted.

### Security and resource control

Authentication uses constant-time comparison and runs before the body is read. Missing
or empty API-key configuration prevents application creation. A declared oversized
`Content-Length` is rejected before reading; chunked bodies are read with a hard byte
limit. Admission capacity is acquired before either operation and bounds running plus
waiting requests. A second semaphore bounds inference, with a queue timeout. Admission
is released on cancellation, but the inference slot remains held until its
non-cancellable CPU worker thread finishes.

Media type is checked against an allowlist and the body signature must agree. Dimensions
and total pixels are checked from the image header before full decoding, then decoding is
forced to validate the complete payload. EXIF orientation is applied before inference.
Animated and multi-frame images, zero dimensions, signature/type mismatches, malformed
data, excessive dimensions, pixels, or bytes are rejected with deterministic 4xx codes.

### Offline behavior

Application requests never accept remote URLs. RapidOCR models and Tesseract language
data (`eng`, `chi_sim`, and `chi_tra`) are installed into their images. The Paddle image
warms its models at build or release time. Images record checksums for model and language
artifacts and use an immutable baked model path; an unspecified volume must not shadow
that path. Runtime sets Paddle model-source checks off and fails readiness when required
artifacts cannot load.

A successful OCR smoke with outbound networking disabled proves operability under that
network policy, not the absence of attempted socket calls. A release is not considered
air-gap ready until that test passes for the exact image digest; stronger no-attempt
claims require network-attempt instrumentation.

## Steps

1. Define the shared models, configuration, validation, authentication, and fake-engine
   contract tests.
2. Add and unit-test the RapidOCR, Tesseract, and Paddle Structure adapters.
3. Add per-engine dependency sets, Dockerfiles, Compose profiles, and health checks.
4. Add operator and client documentation, including offline-build and scaling guidance.
5. Run unit/static checks, render Compose profiles, build feasible images, and record
   skipped heavyweight runtime checks explicitly.

## Verification

- `python -m pytest -q`
- `python -m compileall -q src tests`
- `docker compose config --quiet`
- `docker compose --profile rapidocr config --services`
- `docker compose --profile tesseract config --services`
- `docker compose --profile paddle-structure config --services`
- Build and smoke-test at least the base application and lightweight engine image when
  network and host capacity permit.
- On the target server, run authenticated success/failure requests with representative
  Traditional Chinese and English fixtures while outbound networking is disabled.
