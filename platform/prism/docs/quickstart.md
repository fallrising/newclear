# Prism development quickstart

This exercises authenticated OTLP, remote_write and Loki JSON ingestion plus
Prometheus HTTP queries with either memory or ClickHouse storage. Fixture credentials are
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
pinned telemetrygen, Prometheus and Vector and checks actual memory contents through SPI.

## Check configuration and start

```sh
go run ./cmd/prismd --config internal/config/testdata/prismd.yaml --config-check
go build -o /tmp/prism-dev-prismd ./cmd/prismd
/tmp/prism-dev-prismd --config internal/config/testdata/prismd.yaml
```

Expected config output: `prismd: configuration valid`. The fixture uses `memory`
and loopback HTTP/gRPC listeners. `deploy/prismd.yaml` is an administrator-facing
configuration example. Select `memory` or `clickhouse` explicitly. Memory retains
data without a storage-size cap; ClickHouse needs an existing database and applies
the configured retention and query bounds.

The `all-in-one` and `ingest` roles require an independent
`auth.ingest_api_key_file` containing at least 32 bytes. The file is read with a
size limit and its value is redacted. Do not reuse the JWT secret or the public
test key. This milestone supports only `tenancy.mode: single`; strict ingest
and query configuration fails validation until full tenant authentication is implemented.
Client tenant selectors, when present, must match the configured `tenancy.default_tenant`.

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

Health returns `ok`; metrics expose Go/process collectors. When self-monitoring
is enabled, the daemon also registers Prism metrics. Query and all-in-one roles
populate query telemetry when they receive read requests;
ingestion counters are not yet connected to pipeline events. Successful OTLP
responses acknowledge bounded asynchronous admission, not durable storage.
Partial-success counts use original OTLP units; clients must not retry a partial
success as a whole request. See the [receiver design](specs/p1-04-otlp.md).

Ctrl-C or SIGTERM stops new receiver work, drains requests and queued writes
within the graceful deadline, then waits for active queries before closing storage.
A backend that ignores query cancellation can extend that final wait. Set `PRISM_SERVER_HTTP_LISTEN` and
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

Loki protobuf push, Loki/Jaeger query APIs, full multi-tenant authentication, populated
pipeline telemetry, live reload and deployment remain later work. Follow the
[SDD task order](sdd/12-IMPLEMENTATION-PHASES.md).

## Loki JSON push

Send JSON to `POST /loki/api/v1/push` on the same HTTP listener, with `Content-Type: application/json`, the same bearer key and optional gzip. Each entry uses a timestamp string, line string and optional flat string metadata. Client tenant selectors must match the configured tenant.

For Vector's Loki sink set `compression = "none"` or `"gzip"`; its default snappy mode sends protobuf, which this milestone does not support. See the [real Vector acceptance](../test/e2e/README.md#real-vector-loki-json-push) for the pinned binary and executable gate. Loki query/ready APIs are not implemented, so disable the sink healthcheck for this ingest-only test.

204 acknowledges asynchronous admission. A partial 400 can leave valid records persisted; retrying an unexpected committed 500 can duplicate them. Byte/element/projected-expansion capacity failures are 413; receiver or pipeline backpressure 429 and stopped 503 include Retry-After. The separate Loki receive slot raises the default logical queue/buffer budget to 1000 MiB, not a hard RSS limit. Details and trust/cancellation boundaries are in the [P1-06 contract](specs/p1-06-loki-push.md).


## PromQL storage verification

The P1-07 adapter can be tested directly against memory SPI without a running
daemon. P1-08 also exposes it through the HTTP endpoints below.

```sh
go test -race -count=1 ./internal/query/promqladapter
go test -race -count=1 ./test/promqltest -driver=memory
go test -race -count=1 ./test/security
```

See the [corpus README](../test/promqltest/README.md) for exact upstream fixture
provenance, executed float cases and native-histogram exclusions. Traditional
`_bucket` histograms are included. The adapter's streaming bridge reopens an
exact series when samples are requested; it preserves SPI ownership but adds
storage work and cannot promise snapshot isolation across those calls.

## Prometheus HTTP queries

The `query` and `all-in-one` roles expose `/prom/api/v1/query`, `query_range`,
`series`, `labels`, `label/{name}/values`, `metadata` and `status/buildinfo`.
The `ingest` role does not expose them. Query-only memory storage is process-local,
so use all-in-one for a local ingest-and-query experiment.

Set `auth.allow_anonymous_read: false` to require the same file-backed bearer
key used by ingestion; anonymous reads are enabled by the existing default.
Even with anonymous reads enabled, supplied invalid credentials are rejected.
Tenant headers may only match `tenancy.default_tenant`; strict tenancy fails
closed until the multi-tenant control plane is implemented.

```sh
prism_demo_key="$(cat internal/config/testdata/secrets/ingest_api_key)"
curl --fail --get --header "Authorization: Bearer $prism_demo_key" \
  --data-urlencode 'query=vector(42.5)' \
  http://127.0.0.1:9090/prom/api/v1/query
unset prism_demo_key
```

The result contains a vector sample with value `"42.5"`. Numeric times are Unix
seconds; RFC3339 times and Prometheus duration strings are supported. Configured
timeout, concurrency, lookback, range and point bounds also apply to nested
selectors and subqueries. An old query start clamps inside the maximum lookback
by `lookback_delta` (five minutes by default), leaving room for implicit selector
lookback; explicit ranges and offsets cannot cross the storage floor. Requested
`limit` truncation on instant/catalog APIs and outer time clamps produce warnings
and adjustment counters; `query_range` rejects `limit`; hard resource limits fail explicitly.
Metadata is an empty object when the backend has no metadata store.

See the [HTTP contract](specs/p1-08-prometheus-http.md) for limits and the
[real promtool gate](../test/e2e/README.md#real-promtool-http-queries) for an
actual write followed by instant/range queries. Rules, alerts, remote_read and
native histogram results remain outside this milestone.

## ClickHouse storage

Set `storage.driver: clickhouse` in a copy of the daemon configuration. Put the
native DSN in a regular credential file and set `storage.dsn_file` to its path;
relative paths resolve from the configuration directory. The file is limited to
4 KiB and must not be a symlink, FIFO or device. `storage.dsn` and `storage.dsn_file`
are mutually exclusive; inline DSNs are redacted when configuration is formatted
or serialized. The target database must already exist. Startup opens the driver
and applies migrations before accepting ingestion or queries; `--config-check`
validates configuration without contacting ClickHouse.

The four `storage.retention` settings govern the matching driver retention options.
Conflicting duplicate options fail validation, and `storage.split` is rejected
because this runtime uses one backend. Query timeout must exceed the driver's
server execution cap. See [driver options](../drivers/clickhouse/README.md#configuration)
for scan, result, memory, execution and connection bounds.

Run the disposable local database gate:

```sh
python3 drivers/clickhouse/run-integration.py
```

Docker socket access, Python3 and network access for the pinned official image
are required. The runner owns its temporary loopback fixture and cleanup; it
does not deploy Prism. See the [driver README](../drivers/clickhouse/README.md)
for read contracts, credential files, write bounds, acknowledgement and retention
limitations. The gate covers writes, supported SPI conformance, supported float
PromQL and the actual daemon ingestion→ClickHouse→PromQL chain. The optional
[P1-11 local deployment](../deploy/README.md) has a separate owned Compose E2E gate.


## Phase 1 local Compose E2E

The [deployment README](../deploy/README.md) describes the five required secret
files, official Linux amd64 image pins and local stack. Build a unique
`prism/prismd:prism-e2e-<unique>` image from the module root using
`deploy/Dockerfile.prismd`; keep TLS verification and the configured proxy when
building. Managed builds can pass the combined CA bundle as optional BuildKit
secret `id=prism_ca`, which is never copied into image layers.

With verified Compose and external-client binaries available, run:

```sh
OTLP_TELEMETRYGEN_BINARY=/path/to/telemetrygen \
PROMETHEUS_BINARY=/path/to/prometheus \
VECTOR_BINARY=/path/to/vector \
GOTOOLCHAIN=go1.27.1 GOFLAGS=-mod=readonly \
make e2e E2E_ARGS='--docker-host unix:///var/run/docker.sock --compose-binary /path/to/compose --no-build --image prism/prismd:prism-e2e-UNIQUE --artifact-dir /path/to/private/evidence'
```

The runner validates final configuration in the image, starts one labelled local
Compose project, then requires real-client ingestion, ClickHouse rows, PromQL
values, Grafana metrics datasource health/query and a provisioned metric panel.
It verifies visible data survives graceful daemon and ClickHouse restart, then
removes only confirmed owned containers/volumes/network and disposable credentials.
Failures remain failures and bounded redacted evidence is retained. Raw Docker
container environment and serialized credentials are excluded from evidence.

Only Prometheus query API acceptance is implemented. Logs/traces storage checks
do not establish Loki/Jaeger query compatibility; full alerting/agent/control-plane
and production deployment remain later work. Keep the documented async ack,
retention and process-memory limitations when interpreting results.

Storage-free instant queries such as `1+1` or `vector(time())` may use a historical
top-level evaluation time. They run in the pinned PromQL engine without native
storage dispatch, including when the backend advertises native query support.
This permits Grafana's constant datasource health probe. Data selectors (including
`up @ <current-time>` at a historical evaluation time), historical range queries,
future-time, modifier, complexity, authentication, tenant and resource limits
retain their existing restrictions; the global lookback is unchanged.
