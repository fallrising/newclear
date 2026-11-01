# Prism Phase 1 deployment

`docker-compose.yml` runs `prismd`, ClickHouse and Grafana. Its image pins were
resolved for Linux amd64; another platform needs its own digest review and
acceptance run. This stack is a local Phase 1 test path, not a production
capacity or high-availability profile.

Prepare five bounded regular files in `PRISM_SECRETS_DIR` (default:
`deploy/secrets`): `clickhouse_password`, `clickhouse_dsn`, `ingest_api_key`,
`grafana_password` and `jwt_secret`. The ClickHouse DSN must name the native
port and the `prism` database, with a user/password matching the server's
file-backed password. Use at least 32 distinct bytes for `ingest_api_key` and
`jwt_secret`. Do not place real credentials in this repository. Ensure the
container users can read their mounted files: prismd runs as UID 65532 and
Grafana as UID 472. Grant only the needed user or group access in production;
the local E2E runner creates disposable credentials under a private directory.

From the module root, run `make deps-check`, then run the bounded E2E fixture
with an explicit local Docker socket and a unique, already-built daemon image:

```sh
export OTLP_TELEMETRYGEN_BINARY=/absolute/path/to/telemetrygen
export PROMETHEUS_BINARY=/absolute/path/to/prometheus
export VECTOR_BINARY=/absolute/path/to/vector
make e2e E2E_ARGS='--docker-host unix:///var/run/docker.sock --image prism/prismd:prism-e2e-example-1 --no-build --compose-binary /absolute/path/to/docker-compose'
```

Replace the example image with the unique local tag built for this run, and
point each binary path at its verified executable. `--compose-binary` may be
omitted when `docker compose` is available, or supplied through
`PRISM_COMPOSE_BINARY`. The runner also accepts `--artifact-dir` for a private
diagnostic directory. Running `make e2e` without `E2E_ARGS` prints the required
argument shape and exits without starting resources. Do not put credentials in
`E2E_ARGS`; the runner creates disposable files in its owned private fixture.

For a manually owned local Compose project, set
`PRISM_DATASOURCE_TOKEN` to the ingest key value, set a unique
`PRISM_VERSION`, and invoke Compose with `-f deploy/docker-compose.yml`.
Host ports default to loopback 9090, 4317 and 3000; override
`PRISM_HTTP_PORT`, `PRISM_GRPC_PORT` and `GRAFANA_HTTP_PORT` to avoid conflicts.
The managed E2E runner sets all three to `0` for ephemeral binds. The daemon's
healthcheck requests `/-/ready`; `--config-check` must pass against the mounted
files before accepting a stack as ready.

The current ClickHouse telemetry path uses `async_insert=1` with
`wait_for_async_insert=0`. An ingest acknowledgement does not guarantee a
durable disk write. The Phase 1 acceptance waits until known rows and values
are query-visible, then checks that those stored rows survive graceful daemon
and ClickHouse restarts. It does not establish crash durability for records
acknowledged before an async flush.

Grafana provisions four datasource definitions. Only Prism-Metrics, using the
Prometheus API and a secret bearer header, has Phase 1 query acceptance.
Grafana 12.0.0's automatic suggested-app preinstallation is disabled so startup
does not download unpinned app plugins; its four core datasource types remain
available for provisioning. This does not establish that their later-phase APIs
are implemented or healthy.
Prism-Logs, Prism-Traces and Prism-Alerts point at APIs planned for later
phases; their health is currently unsupported. The five dashboard files are
provisioned, with future panels labeled in each description. The future
trace-to-log and trace-to-metrics links have not been acceptance-tested. The hosts
dashboard requires an external node_exporter collector, and the self-telemetry
panels require an external scraper of `prismd` `/metrics` and remote_write.

`agent.yaml`, `alertmanager.yaml`, `rules/prism-builtin.yml` and
`systemd/prism-agent.service` are inactive future-phase references. The
`phase1-notify.yaml` and rules directory only satisfy existing config
validation; no alert evaluation or notification is started by Phase 1.
`systemd/prismd.service` is a reference for an installed binary and requires
an administrator to provision credentials and paths. The agent service's
`CAP_DAC_READ_SEARCH` permission can read any file on its host; a future
deployment should prefer precise supplementary groups when possible.

The ClickHouse XML files set single-node memory and query bounds. The merge
background pool is 16 with concurrency ratio 2: its 32 task slots cover
ClickHouse 24.8's default MergeTree free-entry thresholds of 20, 8 and 25.
This fixes the verified startup configuration error; it does not establish
production capacity or substitute for disk monitoring. Imported
Node Exporter Full (Grafana dashboard 1860) is an optional external dashboard
and is not bundled here.
