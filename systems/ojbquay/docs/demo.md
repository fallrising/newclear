# Docker Functional Demo

This demo is the shortest evidence-backed way to evaluate ojbquay. It builds
the real runtime images, verifies a complete PUSH messaging journey, and leaves
the successful stack running so the created resources and telemetry can be
inspected.

## Prerequisites

- Docker Engine with Compose v2
- GNU Make
- `curl`
- Enough local capacity for 11 containers

The first run downloads pinned images and builds five ojbquay images, so it is
slower than a warm rerun.

## Run

From the repository root:

```bash
make demo
```

The automated scenario:

1. starts Kafka, PostgreSQL, the control plane, producer gateway, consumer
   gateway, scheduler, console, Prometheus, Alertmanager, Grafana, and an HTTP
   push sink;
2. verifies seven public health/readiness endpoints;
3. authenticates the local administrator through session and CSRF protection;
4. creates a uniquely named topic, consumer group, and PUSH subscription;
5. sends a JSON message through the authenticated gRPC producer;
6. verifies the gRPC acknowledgement has a partition and offset;
7. verifies the push sink received the exact JSON payload;
8. verifies the consumer success metric and five healthy Prometheus jobs.

A successful run ends with:

```text
COMPOSE_E2E_OK topic=... group=... subscription=... partition=... offset=...
DEMO_READY
```

## Inspect

| View | Address | What to inspect |
|---|---|---|
| Console | <http://localhost:28088> | The generated topic, group, subscription, audit records, and dashboard |
| Prometheus | <http://localhost:29090> | Runtime targets and `ojbk_*` metrics |
| Grafana | <http://localhost:23000> | Platform, topic, and subscription dashboards |
| Push sink | <http://localhost:28081/count> | Number of HTTP deliveries observed by the demo sink |

The console login is `admin` / `local-admin-password`. This fixed account is
only for the isolated local demo and must never be exposed or reused in another
environment.

Rerunning `make demo` reuses the dedicated Docker project but creates
uniquely named product resources. It does not modify the normal `make up`
development project.

## Stop and Reset

After inspection, remove only the disposable demo project and its volumes:

```bash
make demo-down
```

This deletes the demo's Kafka, PostgreSQL, Prometheus, and Grafana data. It does
not remove the normal local development stack or its volumes.

## Coverage

| Requirement | Demo evidence |
|---|---|
| Deployable local product | 11 Compose services running |
| Control-plane security | CSRF bootstrap and authenticated session |
| Self-service configuration | Topic, group, and PUSH subscription created |
| Authenticated production | gRPC acknowledgement with partition and offset |
| End-to-end delivery | Exact JSON body observed by the HTTP sink |
| Runtime observability | Non-zero PUSH success metric |
| Monitoring wiring | Five expected Prometheus jobs healthy |

Focused repository tests additionally cover delay, retry/DLQ, offset reset,
RBAC boundaries, Last Known Good configuration, Java/Go PULL interoperability,
and browser workflows. This short demo does not certify production capacity,
multi-node resilience, TLS/OIDC integration, backup restoration, or every
failure path. See the
[latest functional test report](test-reports/docker-functional-demo.md) for
recorded Demo evidence and the
[execution plan](execution-plan.md) for repository-wide verification.
