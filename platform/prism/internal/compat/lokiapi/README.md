# Loki JSON push receiver

P1-06 accepts authenticated `POST /loki/api/v1/push` with JSON and optional gzip.
A successful empty 204 acknowledges asynchronous pipeline admission. Empty
streams and empty values are no-ops. Structured metadata is a flat string map;
protobuf/snappy push and queries are outside this receiver.

Authentication freezes one bearer key and trusted tenant. Authorization and
optional tenant selectors must be unique, and selectors must match the frozen
tenant. Content-Type must be application/json, optionally charset=utf-8;
Content-Encoding is absent, identity or gzip. Header validation precedes body
reads, and errors use fixed messages that exclude secrets and user input.

The receiver has its own nonblocking single request slot, held through reading,
validation, normalization, submission and cancellation cleanup. Stop refuses
new admission without creating goroutines. Cancellation closes the network
body; cleanup joins that callback before releasing the slot. Cancellation is
checked between body reads, gzip expansion reads, JSON tokens and normalized
streams/entries. Each per-request normalizer is closed. Runtime owns listeners,
read deadlines and pipeline drain ordering.

Compressed and decompressed input each fit MaxRequestBytes. Gzip integrity,
truncation and invalid trailing data are checked. A streaming jsontext token
pass validates JSON syntax, UTF-8 and duplicate names before materialization,
with depth 16 and 100,000 aggregate elements. Opening containers, object keys,
scalar values and array entries count; closing delimiters do not add elements.
A second token pass requires the exact streams/stream/values schema, timestamp
and body strings, and optional flat string metadata. Unknown structural keys,
nulls and numeric timestamps are rejected for the whole request.

Before normalizing, conservative expanded work is capped at 100,000: each
stream contributes entries × (1 + label members), plus entry metadata members.
Projected strings contribute entries × 3 × (stream key/value bytes), plus body
and metadata key/value bytes; their sum fits MaxRequestBytes. Three copies
conservatively cover label/attribute, resource and severity ownership. Division
checks precede multiplication. These limits can reject a structurally valid
small wire payload with large shared-label amplification. They bound work before
the existing normalizer allocates its record graph. The normalizer also caps
shared high-cardinality attributes before cloning, retaining final sorted
attribute truncation and entry-metadata overrides.

Original decompressed JSON bytes, including whitespace, reach SubmitLogs for
byte charging. Semantic timestamp or output-limit rejection can coexist with
accepted records and returns fixed 400 stating that accepted records may
persist. Structural rejection admits nothing. Precommit throttling returns 429;
unavailability/Stop returns 503, each with Retry-After bounded to 1..60 seconds.
Oversize is 413, cancellation 504, unsupported storage 501 and unexpected errors
500. Errors after accepted records, or any internal failures, are always 500
without retry headers. Logs use fixed vocabulary and at most ten warnings per
rolling minute, including transformations on otherwise empty requests. Full
registered ingestion telemetry and durable acknowledgement remain separate.

Focused tests cover headers/authentication, mapping, original-byte accounting,
JSON shape/duplicates/UTF-8/depth/count, gzip corruption and expansion, amplified
stream labels, attribute limits, partial outcomes, cancellation/Stop/body-close
callback ownership, parser fuzzing, race and goroutine leaks. Root milestone
gates own runtime, real memory-pipeline/Vector acceptance and security checks.
