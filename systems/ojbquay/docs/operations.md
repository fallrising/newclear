# Operations Runbook

## Scope

This runbook covers the ojbquay control plane, producer and consumer gateways,
delay scheduler, browser console, and supplied Prometheus/Grafana bundle.
Kafka 4.2 and PostgreSQL 17 are single-node development dependencies in
Compose; production deployments must use replicated, backed-up services.

## Local Stack

Start every service and wait for declared health probes:

```bash
OJBQUAY_ADMIN_PASSWORD='a-local-password' make up
```

The default password is `local-admin-password` only when the environment
variable is omitted. It is intentionally unsuitable outside an isolated local
machine.

| Service | Address |
|---|---|
| Console | <http://localhost:8088> |
| Control-plane API | <http://localhost:8080> |
| Producer gRPC | `localhost:9100` |
| Pull-consumer gRPC | `localhost:9101` |
| Prometheus | <http://localhost:9090> |
| Grafana | <http://localhost:3000> |
| Alertmanager | <http://localhost:9094> |

`make down` stops the stack and retains data volumes. Use
`docker compose -f deploy/compose/docker-compose.yml down --volumes` only when
the local Kafka, PostgreSQL, Prometheus, and Grafana data may be discarded.

`make e2e` uses a separate Compose project, creates its own volumes, verifies
health and login, provisions a topic/group/push subscription, produces through
gRPC, observes the exact HTTP payload and metric, checks Prometheus targets,
and then removes only those E2E resources. Set `KEEP_STACK=1` to retain the
stack after either success or failure.

`make demo` runs that same acceptance path under the dedicated
`ojbquay-demo` project and retains a successful stack for interactive
inspection at ports `28088` (console), `29090` (Prometheus), and `23000`
(Grafana). `make demo-down` removes only that project and its disposable
volumes. The evaluator workflow and scope are in [demo.md](demo.md).

## Deployment

Container builds use `deploy/docker/Dockerfile.java` targets `console-api`,
`gateway-produce`, `gateway-consume`, and `scheduler`, plus
`deploy/docker/Dockerfile.web`. Images run as non-root users and expose
readiness/liveness endpoints.

The Kubernetes base in `deploy/k8s` assumes externally operated Kafka and
PostgreSQL:

1. Replace the example endpoints in `configuration.yaml`.
2. Inject real secrets through the chosen secret manager; do not commit an
   edited Secret.
3. Publish the five images and rewrite their names/tags with a Kustomize
   overlay.
4. Configure TLS at ingress/load-balancer boundaries and Kafka/PostgreSQL
   authentication in an environment-specific overlay.
5. Run `kubectl kustomize deploy/k8s` and server-side dry-run against the target
   cluster before apply.

The producer gateway can scale on CPU. Consumer scaling must be gradual because
it can rebalance classic ordered groups and move Share Group acquisitions.
Acknowledgement tokens require connection affinity to the gateway instance that
issued them in v1. Scheduler replicas are safe because PostgreSQL dispatch uses
`FOR UPDATE SKIP LOCKED`.

### Java baseline and JVM tuning

All Java services compile and run on Eclipse Temurin/OpenJDK 25 LTS. The images
accept standard JVM flags through `JAVA_TOOL_OPTIONS`; no workload-specific
heap or collector choice is hard-coded.

For Compose, set the namespaced input variable before starting the stack:

```bash
OJBQUAY_JAVA_TOOL_OPTIONS='-XX:MaxRAMPercentage=70 -XX:+ExitOnOutOfMemoryError' \
  make up
```

For Kubernetes, replace `java-tool-options` in the `ojbquay-runtime` ConfigMap
through an environment overlay. Align heap settings with pod memory limits,
benchmark GC choices against representative payloads, and validate diagnostic
or JFR output storage before production rollout.

## Health and Metrics

Framework-free runtimes expose `/livez`, `/readyz`, and `/metrics` on their
metrics ports. Spring exposes `/actuator/health/liveness`,
`/actuator/health/readiness`, and `/actuator/prometheus`.

Prometheus also scrapes `/internal/v1/lag-exporter` for classic ordered
consumer lag. Share Group committed offsets are not represented as classic lag.
The supplied Grafana folder contains platform, topic, and subscription
dashboards. `make validate-deploy` validates the Compose model, alert rules,
Kustomize render, and dashboard JSON.

Default alerts cover:

- a runtime scrape outage for one minute;
- classic consumer lag above 10,000 records for five minutes;
- push success below 99% for five minutes while traffic exists;
- delay fire-lag p99 above five seconds;
- active workers without a loaded subscription revision.

The lag threshold is a repository default. Override the rule in a deployment
overlay to match service objectives.

## Incident Actions

### Runtime unavailable

Check the failed runtime's readiness body and logs, then Kafka/PostgreSQL
reachability. A data-plane runtime opens traffic only after config replay.
Restarting it is safe; do not delete `__ojbk.config`.

### Push success below 99%

Use the subscription dashboard to identify result codes and retry/DLQ growth.
Verify endpoint DNS/TLS/latency before replaying DLQ records. Replays are
at-least-once and may duplicate work.

### Consumer lag high

Confirm whether the subscription is classic ordered. Inspect partition skew,
endpoint latency, worker count, and retry behavior. Scale carefully. Offset
reset is a last resort: the control plane pauses and publishes the
subscription, waits up to 60 seconds for an empty group, alters offsets, then
restores the prior state. A failed quiet gate does not alter offsets.

### Delay fire lag high

Inspect `ojbk_delay_pending`, database saturation, scheduler worker failures,
and Kafka producer health. Increasing scheduler replicas is safe. Never delete
pending rows as a recovery shortcut.

## Backup, Recovery, and Upgrade

- Back up PostgreSQL with a transactionally consistent managed snapshot and
  point-in-time logs. It contains desired configuration, audit history, and
  pending delay state.
- Apply the broker's normal replicated backup/retention policy to application
  topics and `__ojbk.config`; losing the compacted config topic prevents new
  runtimes from bootstrapping.
- Restore PostgreSQL and Kafka to a mutually understood point, start the
  control plane, then scheduler and gateways. Verify config revisions and lag
  before opening traffic.
- Additive Protobuf/REST/config fields are backward compatible. Deploy readers
  before writers for a schema-version bump. A runtime deliberately retains
  Last Known Good when it sees an unsupported revision.
- Drain consumer gateways with the 90-second termination grace period. Keep at
  least one producer and consumer instance available through rolling upgrades.

Production readiness still requires environment-specific TLS, OIDC/SSO, secret
management, capacity/load tests, and restore drills.
