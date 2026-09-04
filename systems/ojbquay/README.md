# ojbquay

[![CI](https://github.com/fallrising/ojbquay/actions/workflows/ci.yml/badge.svg)](https://github.com/fallrising/ojbquay/actions/workflows/ci.yml)

`ojbquay` is an independently implemented enterprise messaging platform for
unified producer, consumer, topic, group, subscription, delay, retry, DLQ, and
operations workflows. It uses standard open-source infrastructure without a
broker fork, ZooKeeper-coupled configuration, legacy RPC SDKs, or executable
user pipelines.

The v1 architecture uses:

- Eclipse Temurin/OpenJDK 25 LTS
- Kafka 4.2 in KRaft mode
- PostgreSQL 17
- gRPC and Protobuf
- Spring Boot 4.1 for the control plane only
- framework-free Java data-plane services

The accepted scope and architecture are in [docs/product-spec.md](docs/product-spec.md).
Progress and verification evidence are tracked in
[docs/execution-plan.md](docs/execution-plan.md).

## Prerequisites

- JDK 25
- Docker with Compose v2

The Gradle wrapper downloads the pinned Gradle distribution.

## Build

```bash
./gradlew build
```

## Five-minute Docker demo

Run the real provision-produce-deliver scenario and keep the verified stack
available for inspection:

```bash
make demo
```

Open `http://localhost:28088` and sign in with
`admin` / `local-admin-password` (isolated local demo only). Prometheus is at
`http://localhost:29090` and Grafana is at `http://localhost:23000`. Remove the
disposable demo and its volumes with `make demo-down`.

The exact scenario, expected results, coverage, and limitations are in the
[Docker functional demo guide](docs/demo.md). The
[latest test report](docs/test-reports/docker-functional-demo.md) records a
clean execution and its evidence.

## Local infrastructure

```bash
docker compose -f deploy/compose/docker-compose.yml up -d kafka postgres
docker compose -f deploy/compose/docker-compose.yml ps
```

Kafka is exposed on `localhost:9092`; PostgreSQL is exposed on
`localhost:5432`.

## Full local product

Build and start the API, gateways, scheduler, browser console, Prometheus,
Alertmanager, and Grafana:

```bash
OJBQUAY_ADMIN_PASSWORD='choose-a-local-password' make up
```

Open the console at `http://localhost:8088`. The producer and pull-consumer
gRPC endpoints are `localhost:9100` and `localhost:9101`. Run the real
provision-produce-deliver acceptance flow with `make e2e`, validate deployment
models with `make validate-deploy`, and stop the retained development stack
with `make down`.

The Compose default password is `local-admin-password` when no override is
provided and must never be used outside isolated local development. Production
configuration, scaling, alerts, backup, recovery, and upgrade procedures are
documented in [docs/operations.md](docs/operations.md).

## Control plane

M1 provides the Spring Boot control plane with PostgreSQL migrations, Kafka
topic administration, transactional configuration outbox, local session
authentication, owner-scoped RBAC, audit reads, runtime snapshots, health
probes, and OpenAPI.

Set a bootstrap password only through the environment, then start the API:

```bash
export OJBQUAY_ADMIN_PASSWORD='choose-a-local-password'
./gradlew :modules:console-api:bootRun
```

The default local connections are `localhost:5432` and `localhost:9092`.
Override them with `OJBQUAY_DATABASE_URL`, `OJBQUAY_DATABASE_USER`,
`OJBQUAY_DATABASE_PASSWORD`, and `OJBQUAY_KAFKA_BOOTSTRAP_SERVERS`. No admin is
created when `OJBQUAY_ADMIN_PASSWORD` is empty.

Useful development endpoints:

- OpenAPI: `http://localhost:8080/v3/api-docs`
- Swagger UI: `http://localhost:8080/swagger-ui.html`
- Health: `http://localhost:8080/actuator/health`
- REST API: `http://localhost:8080/api/v1`

Configuration changes are committed with their audit and outbox rows before the
outbox publishes versioned events to the compacted `__ojbk.config` topic.
Data-plane runtimes replay that topic to its end before becoming ready, replace
validated immutable snapshots atomically, and retain Last Known Good when an
unsupported or invalid revision appears.
Deletes are reference-gated and emit Kafka tombstones so replayed snapshots do
not resurrect removed resources.

## Producer gateway and Java SDK

The framework-free producer gateway replays `__ojbk.config` before opening its
gRPC port. It validates topic state, token, one-second TPS burst quota, message
size, and partition locally, then sends with Kafka idempotence and `acks=all`.

Build and start it after the control plane has created the compacted config
topic:

```bash
./gradlew :modules:gateway-produce:installDist
OJBQUAY_KAFKA_BOOTSTRAP_SERVERS=localhost:9092 \
  modules/gateway-produce/build/install/gateway-produce/bin/gateway-produce
```

The default gRPC port is `9100` and the metrics/readiness port is `9200`.
`OJBQUAY_INSTANCE_ID`, `OJBQUAY_GRPC_PORT`, `OJBQUAY_METRICS_PORT`, and
`OJBQUAY_CONFIG_BOOTSTRAP_TIMEOUT_MS` are optional. The packaged runtime enables
the JDK native-access permission required by shaded Netty.

Java SDK example:

```java
try (var producer = OjbkProducer.forTarget(
                "localhost:9100", System.getenv("OJBQUAY_TOPIC_TOKEN"))
        .plaintext()
        .deadline(Duration.ofSeconds(5))
        .build()) {
    var ack = producer.send(OjbkMessage.ofUtf8("orders", "{\"id\":42}"));
}
```

SDK channels use TLS unless `.plaintext()` is explicitly selected for local
development. Business failures are `OjbkException` values carrying the stable
`ojbk.v1.Code`; gRPC status is reserved for transport failures.

Delayed production uses the same authenticated producer and returns a stable
delay ID after Kafka acknowledges the command:

```java
String delayId = producer.schedule(
        OjbkMessage.ofUtf8("orders", "{\"id\":42}"),
        DelaySchedule.once(Instant.now().plusSeconds(60)));
producer.cancelDelay("orders", delayId);
```

Topics must be created with `delayTopic=true`. The gateway accepts first due
times up to 30 days ahead and finite recurrence up to 10,000 occurrences.
`OJBQUAY_DELAY_DIRECT_THRESHOLD_MS` defaults to `0`; a positive value opts into
that much possible early delivery.

## Delay scheduler

The framework-free scheduler consumes `__ojbk.delay.inbox`, commits commands
to PostgreSQL, and uses two `FOR UPDATE SKIP LOCKED` workers by default to send
due records. Start the control plane once first so Flyway and the internal-topic
initializer have created the delay table and inbox:

```bash
./gradlew :modules:scheduler:installDist
modules/scheduler/build/install/scheduler/bin/scheduler
```

The default metrics/readiness port is `9201`. Connections and bounded worker
timings can be configured with
`OJBQUAY_KAFKA_BOOTSTRAP_SERVERS`, `OJBQUAY_DATABASE_URL`,
`OJBQUAY_DATABASE_USER`, `OJBQUAY_DATABASE_PASSWORD`,
`OJBQUAY_SCHEDULER_WORKERS`, `OJBQUAY_SCHEDULER_POLL_MS`,
`OJBQUAY_SCHEDULER_TICK_MS`, and
`OJBQUAY_SCHEDULER_TERMINAL_RETENTION_MS`.

Delay delivery is at-least-once across Kafka and PostgreSQL. A crash after the
target Kafka acknowledgement and before the database commit can produce a
duplicate carrying the same `x-ojbk-delay-id`.

## Consumer gateway

The framework-free consumer gateway replays subscription configuration and
maintains one bounded worker per enabled `PUSH` or `PULL` subscription:

```bash
./gradlew :modules:gateway-consume:installDist
OJBQUAY_KAFKA_BOOTSTRAP_SERVERS=localhost:9092 \
  modules/gateway-consume/build/install/gateway-consume/bin/gateway-consume
```

Its pull gRPC port defaults to `9101` and its metrics/readiness port to `9202`.
Optional settings are `OJBQUAY_INSTANCE_ID`, `OJBQUAY_GRPC_PORT`,
`OJBQUAY_METRICS_PORT`, and
`OJBQUAY_CONFIG_BOOTSTRAP_TIMEOUT_MS`.

Unordered subscriptions use Kafka 4.2 Share Groups with explicit per-record
acknowledgement and `record_limit` acquisition. Failed HTTP delivery publishes
a durable delay command before accepting the source; the scheduler later sends
the record to `{topic}.{group}.retry`. Finite retry exhaustion writes
`{topic}.{group}.dlq` before acceptance. Ordered subscriptions use a classic
consumer and bounded key stripes, retrying inline so a later record with the
same key cannot pass.

Example push spec:

```json
{
  "mode": "PUSH",
  "concurrency": 16,
  "maxTps": 1000,
  "filterCel": "body.amount > 0",
  "tags": ["paid"],
  "transit": {"$.userId": "$.user.id"},
  "ordered": false,
  "shadowTraffic": false,
  "dlqEnabled": true,
  "push": {
    "urls": ["https://service.example/events"],
    "method": "POST",
    "timeoutMs": 5000,
    "retryIntervalsMs": [150, 300, 600],
    "headers": {"x-service": "settlement"}
  }
}
```

Required tags use all-of matching. A trailing retry interval `-1` repeats the
preceding positive interval indefinitely. HTTP 2xx is success; transport
failures receive two process-local retries at 200 ms and 400 ms before the
scheduled retry policy. Delivery is at-least-once, so endpoints should use
source identity headers for idempotency.

An owner or administrator can browse at most 500 recent dead letters with
`GET /api/v1/subscriptions/{id}/dlq?n=50`. Payloads are returned as Base64.
Single and bounded-batch replay use:

```http
POST /api/v1/subscriptions/{id}/dlq/replay
Content-Type: application/json

{"records":[{"partition":0,"offset":42}]}
```

Replay republishes the original key, value, and partition to the source topic,
removes retry/DLQ metadata, and writes an audit record. Repeated replay requests
can intentionally produce duplicates.

Pull subscriptions expose Kafka Share Group delivery count and explicit
per-record acknowledgement through the Java and Go SDKs. `ACK` accepts a
delivery, `NACK` releases it for redelivery, and an undecided delivery is
released when its configured acknowledgement lease expires.

Example pull spec:

```json
{
  "mode": "PULL",
  "concurrency": 64,
  "maxTps": 1000,
  "filterCel": "body.amount > 0",
  "tags": ["paid"],
  "transit": {"$.userId": "$.user.id"},
  "ordered": false,
  "dlqEnabled": true,
  "pull": {
    "maxBatch": 32,
    "ackTimeoutMs": 30000,
    "maxRetry": 3
  }
}
```

Java handler example:

```java
try (var consumer = OjbkConsumer.forTarget(
                "localhost:9101",
                "settlement",
                "orders",
                System.getenv("OJBQUAY_GROUP_TOKEN"))
        .plaintext()
        .build();
     var subscription = consumer.subscribe(delivery -> {
         process(delivery.value(), delivery.deliveryCount());
         return DeliveryResult.ACK;
     })) {
    Thread.currentThread().join();
}
```

Go handler example:

```go
consumer, err := ojbk.NewConsumer(
    "localhost:9101",
    "settlement",
    "orders",
    os.Getenv("OJBQUAY_GROUP_TOKEN"),
    ojbk.WithPlaintext(),
)
if err != nil {
    log.Fatal(err)
}
defer consumer.Close()

err = consumer.Run(context.Background(), func(
    ctx context.Context,
    delivery ojbk.Delivery,
) ojbk.Result {
    process(delivery.Value, delivery.DeliveryCount)
    return ojbk.Ack
})
```

SDK channels use TLS by default; plaintext is an explicit local-development
opt-in. Pull handlers must be idempotent because delivery is at-least-once.
Acknowledgement tokens are single-use and, in v1, must return to the same
consumer-gateway instance that issued them, so multi-instance deployments need
connection affinity.

Run the cross-language acceptance scenario with:

```bash
./e2e/pull_share.sh
```

## Repository layout

```text
proto/                 Protobuf contracts
modules/common         Shared contracts and runtime primitives
modules/console-api    Control plane
modules/gateway-*      Producer and consumer data planes
modules/scheduler      Delay scheduler
sdk/java               Java SDK
console-web            React console (M6)
deploy                 Local and production deployment assets
e2e                    End-to-end acceptance scenarios
docs                   Product spec, ADRs, tasks, and runbooks
```

## License

ojbquay is licensed under the
[Apache License, Version 2.0](LICENSE). Third-party dependencies and images
retain their own license terms.
