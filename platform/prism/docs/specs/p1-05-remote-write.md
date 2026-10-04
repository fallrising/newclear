# P1-05: Prometheus remote_write v1

## Goal and scope

Receive real Prometheus remote_write v1 at `POST /prom/api/v1/write`, normalize through the existing mapping, and admit to the existing bounded metrics pipeline. P1-04 supplies authenticated ingest identity, HTTP/TLS listeners and shutdown. Keep Go 1.23, module graph and public SPI unchanged. Query APIs, remote_write v2, persistent storage, deployment and full multi-tenant control-plane auth are outside this milestone.

## Wire and trust contract

Require one each of Content-Encoding `snappy` (block format), Content-Type `application/x-protobuf` (optional `proto=prometheus.WriteRequest`), and X-Prometheus-Remote-Write-Version `0.1.0`. Missing, duplicate, conflicting or unsupported headers are rejected; v2 yields 400 with a fixed v1-only diagnostic. Other protobuf schema selectors are rejected, never decoded as an empty v1 success. Unknown protobuf fields remain forward compatible but structurally bounded. Invalid body/labels/order returns 400; oversized compressed or decompressed payload returns 413. Wrong method returns 405/Allow POST. Responses and logs never echo payloads, credentials or backend errors.

Reuse the same file-backed bearer and fixed default tenant as OTLP. Missing/invalid/duplicate Authorization returns 401 before reading the body. X-Scope-OrgID and X-Prism-Tenant, if present, each occur once and must equal the configured identity; conflicting selectors return 400, matching P1-04. Parsed reserved labels cannot set the tenant. The receiver injects the authenticated tenant context; final stored identity is applied by the pipeline.

## Bounded work and lifecycle

Cap compressed AND decompressed payload at ingest.max_request_bytes. Check Snappy.DecodedLen before allocation. Validate protobuf wire structure/counts before generated unmarshal: no unbounded group nesting, recursion or repeated-element allocation. Fix aggregate protocol elements at 100,000 (including nested labels/samples/metadata/exemplars/histogram spans and packed numbers), fail closed at capacity. Validate UTF-8, duplicate/empty label names or empty values, a nonempty valid metric name and nondecreasing timestamps per timeseries; preserve IEEE NaN/stale bits. Invalid series may be rejected as an entire request before admission. As receiver extensions, unsorted labels are accepted and ordinary label names retain the existing SDD15 sanitization behavior; this is not a strict sender-conformance validator. Metadata and diagnostics must be bounded too.

Receiver API: `promapi.NewWriteReceiver(submitter, promapi.WriteOptions{Tenant, APIKey, MaxRequestBytes, Normalize, Logger}) (*WriteReceiver,error)`. Submitter exposes existing `SubmitMetrics(context.Context, normalize.MetricBatch, int64) (ingest.Result,error)`. WriteReceiver implements HTTPHandler() and Stop(). One fixed nonblocking request slot per receiver holds from body read through normalization/submission; other requests get 429 with Retry-After. Stop rejects new work with 503; an admitted request retains its permit until work actually exits. Body reads respond to cancellation and HTTP server finite read timeout. Per-request normalizer (if used) is always Close'd; no persistent state or unbounded goroutines. Pass actual decompressed wire bytes including unknown fields to SubmitMetrics, never marshalled canonical size.

Remote_write has a separate one-slot gate; existing OTLP gate remains unchanged. Add `2 * ingest.max_request_bytes` to LogicalBudget for compressed/decompressed receive buffers. Default combined budget becomes 968 MiB from 936 MiB, still within the existing 1 GiB limit. This is a logical budget, not RSS; decoded protobuf, normalization allocations and memory backend retention remain additional. No new configurable knob in this slice.

Runtime mounts both receiver handlers on the existing ingest HTTP server, stops both before drain, and keeps OTLP gRPC behavior. Only all-in-one/ingest roles expose write. Server drain → pipeline.Close → backend.Close ordering remains intact.

## Outcomes, retry and diagnostics

Successful admission is 204 with an empty body, acknowledging asynchronous admission rather than durability. Byte-rate, queue or decoder-gate refusal is 429 with bounded Retry-After; stopped/unavailable is 503; cancellation/deadline is 504; unsupported backend is 501. Classifications remain SPI errors in internal code. Schema version/header errors are 400, not OTLP responses.

The v1 protocol has no partial-success envelope. If normalization or limiter rejects samples after accepting valid samples, return nonretryable 400 with a fixed diagnostic; surviving accepted samples may persist. Do not return retryable 429 after a partially committed result. Unexpected internal committed failure is 500 and may lead to at-least-once duplicate delivery. Warnings for supported transformations, metadata unsupported, omitted native histograms or extra exemplars remain nonfatal per existing mapping; expose fixed diagnostics via bounded sampled logs (no dynamic metric/tenant/user strings). Error/normalization logging is sampled to at most ten entries per minute for this fixed-tenant receiver. Full registered ingest self-telemetry wiring remains outside P1-05 and is not claimed.

## Verification

Focused red→green HTTP/malformed/snappy expansion/protobuf limits/headers/auth/labels/status/cancel/Stop tests; normalizer regression if touched; parser fuzz; race/goleak. Runtime routing/shutdown and LogicalBudget boundary tests. A pinned real Prometheus binary scrapes a deterministic local exporter and remote-writes into the receiver/pipeline/memory; inspect metrics through SPI for `up=1`, fixture sample and tenant isolation. The integration gate fails explicitly without its required binary. Run existing OTLP integration and daemon smoke regressions, full make lint test, dependency guards, build, pinned lint and security. Independent frozen-diff audit and publication CI precede acceptance.

Reference: https://prometheus.io/docs/specs/prw/remote_write_spec/ and SDD 02, 05, 15. Decisions here bound the P1-05 implementation; they do not claim full Prometheus query compatibility.
