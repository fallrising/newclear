# PromQL storage adapter

`New(store, tenant, Limits{})` returns the pinned Prometheus v0.53.0
`storage.Queryable`. Each querier owns selected sets and cancellation; it never
closes the shared store. Invalid construction values are reported by `Querier`.

| Limit | Zero-value default | Meaning per querier |
|---|---:|---|
| MaxScanRows | 5,000,000 | Successfully inspected samples across every iterator and Seek |
| MaxSeries | 100,000 | Cumulative inspected series, and independently cumulative Select/reopen attempts |
| MaxLabelResults | 100,000 | Visible label results and warning entries per result |
| MaxLabelsPerSeries | 128 | Labels per series, and hidden label names per label result |
| MaxMatchers | 128 | User matchers or grouping names per request |
| MaxRetainedSets | 1,024 | Simultaneously open SPI sets; released slots are reused |
| MaxLabelBytes | 1,048,576 | String bytes per matcher list, labels, hints, warning list or label result; also bounds tenant |
| MaxRegexBytes | 4,096 | Bytes per regular expression before compilation |
| MaxMetadataBytes | 67,108,864 | Cumulative logical budget for adapter copies and bookkeeping |

Negative limits, empty tenant, inverted querier bounds, oversized tenant and
limits that overflow the label overflow probe are bad requests. Resource
exhaustion fails with `spi.ErrTooLarge`, including the one-item probe required
to distinguish exact limits from truncation. No result is silently truncated.
Metadata accounting charges detached string bytes and conservative label,
matcher, warning, owner and iterator bookkeeping before allocation; it remains
consumed across iterator reuse and set release. Backend-owned objects, regexp
implementation overhead, context/runtime overhead and caller copies are outside
this logical budget; it is not an RSS bound.

Bounds are inclusive milliseconds. Hints are clamped to querier bounds; Step,
Func, Grouping, By and Range are preserved. Grouping and matcher strings are
detached. Active sharding and disabled trimming fail explicitly. SPI label
ordering is authoritative. Every request carries the trusted tenant, reserved
user matchers/grouping names are rejected except `__name__`, and returned
internal labels are hidden. LabelNames requests probe enough entries for the
visible limit plus the bounded hidden-name allowance; filtering does not consume
visible result slots.

The SPI permits the current series storage to change after `Next`. Enumeration
therefore freezes full labels and exposes a filtered label slice. Each sample
iterator reopens the original time/hint selection with ordinary equality
matchers and verifies the complete original labels, including absent versus
empty identity. The matching set stays unadvanced until the sample iterator
exhausts, fails or its querier closes. Iterator reuse reopens another scan and
shares every budget. This adds storage calls and provides no snapshot consistency
across calls or concurrent writes (ADR-015). The memory driver currently
materializes its own Select results before return; adapter limits cannot bound
that pre-existing allocation.

Iteration preserves float bits, stale NaNs and infinities. Seek only moves
forward; exhaustion is terminal until reuse. Histogram accessors return nil
because the SPI supplies floats. Enumeration warnings become upstream
annotations. All enumerated series share their enumeration's cumulative warning map under
the querier mutex, including warnings added at EOF. Each unique warning is
charged once; accumulated count and bytes remain bounded even when individual
SPI warning lists are not cumulative. Previously surfaced reopen warnings remain
successful. New warnings on reopen or sample exhaustion
fail explicitly as `spi.ErrUnsupported`: `chunkenc.Iterator` cannot attach new
annotations after engine series expansion, so they must not disappear.

A querier mutex serializes SPI operations and iterator state. Close cancels its
shared context before acquiring that mutex, allowing a context-aware blocked
Select to return. Each operation combines caller cancellation with querier
cancellation. Sets close exactly once, released backend references are cleared,
and close errors reach set/iterator errors and idempotent Querier.Close. An
iterator reused from another querier is not modified; its original owner retains
responsibility for closing it. No persistent goroutine is started.

The iterator uses `millisecondTimestamp = int64` to name timestamp units while
preserving the exact upstream type identity. Go 1.27.1 vet stdmethods compares
printed parameter types and otherwise mistakes Prometheus `Seek(int64) ValueType`
for an attempted `io.Seeker` implementation. The semantic alias avoids that
false inference; a compile-time `chunkenc.Iterator` assertion guards the upstream
contract. Native vet and all pinned analyzers remain enabled; no nolint is needed.
