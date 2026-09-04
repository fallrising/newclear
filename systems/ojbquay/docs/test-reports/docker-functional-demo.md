# Docker Functional Demo Test Report

## Result

**PASS** — the Docker demo satisfied every acceptance criterion in
[the demo specification](../specs/docker-functional-demo.md).

| Field | Value |
|---|---|
| Executed at | 2026-07-30 04:24 UTC |
| Tested source commit | `cd80c5c8b9b0cd86b4a8d4f190917648446b16b6` |
| Host architecture | `amd64` |
| Docker client/server | `27.5.1` / `27.5.1` |
| Docker Compose | `2.32.4` |
| Demo project | `ojbquay-demo` |
| Project state before run | No containers or volumes |
| Image/build cache | Warm |
| End-to-end duration | Not separately timed |

This report records a local functional qualification, not a production
certification or capacity benchmark.

The repository history was later rewritten for namespace hygiene. The tested
commit's rewritten equivalent above retains the same tree object
`c07fef1b4d5384972b79986539facde046ee00e7`.

## Scenario

```gherkin
Scenario: Provision, produce, deliver, and inspect a message
  Given a clean dedicated Docker Compose project
  When the evaluator runs "make demo"
  Then eleven product and observability services are running
  And the administrator authenticates through session and CSRF protection
  And a topic, consumer group, and PUSH subscription are provisioned
  And the authenticated gRPC producer acknowledges a message
  And the HTTP sink receives the exact expected payload
  And delivery and monitoring metrics are healthy
  And the browser console shows the created topic
```

## Functional Evidence

| Check | Evidence | Result |
|---|---|---|
| Compose topology | 11 running services | PASS |
| Public probes | 7/7 readiness or health endpoints responded | PASS |
| Authentication | Session login with a valid CSRF token returned `OK` | PASS |
| Self-service resources | Unique topic, group, and PUSH subscription created | PASS |
| gRPC production | ACK returned `partition=0`, `offset=0` | PASS |
| HTTP delivery | Sink delivery count was `1` | PASS |
| Payload integrity | SHA-256 `3e2a7e74cd6e5f747b745033b9ac3bc6fdf6bc7f98ef87f539ee872c8826b05c` | PASS |
| Consumer metric | PUSH success counter was `1` | PASS |
| Namespace gate | No legacy token in current repository contents or paths | PASS |
| Prometheus | `console-api`, `gateway-produce`, `gateway-consume`, `scheduler`, and `lag-exporter` were `up` | PASS |
| Browser workflow | Containerized Chromium logged in and found the generated topic | PASS |
| Cleanup isolation | `make demo-down` left zero `ojbquay-demo` containers | PASS |

The generated resources were:

- topic `e2e.orders.1785385377-893053`;
- group `e2e-fulfilment-1785385377-893053`;
- subscription ID `1`.

No topic token, session cookie, CSRF token, credential value, complete API
response, environment dump, or raw container log is included in this report.

## Service Evidence

| Service | Verification |
|---|---|
| Kafka | Compose health check passed |
| PostgreSQL | Compose health check passed |
| Console API | readiness endpoint passed |
| Producer gateway | readiness endpoint passed |
| Consumer gateway | readiness endpoint passed |
| Scheduler | readiness endpoint passed |
| Console web | health endpoint returned `UP` |
| Prometheus | readiness endpoint returned ready |
| Alertmanager | Compose service remained running |
| Grafana | API reported database `ok` |
| HTTP push sink | health endpoint passed and delivery was observed |

## Commands

```bash
make generate-proto
./deploy/validate-brand.sh
docker run --rm --network host \
  --user "$(id -u):$(id -g)" \
  --group-add "$(stat -c %g /var/run/docker.sock)" \
  -e TESTCONTAINERS_HOST_OVERRIDE=127.0.0.1 \
  -e GRADLE_USER_HOME=/tmp/gradle-home \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$PWD:/workspace" \
  -w /workspace \
  gradle:9.6.1-jdk25 \
  ./gradlew build --no-daemon --no-parallel --no-configuration-cache
docker run --rm -v "$PWD:/workspace" -w /workspace/sdk/go \
  golang:1.25.1 sh -c 'go test ./... && go vet ./...'
pnpm test
pnpm build
make validate-deploy
./e2e/pull_share.sh
make e2e
make demo
make demo-down
```

The web commands ran through the pinned Node 24/pnpm 11.18.0 containerized
environment because the host does not provide Node. The live browser check used
the official
`mcr.microsoft.com/playwright:v1.62.0-noble` image against the retained
`http://127.0.0.1:28088` stack. It signed in, reached `System overview`, opened
Topics, and found the generated topic.

The first retained-demo attempt reached successful message delivery but checked
Prometheus before its first scrape had completed. The demo gate was changed
from a single read to a bounded 60-second wait. A fresh rerun then passed all
checks and remained inspectable until the explicit cleanup command.

## Java 25 LTS Requalification

The retained demo was rebuilt and rerun on 2026-07-30 after aligning the
compiler and runtime baseline to Java 25 LTS.

| Check | Evidence | Result |
|---|---|---|
| Clean Java build | 51 Gradle tasks executed on JDK 25 | PASS |
| Compose topology | 11 running services | PASS |
| Public probes | 7/7 readiness or health endpoints responded | PASS |
| Functional path | Provision → gRPC produce → exact HTTP PUSH | PASS |
| Monitoring | Consumer success metric and 5 Prometheus jobs healthy | PASS |
| Runtime vendor/version | Eclipse Adoptium `25.0.3` in all 4 Java services | PASS |
| JVM tuning input | `-XX:+PrintCommandLineFlags` observed in all 4 Java services | PASS |
| Bytecode baseline | Java class-file version `69.0` | PASS |

The successful stack remains under the `ojbquay-demo` Compose project for
interactive inspection until `make demo-down` is run.

## Additional Automated Coverage

The repository's focused and CI tests cover behavior intentionally kept out of
the short interactive demo:

- delayed production, cancellation, recurrence, and scheduler concurrency;
- retry timelines, DLQ creation and replay;
- Java and Go PULL acknowledgement, NACK/redelivery, leases, and reconnect;
- owner isolation, administrative RBAC, audit, and offset-reset guardrails;
- Last Known Good configuration and config-bus replay;
- mocked deterministic browser resource creation.

See the [execution plan](../execution-plan.md) for the full repository evidence.

## Limits and Follow-ups

This run did not establish:

- production throughput or the 50k produce/s, 3k schedule/s, and 50 million
  pending-delay targets;
- multi-node rebalance, broker failure, or chaos behavior;
- environment-specific TLS, OIDC/SSO, or secret-manager integration;
- backup restoration;
- the open 150 ms retry percentage target.

The demo uses a single-node, plaintext local stack and a fixed local-only
administrator password. It must not be exposed to an untrusted network.
