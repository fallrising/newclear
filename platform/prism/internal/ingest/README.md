# Bounded ingest pipeline

This package implements standalone P1-03 admission, normalization, limits,
accumulation and asynchronous SPI writes. Receivers, YAML configuration, daemon
startup and registered telemetry population are later integration work.

```go
options := ingest.DefaultOptions()
pipeline, err := ingest.New(lifecycleContext, backend, options)
if err != nil { return err }
ctx := ingest.WithTenant(requestContext, authenticatedTenant)
result, err := pipeline.SubmitOTLPMetrics(ctx, decodedMetrics, decompressedBytes)
// A classified whole-request error accepted nothing; a nil error may be partial.
// Inspect result.Normalize, result.Limits and result.MetadataUnsupported.
// At shutdown use a fresh bounded context, then close the caller-owned backend.
err = pipeline.Close(shutdownContext)
```

`WithTenant` accepts an already authenticated identity; it provides no auth or
header resolution. Receivers must enforce decompression/decoding limits before
constructing pdata and pass the actual decompressed byte count. Submit calls
reject missing/oversized tenant identities, negative bytes, overlarge owned
payloads, nested elements or OTLP depth greater than 16. Concurrent caller
mutation during a Submit call is forbidden. After return, retained maps, slices,
resources, nested histograms/exemplars/events/links and every string are owned
by the pipeline; substrings do not retain larger caller backing buffers.

## Admission and cancellation

Each call preflights the entire request, including every priority. Queue capacity
is reserved before byte/rate, delta, series/cardinality or trace state mutation.
Whole-request errors use SPI classes: full/busy queues or tenant registry are
`throttled`, closed lifecycle is `unavailable`, unsupported signals are
`unsupported`, and a permanently oversized conservative reservation is
`too_large`. Admission does not wait for queue space. Admission CPU work is
serialized with TryLock; a contender can receive immediate busy throttling.

Successful `AllowBytes` is the commit point. Before it, cancellation returns a
whole-request error without rate/delta/quota consumption. After it, bounded CPU
work completes with `context.WithoutCancel` and returns a partial Result plus nil
whole-request error. An unexpected stage/commit invariant error increments
`Result.InternalFailures`; this is diagnostic and must be surfaced by adapters.
It must not be interpreted as a safely retryable whole request. Parent lifecycle
cancellation stops asynchronous writes; already committed data may then be
accounted as shutdown-affected items. A network disconnect after commit has
ordinary at-least-once ambiguity; this is not network deduplication.

OTLP metrics use a pure preview which skips delta conversion. All raw expanded
candidates are bounded below the normalizer output cap first, including later
histograms and summaries, and actual normalization uses the same received-time
snapshot. Therefore baseline drops cannot reveal hidden unreserved candidates.
Other OTLP normalization is pure and occurs before commit. `SubmitMetrics`,
`SubmitLogs` and `SubmitSpans` take already normalized UTM; remote_write and Loki
adapters must invoke their existing normalizers before using those paths.

`Result.Accepted` and `Rejected` count the final normalizer output handed to
limits, not original OTLP datapoints. Metric expansion and delta baseline drops
make these unsuitable as OTLP `partial_success.rejected_data_points` directly.
Adapters must interpret normalization diagnostics and track original units.
Normalizer diagnostics (`drop`, `delta_baseline`, etc.) remain separate from
registered telemetry label domains. Bounded limits alarms, trace truncation IDs
and event overflow are returned to the caller, never retained in lifetime Stats.

## Capacities and priorities

Decoded pdata is checked before normalization. Conservative byte/element product
checks include metric expansion times point attributes and shared resource/scope
footprints times output candidates. These guards may reject a request even when
normalization would drop or truncate it.

Default maximum tenants is 16; input is 16 MiB and 100,000 elements. A fixed
non-evicting tenant registry preserves live rate/delta/cardinality windows;
unknown tenants are refused at capacity. Pre-admission failures close provisional
normalizers and consume no registry slot. Each tenant's normalizer is closed on
pipeline Close, and its limiter/delta state is released. Global limits are resolved before fixed tenant pointer overrides;
options are detached at construction. Effective attribute limits apply before
OTLP normalization. Each tenant limiter has bounded independent state; defaults
include a 3,424,256-byte HLL, up to 500,000 exact active series, 4,096 label trackers,
100,000 tracked values, 1,024 traces and 100,000 span IDs. Delta state defaults to
100,000 series per tenant with five-minute idle expiry. No short idle tenant
retirement resets these windows.

Each signal has independent low/normal/high queues (64 batches per lane), two
workers and up to three partial buckets per tenant. Logs: unknown/trace/debug are
low, info/warn normal, error/fatal high. Internal spans are normal; other spans
and all metric envelopes high. Workers prefer high, then normal, then low;
strict preference may starve low work under continuous high load. Low saturation
cannot consume high queue capacity. A busy shared admission lock is transient
contention separate from queue saturation.

Metrics flush at 10,000 envelopes; logs/spans at 5,000 records. All signals flush
at 8 MiB logical owned payload bytes or one second. Timer/Close cannot discard
an accepted partial bucket when its lane is full: it remains bounded until a
worker frees space. Workers are awakened for parallel batches, and retained
queue backing slots are cleared when dequeued.

Reservations deliberately use a conservative upper bound rather than assuming
next-fit packing remains monotone after removing/shrinking items. For each lane,
N is existing-bucket plus candidate items; B is their reserved byte sum. Item
flushes are at most floor(N / MaxItems). Byte flush bound is zero for B<MaxBytes,
one for B=MaxBytes, otherwise 2*floor(B/MaxBytes)+1: disjoint adjacent byte-trigger
batches together exceed MaxBytes. Total reserved flushes are the minimum of N
and the sum of those bounds. Arithmetic uses bounded capacities and division
before multiplication (saturation returns N). A conservative bound may refuse a
request that an optimal packer could accept. Existing accumulation contributes
to temporary `throttled` pressure; a request exceeding this bound even with an
empty bucket is `too_large`.

Conservative per-item allowances cover added tenant/name labels and truncation
markers. Defaults retain at most, per signal, logical payload bytes of
`(3 * MaxTenants + 3 * QueueDepth + Workers) * MaxBytes`, plus one bounded serialized
admission/preflight and owned clones. Logical accounting includes field headers,
strings, metadata and nested data; Go allocator, map bucket overhead, transient
normalizer allocations and tenant state are separate. Element counts bound
staging; batch item and byte capacities bound owned queued/buffered/in-flight
payload structures. The memory backend retains its own unbounded history. These
are component bounds, not a whole-process RSS or soak guarantee.

## Storage, metadata and shutdown

Only SPI stores are used. Optional `spi.MetadataStore` receives metadata as
separate high-lane envelopes, enqueued once per submitted metadata entry (write attempts may repeat), never
attached wholesale to every split data batch. Metadata strings/headers count
against request and queued byte/item capacity. Unsupported metadata is reported
and counted explicitly; memory does not support it. Metric batcher Stats count
both point and metadata envelopes, while Result reports them separately.

Writes use a lifecycle context and five-second attempt timeout. Only throttled,
unavailable and timeout retry: initial attempt plus at most three retries at
100/200/400 ms with ±20% jitter. Lifecycle cancellation interrupts retry waits
regardless of SPI classifying cancellation as timeout. A batch containing points
and metadata may replay point writes after a metadata failure; all writes retain
at-least-once semantics. Workers hold finite in-flight ownership during retries.
Stats expose fixed-size error-class counters, retry counts and written,
write-failed or shutdown-affected envelopes/records. SPI errors can accompany
partial driver success; affected counts cannot prove exact durable item loss.

Close rejects new submissions atomically, includes any committed bounded CPU
work, flushes and drains using the supplied shared deadline, then cancels and
accounts remaining items. Parent cancellation followed by Close(background)
terminates and accounts pending payloads; subsequent Close is safe. Close can
wait beyond its deadline for already executing bounded CPU work and for a backend
that must honor SPI cancellation. Context-ignoring drivers violate SPI and cannot
be forcibly terminated safely. Pipeline Close never closes the borrowed backend.
