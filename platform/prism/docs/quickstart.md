# Prism development quickstart

This exercises authenticated OTLP and remote_write ingestion with the memory backend. Compatible
query APIs and production storage are later milestones. Fixture credentials are
public and intended only for loopback development.

## Prerequisites

Go 1.27.1, a C compiler for race tests, and Bash. Python 3 is needed for the daemon
smoke probe. Run commands from `platform/prism`; initial module/tool downloads
require network access. Install Go 1.27.1 or select it with
`export GOTOOLCHAIN=go1.27.1`; use `export GOFLAGS=-mod=readonly` to keep dependency
files unchanged. `go version` should report `go1.27.1`. CI installs the version
from `go.mod` and disables automatic switching with `GOTOOLCHAIN=local`.
Go 1.23 is no longer a supported build baseline; see the
[upgrade contract](specs/go-1.27-upgrade.md).

## Verify the source

```sh
make lint test
scripts/check-dependencies.sh
scripts/test-dependency-guard.sh
go build ./...
```

See [inventory](inventory.md) for observed results and the remaining acceptance
boundaries. The separate [external-client gate](../test/e2e/README.md) uses a
pinned telemetrygen and Prometheus and checks actual memory contents through SPI.

## Check configuration and start

```sh
go run ./cmd/prismd --config internal/config/testdata/prismd.yaml --config-check
go build -o /tmp/prism-dev-prismd ./cmd/prismd
/tmp/prism-dev-prismd --config internal/config/testdata/prismd.yaml
```

Expected config output: `prismd: configuration valid`. The fixture uses `memory`
and loopback HTTP/gRPC listeners. `deploy/prismd.yaml` is an administrator-facing
configuration example, not a deployment or an implemented ClickHouse stack.
The default storage selection still requires an explicitly selected implemented
driver; currently that is memory, which retains data without a storage-size cap.

The `all-in-one` and `ingest` roles require an independent
`auth.ingest_api_key_file` containing at least 32 bytes. The file is read with a
size limit and its value is redacted. Do not reuse the JWT secret or the public
test key. This milestone supports only `tenancy.mode: single`; strict ingest
configuration fails validation until full tenant authentication is implemented.
Client tenant selectors, when present, must match the key's configured tenant.

## Inspect and export

In another terminal:

```sh
curl --fail http://127.0.0.1:9090/-/healthy
curl --fail http://127.0.0.1:9090/metrics
prism_demo_key="$(cat internal/config/testdata/secrets/ingest_api_key)"
curl --fail --header 'Content-Type: application/json' \
  --header "Authorization: Bearer $prism_demo_key" \
  --data '{}' http://127.0.0.1:9090/v1/metrics
unset prism_demo_key
```

HTTP also accepts `/v1/logs` and `/v1/traces`, with JSON or protobuf and optional
gzip. gRPC exposes the three OTLP Export services on port 4317. Every write,
including an empty export, requires bearer authentication. Both listeners use
the configured TLS certificate when TLS is enabled. Plaintext examples are for
local testing or a trusted network.

Health returns `ok`; metrics expose Go/process collectors. Prism's separate
self-telemetry registry is not yet populated by the daemon. Successful OTLP
responses acknowledge bounded asynchronous admission, not durable storage.
Partial-success counts use original OTLP units; clients must not retry a partial
success as a whole request. See the [receiver design](specs/p1-04-otlp.md).

Ctrl-C or SIGTERM stops new receiver work, drains requests and queued writes
within one deadline, then closes storage. Set `PRISM_SERVER_HTTP_LISTEN` and
`PRISM_SERVER_GRPC_LISTEN` to unused loopback ports if the defaults are busy.

## Prometheus remote_write

Configure Prometheus to write to the existing HTTP listener. Use an absolute
credential-file path readable by the Prometheus process; the file must contain
the same ingest key configured in Prism. The key is not part of this YAML:

```yaml
remote_write:
  - url: http://127.0.0.1:9090/prom/api/v1/write
    authorization:
      credentials_file: /absolute/path/to/ingest-key
    queue_config:
      min_shards: 1
      max_shards: 1
      retry_on_http_429: true
```

Use a different local web port for Prometheus (for example
`--web.listen-address=127.0.0.1:9091`) so its default port does not collide with
Prism. Prometheus sends snappy block-compressed v1 protobuf automatically. v2 is
not supported. A 204 acknowledges asynchronous admission; overload before
admission returns 429 with Retry-After. A nonretryable 400 can mean some valid
samples were accepted while others were rejected. Native histograms remain
unsupported and are dropped with sampled diagnostics. See the
[P1-05 contract](specs/p1-05-remote-write.md) and the
[real sender test](../test/e2e/README.md#real-prometheus-remote_write).

## Resource and integration boundaries

Daemon queues use smaller defaults than the standalone pipeline package. The
configuration validates conservative logical payload/receive-buffer capacity
against `ingest.memory_limit`; this is not a process RSS ceiling. Decoded pdata,
allocator overhead, transient normalization and state, and backend retention are
additional costs. Do not treat the memory backend as durable production storage.

Loki push, query APIs, full multi-tenant authentication, registered
pipeline telemetry, live reload and deployment remain later work. Follow the
[SDD task order](sdd/12-IMPLEMENTATION-PHASES.md).
