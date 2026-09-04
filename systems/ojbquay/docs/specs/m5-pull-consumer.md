# M5 Pull Consumer and SDKs

## Context

M4 runs push subscriptions on Kafka 4.2 Share Groups. M5 exposes the same
broker-native queue semantics to pull clients through the versioned gRPC
consumer contract and adds Java and Go SDK loops.

Kafka explicit acknowledgement requires every record returned by the previous
poll to be acknowledged before the next poll. A pull worker therefore owns all
consumer calls on one poll thread, renews still-active acquisitions, and
applies client decisions before the next fetch. The configured acknowledgement
timeout remains the delivery lease: an undecided record is released when that
lease expires, and a crashed gateway relies on the broker lock expiry.

`Poll` streams `MessageOut`, while the platform contract also requires business
errors to use `Code`. M5 resolves that pre-release contract gap additively by
adding `code` and `msg` fields to `MessageOut`; successful messages retain the
default `OK` value.

## Goal

An authenticated pull client can long-poll a bounded batch, observe broker
delivery count, acknowledge or release individual deliveries, reconnect
without skipping records, and use the same behavior through Java or Go SDKs.

## Non-goals

- The documented `pullEngine=CLASSIC` fallback; M5 implements `SHARE` only.
- Ordered pull subscriptions.
- Exactly-once business processing.
- Cross-instance acknowledgement routing. A poll and its acknowledgement must
  use the same gateway connection/affinity because Kafka acquisitions belong
  to one Share consumer.
- SDK-side persistence of handler results across process crashes.

## Acceptance Criteria

- Given an enabled `PULL` subscription and valid group token,
  when a client polls,
  then it receives at most its requested and configured batch bounds with a
  unique acknowledgement token and Kafka delivery count.
- Given a successful acknowledgement,
  when the worker commits `ACCEPT`,
  then the record is not reacquired after client or gateway restart.
- Given a negative acknowledgement,
  when the worker commits `RELEASE`,
  then Kafka redelivers the record and increments delivery count.
- Given a client disconnect or an undecided delivery,
  when its configured lease expires,
  then the record becomes eligible for broker redelivery without being
  skipped.
- Given a shadow/tag/CEL/transit policy,
  when a record is acquired,
  then filtered records are accepted internally and matching records expose
  the transformed value.
- Given invalid authentication, request bounds, duplicate tokens, or a stale
  token,
  when `Poll` or `Ack` handles the request,
  then it returns a stable business code and does not acknowledge another
  delivery.
- Given bounded worker capacity,
  when clients stop polling or acknowledging,
  then buffered plus in-flight records never exceed the configured limit and
  `ojbk_pull_inflight{sub}` reports it.
- Given Java and Go handlers,
  when they return ACK/NACK,
  then each SDK batches the corresponding tokens, propagates delivery count,
  and retries transport reconnects with bounded exponential backoff.
- Given Java production with Go consumption and Go production with Java
  consumption,
  when exercised against the real gateway and Kafka 4.2,
  then key, value, tags, headers, acknowledgement, redelivery, and delivery
  count interoperate.

## Constraints

- `gateway-consume` remains framework-free Java 25 LTS.
- Kafka consumer and acknowledgement calls occur only on the owning worker
  thread.
- Per-subscription memory is bounded to at most 500 active deliveries.
- `maxBatch` is 1..500, `lingerMs` is 0..30,000, and `ackTimeoutMs` is
  1,000..300,000.
- Ack tokens are opaque, unpredictable, unique to a delivery attempt, and
  accepted once only by their owning subscription worker.
- Broker or DLQ acknowledgement failure never becomes a successful client
  acknowledgement.
- SDK channels use TLS unless plaintext is explicitly selected for local
  development.

## Assumptions and Unknowns

- Kafka 4.2 returns a renewed acquisition on the next poll with the same
  topic/partition/offset. A real integration test will verify this along with
  delivery-count increment after `RELEASE`.
- Share Group record-lock duration is group-scoped. The control plane rejects
  conflicting pull acknowledgement timeouts within one group.
- Version 1 requires gateway connection affinity for `Poll` followed by `Ack`.
  A future bidirectional RPC or token-routing layer can remove this deployment
  constraint without changing handler semantics.
- Delivery is at-least-once. An SDK handler can complete before its Ack reaches
  Kafka, so handlers must be idempotent.

## Design

`PullSubscriptionSpec` validates shared filtering policy, batch, timeout, retry,
and bounded capacity. `PullShareWorker` owns a `KafkaShareConsumer`, a bounded
delivery deque, an active-token table, and an acknowledgement command queue.
Before each poll it maps decisions to `ACCEPT`/`RELEASE`, releases expired
leases, renews other active acquisitions, and synchronously commits. The next
poll refreshes renewed records and only enqueues genuinely new acquisitions.

`PullWorkerRegistry` reconciles enabled pull revisions and resolves workers by
group/topic. `ConsumerGrpcService` authenticates against `GroupConfig`, applies
request bounds, streams one long-poll batch, and forwards bounded Ack batches
to the owning worker. The consumer runtime starts this service on port 9101
after config bootstrap and reconciliation.

The Java and Go SDKs expose immutable delivery values, ACK/NACK handler
outcomes, blocking run loops, cancellable background subscriptions, metadata
authentication, and plaintext opt-in builders. Go generated Protobuf sources
are produced from the repository contract and are not edited manually.

## Steps

1. Add typed pull configuration and the additive poll error envelope.
2. Implement and real-Kafka-test the bounded Share worker state machine.
3. Add registry, authentication, gRPC service, runtime wiring, and metrics.
4. Add Java consumer SDK behavior and reconnect tests.
5. Generate Go contracts and add Go producer/consumer SDK behavior.
6. Run Java/Go and real gateway/Kafka interoperability acceptance tests.
7. Update operations, API, and deployment documentation.

## Verification

- `./gradlew :modules:common:test :modules:gateway-consume:test :sdk:java:test`
- `docker run ... golang:1.25.1 go test ./...`
- Real Kafka 4.2 ack, nack/redelivery count, expiry, reconnect, and
  restart-without-skip scenarios.
- Java-produce/Go-consume and Go-produce/Java-consume interoperability.
- `./gradlew build`
