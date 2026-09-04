# Prometheus + clarkQ

clarkQ exposes Prometheus text at **`GET /metrics`** (no auth) and JSON at
`GET /api/v1/metrics` (auth when configured).

## Files

| File | Purpose |
|------|---------|
| [alerts.yml](alerts.yml) | Example recording-free **alert rules** |
| [scrape.example.yml](scrape.example.yml) | Scrape + `rule_files` snippet |

## Quick start (local)

```bash
# 1) Run clarkQ (example)
cd ../..
docker compose -f deploy/docker-compose.yml up -d

# 2) Confirm metrics
curl -s http://127.0.0.1:8080/metrics | head

# 3) Point Prometheus at this repo's alerts:
#    - copy alerts.yml → /etc/prometheus/rules/clarkq-alerts.yml
#    - merge scrape.example.yml into prometheus.yml
#    - reload Prometheus
```

## Recommended alerts (summary)

| Alert | When |
|-------|------|
| `ClarkQTargetDown` | scrape `up == 0` for 1m |
| `ClarkQHighErrorRate` | `rate(errors_total[5m]) > 1` for 5m |
| `ClarkQReplicationErrors` | any replication error rate for 5m |
| `ClarkQQuorumErrors` | any quorum error rate for 5m |
| `ClarkQLeaseErrors` | lease failures for 10m |
| `ClarkQMembershipChurn` | frequent STALE_EPOCH / NOT_OWNER / OWNER_GRACE |
| `ClarkQOutboxBacklog` | `outbox_depth > 100` for 10m |
| `ClarkQQueueDepthHigh` | any queue depth > 5000 for 15m |
| `ClarkQClusterNodeMissing` | alive &lt; configured (cluster mode) for 3m |

Thresholds are **starting points** — tune for your traffic.

## Cluster notes

- Scrape **each** node in a multi-node deployment: outbox depth, leases held, and
  alive-set views are per-process.
- After failover drills (`demo/cluster`), expect short bursts of membership /
  retry metrics; alerts use `for:` windows to avoid flapping.
- Stress suite: `cd demo/cluster && ./run-stress.sh --docker`

## Helm / Operator

No ServiceMonitor is shipped by default (keeps the chart small). For
kube-prometheus-stack, add a ServiceMonitor selecting the clarkQ Service and
mount `alerts.yml` as a PrometheusRule, or import the expressions into Grafana
Alerting.
