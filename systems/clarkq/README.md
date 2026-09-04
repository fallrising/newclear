# clarkQ

[![version](https://img.shields.io/badge/version-1.5.1-blue)](CHANGELOG.md)

Lightweight **HTTP message queue** written in Go. Current release **v1.5.1** — see [CHANGELOG.md](CHANGELOG.md) and [ROADMAP.md](ROADMAP.md).

Clients write and consume messages on named queues over a simple REST API. The hot path is in-memory FIFO; optional **WAL + snapshots** survive restarts. Use it for short-lived buffering, job handoff, worker pools, and local development.

## Features

- **Named FIFO queues** with lazy creation
- **HTTP API**: enqueue, consume, peek, long-poll, list, clear
- **Optional API key** and/or **JWT/OIDC** bearer auth
- **JWT queue ACL** via `scope` / `roles` claims (`queue:name:action`)
- **OpenTelemetry** traces (OTLP/HTTP)
- **Multi-node sharding** (consistent-hash by queue name + reverse-proxy)
- **Optional HTTPS + mTLS** (server cert/key + client CA)
- **Encryption modes**: plaintext, client-side E2E, or server RSA envelope encryption (global or per-queue)
- **Durability**: append-only **WAL** + optional JSON **snapshot** compaction
- **Metrics**: JSON (`/api/v1/metrics`) and Prometheus text (`/metrics`); example [alerts](deploy/prometheus/)
- **Admin UI** at `/ui/` (local ops console)
- **Cluster options**: RF replication, write/read quorum, linearizable consume, majority leases
- **Multi-tenant quotas** (`X-Tenant-ID`) when enabled
- **YAML config file** plus environment overrides
- **Client SDKs** (Go / Python / JS) with crypto helpers
- **Docker Compose + Helm chart** under `deploy/`
- **Resource limits**: max queues, max depth, max message size
- **Single static binary**, small dependency surface (`yaml.v3` only)

## Try the Docker capability demo

One command builds clarkQ in Docker and runs six business-style scenarios
(health/UI, FIFO jobs, API key auth, multi-tenant quotas, WAL restart, long-poll + metrics):

```bash
git clone https://github.com/fallrising/clarkQ.git
cd clarkQ/demo
./run-demo.sh
# optional: ./run-demo.sh --keep   # leave UI up at http://localhost:8080/ui/
```

Details: [demo/README.md](demo/README.md). Progress notes: [PROGRESS.md](PROGRESS.md).

### Multi-node cluster stress demo

Three local processes (or Docker) exercising shard forward, RF=2 replication,
failover, write-path quorum smoke, and concurrent load:

```bash
cd demo/cluster
./run-cluster-demo.sh          # multi-process (default)
./run-cluster-demo.sh --docker # optional Compose stack
# Advanced: linearizable + lease soak / partition / high-latency
./run-stress.sh --docker
./run-stress.sh --docker --long   # ~5 min soak
# make stress-docker | make stress-long
```

See [demo/cluster/README.md](demo/cluster/README.md).

## Quick start

```bash
# Build
go build -o bin/clarkq ./cmd/clarkq
# or: make build

# Run (plaintext, no auth — fine for local dev)
./bin/clarkq

# Admin UI: http://localhost:8080/ui/

# Write
curl -X POST http://localhost:8080/api/v1/queue/orders \
  -H "Content-Type: application/json" \
  -d '{"body":"hello","metadata":{"source":"demo"}}'

# Read (consume — message is removed)
curl http://localhost:8080/api/v1/queue/orders

# Health / Prometheus metrics
curl http://localhost:8080/health
curl http://localhost:8080/metrics
```

Recommended production-ish settings:

```bash
export CLARKQ_API_KEY="your-secret-key"
export CLARKQ_ENCRYPTION_MODE="server_rsa"   # none | client | server_rsa
export CLARKQ_SNAPSHOT_PATH="./data/snapshot.json"
export CLARKQ_SNAPSHOT_INTERVAL="30s"
export CLARKQ_WAL_PATH="./data/clarkq.wal"   # fsync per mutation
./bin/clarkq
```

Or use a config file:

```bash
export CLARKQ_CONFIG=configs/clarkq.example.yaml
./bin/clarkq
# env vars still override file values
```

## API overview

Base URL example: `http://localhost:8080`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/ui/` | **Admin UI** (no auth; API calls use your key) |
| `GET` | `/health` | Health check + version (no auth) |
| `GET` | `/version` | Build version / commit / date (no auth) |
| `GET` | `/metrics` | Prometheus metrics (no auth) |
| `GET` | `/api/v1/metrics` | JSON metrics |
| `GET` | `/api/v1/cluster` | Cluster membership, generation, outbox |
| `POST` | `/api/v1/queue/{name}` | Enqueue a message |
| `GET` | `/api/v1/queue/{name}` | Consume one message (FIFO) |
| `GET` | `/api/v1/queue/{name}?peek=true` | Peek without removing |
| `GET` | `/api/v1/queue/{name}?timeout=N` | Long-poll up to `N` seconds (`0`–`30`) |
| `DELETE` | `/api/v1/queue/{name}` | Clear all messages in a queue |
| `GET` | `/api/v1/queues` | List queues and depths |
| `GET` | `/api/v1/crypto/config` | Current encryption config |
| `GET` | `/api/v1/crypto/public-key` | Public key (`server_rsa` only) |

### Enqueue

```http
POST /api/v1/queue/orders
Content-Type: application/json

{
  "body": "hello world",
  "metadata": {
    "source": "service-a",
    "trace_id": "abc-123"
  }
}
```

Also accepts `Content-Type: text/plain` (body is the raw message; no metadata).

**201 Created**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "queue": "orders",
  "created_at": "2026-07-10T12:00:00Z"
}
```

### Consume

```http
GET /api/v1/queue/orders
```

| Status | Meaning |
|--------|---------|
| `200` | Message returned (and removed unless `peek=true`) |
| `204` | Queue empty |
| `404` | Queue does not exist |

### Queue names

- Allowed: `[a-zA-Z0-9_-]`, length 1–64
- Case-sensitive (`Orders` ≠ `orders`)

### Auth

When **API keys** and/or **JWT** are configured, every `/api/*` route requires **at least one** valid method. `/health` and `/metrics` stay public.

**API key**

```http
X-API-Key: your-secret-key
# or (when JWT is not used for the same token):
Authorization: Bearer your-secret-key
```

Comma-separated keys are supported via `CLARKQ_API_KEY`.

**JWT / OIDC**

```http
Authorization: Bearer <access_token>
```

| Config | Purpose |
|--------|---------|
| `CLARKQ_OIDC_ISSUER` | Expected `iss`; enables OIDC discovery for JWKS |
| `CLARKQ_OIDC_AUDIENCE` | Expected `aud` |
| `CLARKQ_OIDC_JWKS_URL` | Explicit JWKS (skips discovery) |
| `CLARKQ_JWT_HS_SECRET` | HS256 shared secret (local/dev) |
| `CLARKQ_JWT_RSA_PUBLIC_KEY` | Static RS256 public key PEM or path |

Example with an IdP:

```bash
export CLARKQ_OIDC_ISSUER="https://login.example.com/"
export CLARKQ_OIDC_AUDIENCE="clarkq-api"
./bin/clarkq
```

HS256 for local testing:

```bash
export CLARKQ_JWT_HS_SECRET="dev-only-secret"
export CLARKQ_OIDC_AUDIENCE="clarkq"
# mint a JWT with aud=clarkq, exp in the future, signed with the secret
```

**JWT queue ACL** (`CLARKQ_JWT_ACL=true`):

| Scope / role | Meaning |
|--------------|---------|
| `queue:orders:write` | POST to `orders` |
| `queue:orders:read` | GET consume/peek `orders` |
| `queue:orders:admin` | DELETE clear (+ read/write) |
| `queue:*:read` | read any queue |
| `queue:orders:*` | all actions on `orders` |
| `admin` scope or role (`CLARKQ_JWT_ADMIN_ROLE`) | full access |

API keys bypass ACL (full access). JWT without matching scope gets `403 FORBIDDEN`.

### OpenTelemetry

```bash
export CLARKQ_OTEL_ENDPOINT=localhost:4318   # or http://collector:4318
export CLARKQ_OTEL_SERVICE_NAME=clarkq
./bin/clarkq
```

HTTP spans are exported via OTLP/HTTP when the endpoint is set.

### Multi-node sharding

Each queue is owned by one node (FNV hash of the name). Non-owners reverse-proxy the request.

```bash
# node1
export CLARKQ_CLUSTER_ADVERTISE_URL=http://node1:8080
export CLARKQ_CLUSTER_NODES=http://node1:8080,http://node2:8080
./bin/clarkq

# node2
export CLARKQ_CLUSTER_ADVERTISE_URL=http://node2:8080
export CLARKQ_CLUSTER_NODES=http://node1:8080,http://node2:8080
./bin/clarkq
```

Clients may talk to any node; queue ops are forwarded to the owner.

**Replication** (copies on multiple nodes):

```bash
export CLARKQ_REPLICATION_FACTOR=2
export CLARKQ_CLUSTER_SECRET=shared-cluster-token   # recommended in production
```

Primary enqueues locally, then sync-replicates to the next N−1 nodes on the ring. Failure rolls back the primary write (`503 REPLICATION_FAILED`). Dequeue/clear are best-effort propagated to replicas.

**List queues** aggregates across peers and counts **primary-owned** queues only (avoids double-counting replicas). Use `?local=1` for this node only.

**Failover (v1.1+):** peers are probed on an interval; after `CLARKQ_CLUSTER_FAIL_THRESHOLD` failures a node is marked dead and **removed from the hash ring**. Ownership moves to remaining live nodes automatically (best if `REPLICATION_FACTOR≥2` so the new owner already has copies).

**Durable outbox + catch-up (v1.2):** failed/async replication is written to a JSON outbox on disk and retried after restart. A background catch-up loop pulls/merges missing message IDs across the replica set and has the primary push gaps to recovering replicas.

**Write quorum + epoch fencing (v1.3):** sync writes need `WRITE_QUORUM` successes (default majority of RF) or roll back with `QUORUM_FAILED`. Peers stamp `X-ClarkQ-Epoch` derived from the alive set; mismatched epochs get `409 STALE_EPOCH` (catch-up bypasses). After membership flips, optional `OWNER_GRACE` rejects writes briefly to reduce flapping.

**Linearizable consume (v1.4):** with `CLARKQ_LINEARIZABLE_CONSUME=true` and RF>1, dequeue becomes:

1. Peek head  
2. **Read quorum** — majority of replica set still has that message ID  
3. **CAS pop** — only if head ID unchanged  
4. **Delete quorum** — majority of peers ack removal (else **push front** restore + `503`)

**Leases (v1.5):** `CLARKQ_LEASE_ENABLED=true` — hash owner must collect majority `lease/vote` grants before serving; leases auto-renew. Failures return `503 LEASE_FAILED`.

**Tenants (v1.5):** `CLARKQ_TENANT_QUOTAS=true` + `X-Tenant-ID: acme` — per-tenant queue/message/rate caps; queues bind to first tenant (`403` if another tenant writes).

```bash
curl -H "X-API-Key: $KEY" http://localhost:8080/api/v1/cluster
```

## Configuration

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLARKQ_CONFIG` | _(empty)_ | Path to YAML config file |
| `CLARKQ_ADDR` | `:8080` | Listen address |
| `CLARKQ_MAX_QUEUES` | `1000` | Max number of queues |
| `CLARKQ_MAX_DEPTH` | `10000` | Max messages per queue |
| `CLARKQ_MAX_MESSAGE_BYTES` | `1048576` (1 MiB) | Max message body size |
| `CLARKQ_API_KEY` | _(empty)_ | API key(s); empty disables auth |
| `CLARKQ_ENCRYPTION_MODE` | `none` | Default mode: `none`, `client`, `server_rsa` |
| `CLARKQ_ENCRYPTION_QUEUES` | _(empty)_ | Per-queue overrides: `name:mode,name2:mode2` |
| `CLARKQ_RSA_PUBLIC_KEY` | _(empty)_ | PEM string or path for `server_rsa` |
| `CLARKQ_RSA_KEY_DIR` | `.clarkq-keys` | Auto-generate keypair dir if no public key set |
| `CLARKQ_SNAPSHOT_PATH` | _(empty)_ | Snapshot checkpoint path; empty disables snapshots |
| `CLARKQ_SNAPSHOT_INTERVAL` | `30s` | Compaction interval; `0` = only on shutdown |
| `CLARKQ_WAL_PATH` | _(empty)_ | Append-only WAL path; fsync after each mutation |
| `CLARKQ_TLS_CERT_FILE` | _(empty)_ | Server TLS certificate (PEM) |
| `CLARKQ_TLS_KEY_FILE` | _(empty)_ | Server TLS private key (PEM) |
| `CLARKQ_TLS_CLIENT_CA_FILE` | _(empty)_ | Client CA PEM; when set, **mTLS required** |
| `CLARKQ_OIDC_ISSUER` | _(empty)_ | JWT `iss` + OIDC discovery |
| `CLARKQ_OIDC_AUDIENCE` | _(empty)_ | JWT `aud` |
| `CLARKQ_OIDC_JWKS_URL` | _(empty)_ | JWKS endpoint |
| `CLARKQ_JWT_HS_SECRET` | _(empty)_ | HS256 secret |
| `CLARKQ_JWT_RSA_PUBLIC_KEY` | _(empty)_ | RS256 public key PEM/path |
| `CLARKQ_JWT_ACL` | `false` | Enforce JWT scope/role queue ACL |
| `CLARKQ_JWT_ADMIN_ROLE` | `admin` | Role claim with full access |
| `CLARKQ_OTEL_ENDPOINT` | _(empty)_ | OTLP/HTTP collector (`host:4318` or URL) |
| `CLARKQ_OTEL_SERVICE_NAME` | `clarkq` | Trace service name |
| `CLARKQ_CLUSTER_NODES` | _(empty)_ | Comma-separated peer base URLs |
| `CLARKQ_CLUSTER_ADVERTISE_URL` | _(empty)_ | This node's public base URL |
| `CLARKQ_REPLICATION_FACTOR` | `1` | Copies per message (1 = primary only) |
| `CLARKQ_REPLICATION_MODE` | `sync` | `sync` (rollback on fail) or `async` (bg copy) |
| `CLARKQ_CLUSTER_SECRET` | _(empty)_ | Token for internal peer APIs |
| `CLARKQ_CLUSTER_PROBE_INTERVAL` | `2s` | Peer `/health` probe interval |
| `CLARKQ_CLUSTER_FAIL_THRESHOLD` | `2` | Failures before peer marked dead |
| `CLARKQ_OUTBOX_MAX_ATTEMPTS` | `8` | Async replication retry budget |
| `CLARKQ_OUTBOX_BACKOFF` | `500ms` | Outbox base backoff |
| `CLARKQ_OUTBOX_PATH` | _(auto)_ | Durable outbox file; default `<snapshot>.outbox.json` if snapshot set |
| `CLARKQ_CATCHUP_INTERVAL` | `5s` | Replica catch-up period (`0` uses default) |
| `CLARKQ_WRITE_QUORUM` | `0` (majority) | Min successful copies incl. primary |
| `CLARKQ_READ_QUORUM` | `0` (majority) | Min replicas that must hold a message ID |
| `CLARKQ_LINEARIZABLE_CONSUME` | `false` | Strong dequeue: read quorum + CAS pop + delete quorum |
| `CLARKQ_EPOCH_FENCING` | `true` | Reject internal ops with wrong epoch |
| `CLARKQ_EPOCH_FENCING_STRICT` | `false` | Require epoch header when fencing on |
| `CLARKQ_OWNER_GRACE` | `0` | Block client writes after membership change |
| `CLARKQ_LEASE_ENABLED` | `false` | Require majority lease before owner serves queue |
| `CLARKQ_LEASE_TTL` | `5s` | Lease lifetime (renew ~TTL/3) |
| `CLARKQ_TENANT_QUOTAS` | `false` | Enable multi-tenant limits |
| `CLARKQ_TENANT_HEADER` | `X-Tenant-ID` | Tenant id header |
| `CLARKQ_TENANT_MAX_QUEUES` | `0` | Max queues per tenant (0=unlimited) |
| `CLARKQ_TENANT_MAX_MESSAGES` | `0` | Max total messages per tenant |
| `CLARKQ_TENANT_MAX_ENQUEUE_PER_SEC` | `0` | Max enqueue ops/sec per tenant |

Load order: **defaults → YAML (`CLARKQ_CONFIG`) → environment variables**.

### YAML example

See [`configs/clarkq.example.yaml`](configs/clarkq.example.yaml):

```yaml
addr: ":8080"
api_keys: ["change-me"]
encryption:
  mode: none
  queues:
    secure-orders: server_rsa
snapshot:
  path: "./data/snapshot.json"
  interval: 30s
```

### Durability (WAL + snapshots)

Recommended production combo:

```bash
export CLARKQ_WAL_PATH=./data/clarkq.wal
export CLARKQ_SNAPSHOT_PATH=./data/snapshot.json
export CLARKQ_SNAPSHOT_INTERVAL=30s
```

| Mechanism | Behavior |
|-----------|----------|
| **WAL** | After each enqueue/dequeue/clear, append one NDJSON record and `fsync` |
| **Snapshot** | Periodic (and shutdown) full checkpoint; then WAL is truncated |
| **Startup** | Load snapshot (if any), then replay WAL |

WAL-only (no snapshot) also works: the log grows until you compact offline or add a snapshot path later.

### TLS / mTLS

```bash
export CLARKQ_TLS_CERT_FILE=./certs/server.crt
export CLARKQ_TLS_KEY_FILE=./certs/server.key
# Optional mutual TLS — clients must present a cert signed by this CA:
export CLARKQ_TLS_CLIENT_CA_FILE=./certs/client-ca.crt
./bin/clarkq
```

API keys remain independent application-layer auth when configured.

### Metrics

```bash
# Prometheus text (scrape-friendly, no auth)
curl http://localhost:8080/metrics

# JSON (respects API key when configured)
curl -H "X-API-Key: your-secret-key" http://localhost:8080/api/v1/metrics
```

JSON shape (core fields; cluster counters appear when relevant):

```json
{
  "uptime_seconds": 12.3,
  "queues": 2,
  "messages": 5,
  "enqueued_total": 10,
  "dequeued_total": 5,
  "peeked_total": 0,
  "cleared_total": 0,
  "errors_total": 0,
  "replication_errors_total": 0,
  "quorum_errors_total": 0,
  "lease_errors_total": 0,
  "outbox_depth": 0,
  "cluster_enabled": false,
  "cluster_alive_nodes": 0,
  "queue_depths": {"orders": 3, "jobs": 2},
  "snapshot_enabled": true
}
```

Prometheus also exposes `clarkq_replication_errors_total`, `clarkq_quorum_errors_total`,
`clarkq_lease_errors_total`, membership/outbox gauges (`clarkq_cluster_alive_nodes`, …).

Example scrape config and alert rules: [deploy/prometheus/](deploy/prometheus/).

## Encryption

| Mode | Write | Read | Decrypt key held by |
|------|-------|------|---------------------|
| `none` | plaintext | plaintext | — |
| `server_rsa` | plaintext (server encrypts at rest) | ciphertext + metadata | client private key |
| `client` | ciphertext + metadata | opaque ciphertext | client symmetric key |

Per-queue overrides:

```bash
export CLARKQ_ENCRYPTION_MODE=none
export CLARKQ_ENCRYPTION_QUEUES="secure-orders:server_rsa,tenant-a:client"
./bin/clarkq
```

Full client recipes (including decrypt steps) are in **[docs/USAGE.md](docs/USAGE.md)**.

## Examples & SDKs

```bash
# curl walkthrough
export CLARKQ_URL=http://localhost:8080 CLARKQ_API_KEY=dev-key
bash examples/curl.sh

# Go sample with encryption demos
go run ./examples/client -mode none

# SDK skeletons
go run ./sdk/go/example
python sdk/python/example.py
node sdk/js/example.mjs
```

See **[sdk/README.md](sdk/README.md)** for Go / Python / JS client APIs.

## Development

```bash
make test
make build          # -> bin/clarkq
make run            # build + run on :8080

# or
go test ./...
go build -o bin/clarkq ./cmd/clarkq
```

### Docker / Compose / Helm

```bash
make docker
docker run --rm -p 8080:8080 \
  -e CLARKQ_API_KEY=your-secret-key \
  -e CLARKQ_SNAPSHOT_PATH=/data/snapshot.json \
  -e CLARKQ_WAL_PATH=/data/clarkq.wal \
  -v clarkq-data:/data \
  clarkq:latest

# Compose
cd deploy && docker compose up --build -d

# Helm
helm install clarkq ./deploy/helm/clarkq --set config.apiKey=change-me
```

See **[deploy/README.md](deploy/README.md)**.

Project layout:

```
cmd/clarkq/          # main (TLS, graceful shutdown, durability flush)
internal/
  config/            # env + YAML config
  queue/             # FIFO manager + snapshot import/export
  server/            # HTTP handlers, auth, metrics, TLS
  crypto/            # none / client / server_rsa + per-queue registry
  persist/           # snapshot + WAL engine
configs/             # example YAML
deploy/              # docker-compose + Helm chart
sdk/                 # Go / Python / JS clients + crypto helpers
docs/USAGE.md
examples/
Dockerfile
Makefile
```

## Notes and limits

- **In-memory by default** — without WAL/snapshot paths, restart drops all messages.
- **WAL fsyncs per mutation**; still not multi-node replication.
- **Consume is destructive** by default; use `peek=true` only when you accept multiple readers seeing the same message.
- Prefer edge TLS or enable built-in HTTPS/mTLS.
- Multi-consumer workers competing on the same queue is supported (classic work-queue pattern).

## License

[MIT](LICENSE)
