# Changelog

## [1.5.1] — 2026-07-29

### Admin UI + reality check
- Embedded **Admin UI** at `GET /ui/` (no build step; single HTML page)
- Browser-side ops: health, list queues, enqueue/peek/consume/clear, metrics, cluster
- API key + tenant header stored in localStorage
- Smoke-tested single-node happy path before release

### Cluster multi-process demo (post-tag docs/tooling)
- **`demo/cluster/`**: 3-process (or Docker) scenarios — membership, shard forward,
  RF=2 replication, kill-one failover, write-path quorum smoke, concurrent load
- Entry: `cd demo/cluster && ./run-cluster-demo.sh`（詳見該目錄 README）
- Optional scenario **07**: linearizable + lease smoke when flags are on

### Client-friendly cluster errors (post-tag)
- Transient cluster errors set **`Retry-After`** and JSON `retryable` / `retry_after_ms`
  (`STALE_EPOCH`, `NOT_OWNER`, `OWNER_GRACE`, `LEASE_FAILED`, quorum/replication, tenant rate)
- Clearer retry guidance in error messages during membership churn

### Advanced cluster stress suite (post-tag)
- **`demo/cluster/run-stress.sh`**: forces linearizable + lease
  - **08 soak**: concurrent producers/consumers for `CLARKQ_STRESS_SECS`
  - **09 partition**: Docker network disconnect or local `SIGSTOP`, traffic on survivors, heal
  - **10 latency**: `tc netem` multi-AZ delay simulation (`CAP_NET_ADMIN`)
- Compose nodes gain optional `NET_ADMIN` + `CLARKQ_LEASE_TTL` / `OWNER_GRACE` env
- `--long` / `make stress-long`: default 300s soak + progress ticks

### Ops metrics (post-tag)
- Prometheus + JSON: `replication_errors_total`, `quorum_errors_total`, `lease_errors_total`,
  `stale_epoch_errors_total`, `not_owner_errors_total`, `owner_grace_errors_total`
- Gauges: `outbox_depth`, `cluster_enabled`, `cluster_alive_nodes`, `cluster_configured_nodes`,
  `cluster_generation`, `leases_held`
- **Example alerts + scrape**: `deploy/prometheus/alerts.yml`, `scrape.example.yml`

## [1.5.0] — 2026-07-29

### Lease-based ownership + multi-tenant quotas
- **Queue leases**: `CLARKQ_LEASE_ENABLED` — hash owner must win majority lease votes (`POST /api/v1/internal/lease/vote`) before serving; background renew at TTL/3
- Higher-term takeover supported; expired leases free for reacquire
- **Tenant quotas**: `CLARKQ_TENANT_QUOTAS` with per-tenant max queues, max messages, enqueue rate; header `X-Tenant-ID` (configurable)
- Queue→tenant binding prevents cross-tenant writes (`403 TENANT_FORBIDDEN`)
- Cluster status includes held leases and tenant flag

## [1.4.0] — 2026-07-29

### Linearizable consume + read quorum
- **`CLARKQ_LINEARIZABLE_CONSUME`**: owner path becomes peek → **read quorum** → CAS pop → **delete quorum** → ack
- **`CLARKQ_READ_QUORUM`**: default majority of RF; required observations of message ID before consume/strong peek
- Failed delete quorum **restores message to queue head** (`PushFront`) and returns `503 QUORUM_FAILED`
- Manager primitives: `PeekFront`, `CompareAndPop`, `PushFront`
- Supports long-poll timeout while waiting for quorum-ready head

## [1.3.0] — 2026-07-29

### Write quorum + epoch fencing
- **Write quorum**: `CLARKQ_WRITE_QUORUM` (default majority of configured RF). Sync enqueue needs this many successful copies (including primary) or rolls back with `503 QUORUM_FAILED`
- **Epoch fencing**: deterministic epoch from sorted alive set (`X-ClarkQ-Epoch`). Mismatched internal ops → `409 STALE_EPOCH`. Catch-up uses `X-ClarkQ-CatchUp: 1` to bypass
- **Owner checks**: client enqueue/dequeue/clear require current owner; optional `CLARKQ_OWNER_GRACE` after membership flips → `503 OWNER_GRACE`
- Replicate enqueue is idempotent on message ID
- `/health` and `/api/v1/cluster` expose `epoch` and `write_quorum`

## [1.2.0] — 2026-07-29

### Durable outbox + replica catch-up
- **Disk-backed outbox**: `CLARKQ_OUTBOX_PATH` (or default `<snapshot>.outbox.json`) survives restarts with atomic rewrite
- **Catch-up worker**: periodic pull/merge of missing message IDs across the replica set; primary pushes gaps to recovering replicas
- Internal APIs: `GET /api/v1/internal/queue/{name}/messages` and `.../ids`
- Manager: `MergeMessages`, `ExportQueue`, `HasMessage`, `MessageIDs`
- Config: `CLARKQ_CATCHUP_INTERVAL` (default 5s)

## [1.1.0] — 2026-07-29

### Cluster v2 foundations
- **Peer health membership**: periodic `/health` probes mark peers dead after consecutive failures
- **Automatic owner rehash**: queue ownership uses only *alive* nodes (dead nodes lose ownership without reconfig)
- **Membership generation** for fencing observability (`X-ClarkQ-Generation`)
- **Replication outbox** with exponential backoff retries (async mode + failed sync paths)
- **`GET /api/v1/cluster`**: peers, alive set, generation, outbox depth/items
- Config: `CLARKQ_CLUSTER_PROBE_INTERVAL`, `CLARKQ_CLUSTER_FAIL_THRESHOLD`, `CLARKQ_OUTBOX_MAX_ATTEMPTS`, `CLARKQ_OUTBOX_BACKOFF`

## [1.0.0] — 2026-07-29

**Initial stable release (初版).**

### Core
- Named in-memory FIFO queues over HTTP (enqueue, consume, peek, long-poll, clear, list)
- Resource limits: max queues / depth / message size
- Graceful shutdown (SIGINT/SIGTERM)

### Auth & security
- API key auth (`X-API-Key` / Bearer)
- JWT / OIDC (JWKS discovery, HS256, static RS256)
- JWT queue ACL (`queue:name:action`, admin role)
- Optional HTTPS + mTLS

### Durability
- Append-only WAL (`CLARKQ_WAL_PATH`) with fsync per mutation
- JSON snapshot checkpoints + compaction

### Cluster
- Consistent-hash queue sharding with reverse-proxy to owner
- Multi-replica replication (`CLARKQ_REPLICATION_FACTOR`)
- Sync (default) or async (`CLARKQ_REPLICATION_MODE`) consistency
- Cross-node `GET /api/v1/queues` (primary-owned depths only)

### Ops
- Prometheus `/metrics` + JSON `/api/v1/metrics`
- OpenTelemetry OTLP/HTTP traces
- YAML config + env overrides
- Docker image, Compose, Helm chart
- `GET /version` and version fields on `/health`

### Clients
- SDK skeletons: Go, Python, JavaScript (+ crypto helpers)

### Not in v1 (see ROADMAP)
- Automatic owner failover
- Strong multi-DC consensus / full message log streaming
