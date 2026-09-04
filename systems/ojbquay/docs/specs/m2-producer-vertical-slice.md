# M2 Producer Vertical Slice

## Context

M1 publishes validated topic revisions through the compacted configuration bus.
M2 turns those revisions into the first data-plane path without coupling the
gateway to the control-plane REST API or PostgreSQL.

## Goal

An application using the Java SDK can synchronously or asynchronously send a
message through gRPC and receive the Kafka partition and offset after an
`acks=all` acknowledgement.

## Non-goals

- Delayed production and cancellation, delivered in M3.
- Gateway-side cross-request deduplication beyond Kafka producer idempotence.
- Broker selection beyond the single v1 Kafka cluster.
- Production TLS and SASL wiring, completed with deployment hardening in M6.

## Acceptance Criteria

- Given a ready gateway with an enabled topic revision,
  when an SDK sends a message with the topic token,
  then Kafka stores the value, key, tags, headers, and trace context and the SDK
  receives its partition and offset.
- Given an unknown or disabled topic, bad token, exhausted quota, oversized
  value, or invalid partition,
  when a client sends,
  then the response uses the stable application code and no broker send starts.
- Given `x-ojbk-token` metadata and a different body token,
  when the request is handled,
  then metadata authentication takes precedence.
- Given Kafka is unavailable after local validation,
  when the send fails,
  then the RPC remains transport-successful and returns `BROKER_UNAVAILABLE`.
- Given existing valid configuration and a control-plane outage,
  when the gateway is running,
  then it continues from its in-memory Last Known Good snapshot.

## Constraints

- The data plane has no Spring dependency.
- Kafka producer settings include idempotence, `acks=all`, bounded batching,
  zstd compression, and a 4 MiB request ceiling.
- Authentication, quota, and size checks happen locally and do not log tokens
  or payloads.
- RPC deadlines bound SDK calls; queues and caches remain bounded.
- gRPC status represents transport failures only; `ojbk.v1.Code` represents
  business outcomes.

## Assumptions and Unknowns

- M1 creates `__ojbk.config` before a gateway starts.
- v1 routes all topic payloads to the configured local Kafka cluster.
- The exact production quota burst policy requires load evidence; M2 uses one
  second of configured TPS as the maximum burst.

## Design

`ProducerEngine` owns deterministic validation and quota decisions behind a
`BrokerProducer` boundary. `KafkaBrokerProducer` owns Kafka records and
acknowledgements. `ProducerGrpcService` translates the additive Protobuf
contract and honors metadata-token precedence. `GatewayProduceRuntime` starts
metrics, replays configuration to the bootstrap end, then starts gRPC and marks
readiness.

The Java SDK exposes immutable messages plus sync/async sends, deadline
configuration, and typed business exceptions.

## Steps

1. Prove local rejection and acknowledgement mapping in engine unit tests.
2. Implement the idempotent Kafka adapter and gRPC translation.
3. Implement SDK sync/async calls and metadata token propagation.
4. Prove SDK → gRPC → Kafka with a real Kafka 4.2 container.
5. Add runtime entrypoint, metrics, documentation, and deployment wiring.

## Verification

- `./gradlew :modules:gateway-produce:test :sdk:java:test`
- `./gradlew build`
- Testcontainers E2E observes the SDK value and headers in Kafka and the matching
  partition/offset in the SDK acknowledgement.
