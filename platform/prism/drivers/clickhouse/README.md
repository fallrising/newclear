# ClickHouse write driver (P1-09)

This package registers `clickhouse` with the public SPI. Import it for registration, open an existing database with `spi.Open`, and call `Migrate` before using the three stores. The daemon continues to select memory: ClickHouse production queries and runtime wiring belong to P1-10. Every mandatory read method currently returns classified `Unsupported`; optional metadata/delete/native query/dependency/RED interfaces are absent. Capabilities describe only the implemented scope.

The [milestone contract](../../docs/specs/p1-09-clickhouse-write.md) and [ADR-018](../../docs/sdd/13-ADR.md#adr-018p1-09-clickhouse-write-only-driver-與現行-spi-適配) define the executable SPI adaptations. Go remains 1.27.1. Native transport uses official clickhouse-go/v2 v2.48.0 (Apache-2.0); [dependency provenance](../../docs/dependencies-clickhouse.md) records the selected shared-module changes and actual imported licences.

## Configuration

Native DSN: `clickhouse://user:password@host:9000/database?secure=false&dial_timeout=5s`. Treat a real DSN as a credential; never print it. TLS verification remains enabled for `secure=true`. The target database must exist. Only explicitly supported DSN keys are accepted; invalid/duplicate parameters and conflicting credential sources fail before opening. `username_file` and `password_file` in `spi.Config.Options` accept bounded regular files only (4 KiB); FIFO, device and symlink paths are rejected. No credential-bearing public type or driver-to-internal import is introduced.

| SPI option | Default | Bound / behavior |
| --- | --- | --- |
| `cluster` | empty | Nonempty returns Unsupported; replicated deployment is later verified scope. |
| `max_execution_time` | 55 seconds | 1–3600; explicit SQL cap on migration scans and INSERTs; client operation deadline includes 5 seconds of overhead and caller cancellation. |
| `max_memory_usage` | 1,000,000,000 bytes | Positive, at most 2^50. |
| `max_result_rows` | 5,000,000 | Positive, at most 2^30. |
| `async_insert` | 1 | 0 or 1; wait_for_async_insert remains 0 for telemetry batches. |
| `max_open_conns` | 10 | 1–1000; bounded native pool and operation admission. |
| `retention_metrics_days` | 30 | 1–36500; metric samples. |
| `retention_logs_days` | 14 | 1–36500. |
| `retention_traces_days` | 7 | 1–36500; spans and trace index. |
| `retention_red_days` | 90 | 1–36500; RED, service dependencies and service operations. |

The pinned native client derives a protocol max_execution_time from a context deadline. Controlled scans and INSERTs therefore include the configured cap in SQL; native batch preparation verifies returned column names/order before appending any telemetry. DDL retains a finite client deadline; its protocol server cap is derived by the upstream client. No arbitrary native settings or debug logger are passed through. Errors expose fixed driver diagnostics and stable SPI classes; raw server SQL, values and credentials are discarded. Context cancellation/deadline identity is retained.

## Write and migration semantics

Writers validate a complete call before preparing batches. Limits are 10,000 records, 16 MiB logical payload, 128 entries per map/label set, and 256 events/links per span. Timestamp values must be in `[1970-01-01T00:00:00Z, 2106-02-07T06:28:16Z)`; ends must not precede starts. Conversion uses existing UTM helpers. A TTL source plus its effective UTC retention must also remain below the upper bound, otherwise the entire call returns BadRequest before preparing any batch. Logs and metrics use their own retention; span starts use the maximum of trace, RED and one-day pending-link retention. This prevents DateTime TTL overflow on the pinned server without silently shortening retention. Logical limits are not RSS guarantees. Native operations and admission have finite deadlines; Close cancels/drains admitted work before closing the client once.

Metrics require UTF-8 label names and values and sorted unique labels with matching `__name__` and nonempty trusted `__tenant__`. Current SPI has no fingerprint field, so the writer calls existing `utm.Fingerprint` on the complete label identity. A 100,000-entry/32 MiB logical LRU suppresses redundant metadata, while extending first/last seen still writes exact millisecond extents. Cache changes follow successful metadata and sample sends. It does not retry partial multi-table writes.

Logs preserve labels and record attributes separately from full resource attributes. Span Nested parallel arrays preserve event time/name/attributes and link trace/span/attributes; additional columns preserve trace state and complete resources. Span dependency joins use tenant+trace+span identity; unresolved parents are recorded in one-day pending links. Periodic reconciliation and dependency queries are later scope; dependency graphs remain approximate.

Eight embedded SQL templates migrate in ascending order. Receipts use SHA256 of the unrendered template and synchronous acknowledgement. Drift, malformed/duplicate/unknown receipts fail closed. Same-backend Migrate calls serialize and respect cancellation. Independent processes must not concurrently migrate the same database; use one startup migrator. DDL is retryable after a partial failure through IF NOT EXISTS; this is not a database transaction. Retention changes reconcile TTL without changing migration checksums. Migrate validates existing source maxima in all eight TTL tables before issuing any MODIFY TTL; unsafe expiry returns BadRequest without changing TTLs. Drain all other backend/process writers before changing retention and migrating, because older writers cannot share the new retention guard. TTL arithmetic uses UTC.

Default asynchronous acknowledgement is not a durable-storage guarantee. Server failure after acknowledgement, partial multi-table success or a lost response can leave missing data/duplicates; caller retries need that context. TTL uses whole parts and day precision. Metric series metadata intentionally has no automatic TTL, matching the original schema; stored tenant/label names may outlive samples. `Retention.Enforced` is therefore false. Delete/tenant lifecycle erasure is not implemented in this milestone.

ClickHouse is a general-purpose database; this schema does not claim the compression/high-cardinality efficiency of a dedicated TSDB. PromQL/native histogram/exemplar reads and logfmt pushdown are absent; classic expanded float samples are supported. Future Jaeger duration queries must use root-span duration (max-span fallback when root is absent); no such query is implemented here.

## Real database verification

From the Prism module directory, run:

```sh
python3 drivers/clickhouse/run-integration.py
```

The runner uses a pinned official ClickHouse image and temporary local database/container, finite process limits, loopback ports and public fixture credentials. Explicitly selected integration tests fail when prerequisites are missing. Test-only native SQL reads prove persistence without implementing production query APIs. Unit/race tests run with the normal repository `make lint test`; see [inventory](../../docs/inventory.md) for actual final results.
