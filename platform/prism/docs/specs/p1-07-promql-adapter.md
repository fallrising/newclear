# P1-07: bounded PromQL storage adapter

## Goal and scope

Adapt the existing SPI MetricStore to the pinned Prometheus v0.53.0 storage.Queryable so its engine evaluates float-sample queries against memory storage. Keep Go 1.27.1, public SPI and driver interfaces unchanged. HTTP endpoints, routing, runtime configuration, query telemetry, native histogram support and P1-08 are outside this slice.

## Contract

- `New(ms spi.MetricStore, tenant string, limits Limits) storage.Queryable`. Tenant is trusted constructor input; every Select/LabelNames/LabelValues request carries it. Invalid constructor values surface as classified errors from Querier. User matchers on reserved `__` labels except `__name__` are rejected before storage access; internal tenant labels are not exposed to PromQL outputs or label APIs.
- Querier inclusive millisecond bounds and select hint Start/End/Step/Func/Grouping/By/Range map to SPI without unit conversion. Hints cannot broaden querier bounds. Clone caller-owned slices. Extra upstream sharding flags unsupported by SPI must fail explicitly when active, not silently change results; default trimming behavior is preserved. SPI ordering is authoritative.
- Wrap sample iteration without materializing the full result. Preserve float bits including stale NaN and infinities. Implement forward Seek, At/AtT, reset on iterator reuse and explicit float-only histogram behavior. SPI Series is valid only until the next Next (SDD14 §7), while upstream series must remain iterable. Copy the full label identity at enumeration, then reopen a tenant-scoped exact-series selection for each sample iterator; compare full labelsets to reject equality-matcher supersets and absent/empty aliases. Keep the matched set unadvanced while its samples are in use. Iterator reuse opens a fresh scan.
- Bound rows scanned across all selections of one querier (default 5000000), series/label/matcher resources and retained iterator ownership. Resource exhaustion is spi.ErrTooLarge, never silent truncation. Context cancellation reaches storage and long loops. Invalid ranges and malformed matchers are spi.ErrBadRequest. Errors retain errors.Is classification; storage warnings become upstream annotations.
- Querier.Close owns all selected sets, closes each once including early exit/error, is idempotent, and does not close the shared backend. Enumeration sets may close after identity snapshots are detached; sample sets close only after their iterator exhausts/errors or Querier.Close. Define concurrent Select/Close ownership before implementation; no unbounded goroutine or cleanup registry.

## Acceptance

Focused tests first for mappings, empty/negative/regexp matchers, range boundaries, tenant spoofing, labels, float/stale iteration and reuse, error/warnings, resource boundaries, cancellation and close races. Execute real upstream PromQL engine queries through the adapter into memory, and the official v0.53.0 float-compatible corpus with a transparent manifest. The upstream harness API must be verified; its default TSDB storage is not evidence of Prism acceptance. Native-histogram cases conflict with the existing float-only SPI and must be explicitly separated with reasons/counts rather than claimed green. Any further incompatibility is investigated, not silently skipped.

Run native make lint test, dependency guards and negative fixtures, build, pinned lint, security and independent review against final hashes. Activate only the already-pinned dependency closure if required, document all metadata changes and preserve versions; any new independently selected runtime dependency requires owner authorization.

## Design checkpoints

The initial API/corpus feasibility review may refine internal limits and the harness, with documented evidence before dependent implementation. This milestone does not claim full Phase 1 exit, HTTP query usability, production storage, RSS bounds or deployment.


### Accepted lifetime decision (ADR-015)

Reopening preserves the SPI lifetime and streaming requirements without extending public interfaces. It incurs up to one additional selection per sample iterator plus bounded work to disambiguate exact labelsets. Every inspected series, reopened set and scanned row shares finite querier budgets. Returned labels must not alias recycled backend buffers. Concurrent writes may become visible between enumeration and reopen: SPI has no snapshot transaction, so this adapter does not promise cross-call snapshot consistency. The memory driver materializes its own selections; adapter limits bound its own consumption/retention, not allocation already performed inside a backend.

Zero-valued Limits fields choose defaults: MaxScanRows 5000000, MaxSeries 100000, MaxLabelResults 100000, MaxLabelsPerSeries 128, MaxMatchers 128, MaxRetainedSets 1024, MaxLabelBytes 1048576, MaxRegexBytes 4096 and MaxMetadataBytes 67108864; negative values fail at Querier construction. Metadata counts cumulative logical owned copies, including identity labels, hints/matchers, warnings and iterator bookkeeping, not regex heap or process RSS. A label API asks storage for one extra item where possible to detect truncation rather than silently returning a partial set.

Final dependency activation uses 11 indirect requirements already selected at exactly the baseline versions and 13 additional checksum lines. The complete `go list -m all` output remains byte-identical to baseline. No version upgrades or independently selected dependency are introduced. The earlier TSDB harness probe was discarded; its cloud/test diagnostic dependencies are not part of the final activation.

### Official corpus and security boundary

The pinned corpus has 12 files and 768 eval directives. Classification from official parsed load sequences, expression selectors and expected histogram values marks 579 float-compatible directives for execution and 189 native-dependent directives as unsupported by v1. All 189 happen to be in native_histograms.test, but classification is per directive, not a filename exclusion; traditional bucket histograms remain included. Preserve exact upstream input files, SHA256 provenance, Apache-2.0 attribution and a line-specific exclusion manifest. The official comparator and its instant/range/@ expansions remain in use. The Apache-2.0 core harness is narrowly adapted: native testing replaces testify/testutil and fixture loads write directly into memory SPI. The official parser, comparator and instant/range/@ expansion logic are retained, with source provenance and documented changes. Queries exclusively use this adapter; a routing regression must fail if that is bypassed. The original upstream harness imports an ISC diagnostic dependency outside this project’s whitelist, so it is not imported.

The adapter rejects reserved storage matchers and hides stored internal labels, including nested selector reads. PromQL label_replace can synthesize an arbitrary output label after storage evaluation; preventing reserved output names requires the P1-08 AST/output layer. This milestone verifies synthesized labels cannot change the fixed storage tenant; it does not claim that output policy is already implemented.


Warnings accumulate across series enumeration, including warnings first returned at EOF, and remain valid across exact-series reopen. Each distinct warning is charged once against bounded cumulative metadata, count and bytes. If a reopen introduces a new warning, the float sample iterator has no annotation channel; return a classified unsupported error instead of silently hiding it. Clean exhaustion remains clean after subsequent Seek, and cancellation errors preserve both SPI timeout classification and errors.Is identity.

LabelNames preserves the SPI contract that omits all `__`-prefixed names (SDD14), including metric-name enumeration on memory; LabelValues(`__name__`) remains available. Complete HTTP label API compatibility belongs to P1-08. The upstream subquery.test whitespace at lines 85/88 and EOF 117 is preserved under a narrow immutable-fixture exception; all authored files keep normal whitespace validation.
