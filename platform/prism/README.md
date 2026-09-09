# Prism

Prism is a storage-pluggable observability compatibility layer for metrics,
logs, traces, and alerting. It accepts standard telemetry protocols and exposes
Prometheus, Loki, Jaeger, and Alertmanager-compatible APIs while keeping storage
behind a public Go SPI.

This component is in Phase 0 of spec-driven development. It is not yet a usable
APM service.

## Repository layout

- `pkg/utm` and `pkg/spi` are the stable model and storage contracts.
- `internal` contains protocol-independent business semantics and compatibility
  adapters.
- `drivers` contains isolated storage implementations.
- `cmd` contains `prismd`, `prism-agent`, and `prismctl`.
- `docs/sdd` is the implementation source of truth.

The Go module is `github.com/fallrising/newclear/platform/prism`, matching this
component's canonical location in the newclear monorepo.

## Non-negotiable constraints

- Loki/Tempo/Grafana source code is AGPL and must not be imported. LogQL is a
  clean-room implementation based only on public protocol behavior.
- Telemetry data is not backed up by default. PostgreSQL metadata and Git-managed
  configuration are the recovery sources; operators needing telemetry durability
  must provide it at the storage layer.
- A monitoring system cannot prove its own availability. Production deployments
  require an external watchdog receiver.

## Current checks

```sh
make lint test
```

The repository-root `Prism CI` workflow runs the same gate for changes to this
component.
