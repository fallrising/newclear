# P1-04 — OTLP reception and daemon wiring

## Goal and boundary

Accept OTLP metrics, logs and traces over gRPC and HTTP into the existing bounded
pipeline and SPI. Prove persistence with the memory backend and real telemetrygen.
Wire only all-in-one and ingest daemon roles. No query API, alternate driver,
control-plane identity store, deployment, new module or Go version change.

## Protocol and identity

HTTP exposes POST /v1/metrics, /v1/logs and /v1/traces on the existing HTTP server,
with protobuf and JSON request/response encoding and optional gzip request bodies.
gRPC implements the three Export services with gzip and a configurable 4 MiB
receive limit. HTTP bounds both wire and decompressed body size; a shared finite
receiver concurrency gate bounds active decoding/submission across transports.
Overload is immediate and retryable. Unsupported media/encoding and malformed
payloads fail before admission. HTTP errors use google.rpc.Status and
X-Prism-Error-Class; gRPC uses classified status and retry information.

This slice supports one authenticated tenant. A new auth.ingest_api_key_file
provides a bounded, at least 32-byte bearer credential. It is distinct from the
JWT secret, represented internally by secret.String and never logged or echoed.
Authentication is mandatory on both transports, including empty exports. Optional
X-Scope-OrgID and X-Prism-Tenant values may only equal tenancy.default_tenant;
conflicting, repeated or other-tenant selectors are rejected. No header can create
an authenticated identity. Full key lookup and mTLS identity are later phases.
Ingest startup/config-check rejects strict tenancy until it is implemented.
Non-ingest roles do not require an ingest key. TLS uses the configured server
certificate on both listeners; plaintext is suitable only for a trusted network
or local testing. SDD deviations are recorded in the ADR.

## Admission, partial success and resources

Whole-request failures must preserve P1-03 atomic admission, delta replay safety
and the byte-admission cancellation commit point. Successful export means accepted
for asynchronous storage, not durable acknowledgement. Never return a retryable
whole-request failure for data already accepted. Partial rejection counts are in
original OTLP data points/log records/spans, never expanded UTM point counts.
Delta baselines, unsupported metadata and bounded normalization diagnostics must
be surfaced without inventing rejected counts; a source point with any rejected expanded child counts once, even if other
children were accepted. Provenance is positional, not matched by values. Exact
accounting is a required implementation/review gate. No credentials, payloads or backend error text appear
in responses. Error classes and diagnostic messages have finite domains.

Runtime uses one tenant, configured signal batch sizes and a smaller default
queue_depth=4 (package defaults remain unchanged), two workers per signal and
ingest.otlp.max_concurrent_requests=16; ingest.otlp.max_recv_msg_size defaults
to 4 MiB. Validate positive bounded settings, safe arithmetic
and conservative queue/bucket/in-flight logical capacity plus bounded receive
buffers plus one serialized admission request against ingest.memory_limit
(default 936 MiB). This is a logical admission budget, not a
hard RSS guarantee: pdata/allocator/transient/state and backend retention remain
additional costs. The memory backend is deliberately unbounded test storage.
Settings, validation, config-check, SDD example and deploy/prismd.yaml stay in sync.

## Lifecycle

Bind both listeners before accepting traffic. Startup failure closes acquired
resources. On stop, reject new receiver work, drain/terminate HTTP and gRPC within
one shutdown deadline, then close the pipeline using the remaining bounded context
and only then close the borrowed backend. The pipeline lifecycle must not be
cancelled before graceful drain; forced shutdown must cancel stalled requests and
SPI writes. Preserve base health/metrics and non-ingest role behavior.

## Acceptance

- Table tests cover three signals, both transports, HTTP encodings, gzip, empty,
  malformed/oversized/compression-bomb input, auth and tenant isolation, overload,
  cancellation, classified retry responses and original-unit partial success.
- Real listeners with real pipeline/memory exercise batching, rejected requests,
  graceful flush, startup failure and forced shutdown, with race/leak checks.
- A pinned real telemetrygen sends all three signals and SPI queries verify memory
  contents; a real prismd smoke verifies config/listeners/shutdown.
- Go 1.23 formatting/vet/race suite, dependency guard and its five negative cases,
  build, pinned golangci-lint and independent review pass before publication.

## Cross-worker interface

Receiver package exports New(pipeline Submitter, Options) (*Receiver, error),
HTTPHandler() http.Handler and NewGRPCServer(...grpc.ServerOption) *grpc.Server.
Options fields: Tenant string, APIKey secret.String, MaxRequestBytes int,
MaxRecvMsgSize int, MaxConcurrentRequests int. Submitter uses the three existing
SubmitOTLP signatures. NewGRPCServer owns service registration, message size,
compression and request gates; callers may supply transport credentials.
Receiver options are immutable. Stop() refuses new admission; runtime owns
listeners and shutdown orchestration.
Any necessary interface adjustment is coordinated before crossing scopes.

## Pinned gRPC transport behavior

The existing grpc-go v1.69.2 tap abort path discards status details. Receiver
capacity exhaustion therefore returns a fixed Unavailable status before reading
or decompressing a request; standard OTLP clients retry with their own backoff.
Actual pipeline queue/rate throttling returns ResourceExhausted with RetryInfo
from the ordinary unary handler. No admitted request is converted to a safely
retryable whole-request failure.

The standard MethodDesc registration retains unary dispatch and interceptor
semantics. A bounded raw envelope delays pdata decoding until the handler can
validate wire shape and return properly classified errors. Permits remain owned
through stats.End, including cancelled calls. Official pdata clients and real
telemetrygen cover the exact three method names and one-request/one-response wire
contract. Recheck these gates when updating the pinned gRPC/pdata versions.

Receiver-generated failures have sanitized, fixed diagnostics and classified
status details. Native gRPC framing, receive-size and unsupported-compression
failures retain the library's status behavior; unsupported compression may echo
the bounded encoding header. These errors and tap refusals are not promised
Prism error details. Header and receive-message bounds apply before schema-aware
protobuf nesting checks and pdata decoding. JSON has a nonrecursive nesting
precheck; scalar bytes and unknown length-delimited fields are not mistaken for
nested protobuf messages.

## Verification entrypoints

The [inventory](../inventory.md#integrated-p1-04-verification) records observed
full-suite results. [External-client acceptance](../../test/e2e/README.md) provides
reproducible commands. `go test -race -count=1 ./test/security` covers this slice's
credential/tenant boundary; it does not replace future Phase 5 acceptance.
