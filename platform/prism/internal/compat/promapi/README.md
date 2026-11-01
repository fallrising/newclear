# Prometheus remote_write v1 receiver

P1-05 accepts authenticated `POST /prom/api/v1/write` requests and acknowledges
bounded asynchronous metrics admission with an empty 204 response. The existing
pipeline owns tenant identity, byte rate limits, record limits and storage.

The receiver validates unique v1 headers and the fixed bearer identity before
reading a body. A separate nonblocking single request slot remains held through
read, decode, normalization and submission. Stop refuses new requests; runtime
owns listener deadlines and drain ordering.

Compressed and decompressed bytes both fit `MaxRequestBytes`. Snappy's decoded
length is checked before allocation. A schema-aware protobuf scan precedes
unmarshal and caps all wire fields and packed numeric elements at 100,000. Known
messages recurse only through the fixed v1 schema; protobuf groups are rejected.
Unknown scalar and byte fields are forward compatible and count toward the cap.
All original decompressed bytes, including unknown fields, reach byte admission.

Labels require valid UTF-8, unique nonempty names and nonempty values, plus one valid metric name.
Series samples have nondecreasing timestamps. The established normalizer retains
its label sanitation, reserved-label dropping, metadata and exemplar mappings.
Unsorted labels and names requiring sanitation are tolerated receiver extensions;
this is not strict sender-conformance validation. Proto3 groups are unsupported
because the v1 schema defines none, including when presented as unknown fields.
Each request normalizer is closed before its slot is released.

Malformed requests return fixed 400 diagnostics; byte/count excess returns 413.
Precommit rate, queue or decoder-gate refusal returns 429 and bounded Retry-After.
A request with rejected samples returns nonretryable 400 after surviving samples
are admitted. Committed internal failure returns 500. Cancellation returns 504,
stopped/unavailable returns 503 and unsupported metrics storage returns 501.
Successful transformations and omitted unsupported fields remain nonfatal.

Error and normalization logs use fixed vocabulary and a single rolling sampler
limited to ten entries per minute. No credentials, payload, tenant, metric names
or backend error text are interpolated. This slice does not claim full registered
ingest telemetry wiring or durable acknowledgement.

Verification includes focused HTTP, Snappy expansion, protobuf count/shape,
authentication, sample bits, partial outcomes, cancellation and Stop tests;
parser fuzzing; race and leak checks. Runtime and real Prometheus acceptance are
owned by the integrated milestone gates.
