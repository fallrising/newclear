# Memory storage driver

The `memory` driver is Prism's dependency-free reference backend. It stores
metrics, logs, and spans in process memory and is intended for development,
unit tests, and storage SPI conformance tests.

## Configuration

Use driver name `memory`. The DSN and driver-specific options are ignored.
Schema migration and health checks are no-ops while the backend is open.

## Capabilities and limits

- Metrics, logs, and traces are supported through the mandatory Tier-1 SPI.
- No native PromQL, LogQL pushdown, live tail, metadata, exemplar, RED, or
  dependency-query optional interface is advertised.
- Out-of-order writes are accepted and query results are sorted according to
  the SPI contracts.
- Data is process-local, unbounded, and discarded by `Close` or process exit.
- Tenant isolation uses the tenant carried by UTM resources and the
  `__tenant__` metric label. This is not a native backend security boundary, so
  `Capabilities.MultiTenant` remains false.
