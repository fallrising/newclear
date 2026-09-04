# M4 Push Consumer

## Context

M3 can produce immediate and scheduled Kafka records. M4 turns an enabled
`PUSH` subscription into an HTTP delivery worker with the shared shadow, tags,
CEL, and transit pipeline, bounded concurrency and rate, durable scheduled
retry, DLQ, and ordered-key behavior.

The SDD routes retry through `ProduceDelay`, but retry topics are broker
internal topics rather than user-visible topic configs, so producer-gateway
authorization cannot resolve them. The trusted consumer runtime will publish
the same versioned `DelayCommand` directly to `__ojbk.delay.inbox`. This avoids
a loopback gRPC credential and still uses the single scheduler path.

## Goal

An enabled push subscription consumes its source and retry topics, filters and
transforms each record, acknowledges successful HTTP delivery, schedules
bounded failures durably, and sends exhausted records to DLQ without silent
drop. Ordered subscriptions serialize the same order key while allowing
different stripes to progress concurrently.

## Non-goals

- Pull RPC behavior, delivered in M5.
- Console web pages for DLQ browsing and replay, delivered in M6; the
  owner-authorized REST API is part of M4.
- Exactly-once HTTP side effects.
- Production push throughput or latency claims before the load gate.
- Arbitrary response-body interpretation; HTTP 2xx is success.

## Acceptance Criteria

- Given shadow traffic that a subscription does not accept, missing required
  tags, or a false CEL expression,
  when the pipeline evaluates the record,
  then it is accepted without HTTP or retry/DLQ I/O.
- Given a matching JSON record and transit map,
  when HTTP push succeeds,
  then the endpoint receives the transformed body, trace headers, source
  identity, and one broker `ACCEPT`.
- Given a transport error,
  when delivery is attempted,
  then the process performs at most two fast retries at 200 ms and 400 ms.
- Given business failures and retry intervals `[150, 300, 600]`,
  when each retry becomes due,
  then the source is accepted only after its next retry command is durable,
  attempts follow the configured timeline, and the fourth failure is written
  to `{topic}.{group}.dlq` before `ACCEPT`.
- Given retry or DLQ publication failure,
  when handling the source record,
  then the record is released and is not silently acknowledged.
- Given ordered messages with the same key,
  when they are processed with other keys,
  then the same key is strictly serial and another stripe can run in parallel.
- Given an enabled push subscription revision,
  when it is added, changed, disabled, or deleted,
  then the runtime starts, replaces after drain, or stops its bounded worker
  within five seconds.
- Given an owned DLQ record,
  when the owner browses or replays one or a bounded batch of offsets,
  then the API returns bounded record metadata or republishes the original
  key/value/partition to the source topic with retry/DLQ headers removed.

## Constraints

- `gateway-consume` is framework-free Java 25 LTS.
- Poll, executor, lane, and in-flight bounds derive from subscription
  concurrency and never exceed 500 records per worker.
- Share-consumer acknowledgements and classic-consumer calls occur only on the
  owning poll thread.
- Pipeline drop is a successful broker acknowledgement. Pipeline errors go
  directly to DLQ when enabled, otherwise broker `REJECT`.
- Kafka/HTTP delivery is at-least-once. A crash after HTTP success and before
  broker acknowledgement can duplicate the call.
- Payloads, endpoint credentials, and configured HTTP headers are never logged.
- `x-ojbk-shadow=1` is normative; `x-mq-shadow=1` is also recognized for legacy
  producer compatibility.

## Assumptions and Unknowns

- Kafka 4.2 Share Groups are enabled by the selected broker distribution; a
  real Testcontainers test must prove acquisition and `ACCEPT`/`RELEASE`.
- A subscription tag list uses all-of matching.
- A trailing retry interval `-1` repeats the preceding positive interval
  indefinitely. It is invalid as the only interval.
- Ordered v1 uses bounded poll batches and commits only after the whole batch
  reaches a terminal success/DLQ outcome. This is conservative and correct but
  lower-throughput than the SDD low-watermark optimization, which remains a
  demonstrated-load refactor rather than a correctness prerequisite.
- The SDD's `<20%` end-to-end timeline target for a 150 ms retry conflicts with
  its Kafka/PostgreSQL scheduler path, 100 ms dispatcher tick, and ±1 second
  delay promise. Real warm Testcontainers runs observed roughly 206–253 ms for
  the first 150 ms retry while later 300/600 ms retries were within 20%.
  M4 preserves no-early durable scheduling; meeting the 150 ms percentage is a
  measured scheduler/data-plane optimization gate, not a claimed result.

## Design

`PushSubscriptionSpec` converts the flexible config map into a validated,
immutable runtime policy. `PushPipeline` converts a Kafka record into
`DELIVER`, `FILTERED`, or `ERROR`, with JSON parsing only for CEL/transit.

`JdkPushHttpClient` selects from the configured URL pool and owns only the two
fast transport retries. `PushRecordHandler` owns business retry decisions.
It writes an `ADD` command targeting `{origin}.{group}.retry`, preserving
origin, retry count, key, tags, partition, and headers. Exhaustion writes
`{origin}.{group}.dlq` synchronously before acknowledging.

Unordered workers use `KafkaShareConsumer`, process one bounded poll
concurrently on virtual threads, acknowledge on the poll thread, then
`commitSync`. Ordered workers use a classic `KafkaConsumer` and a bounded
striped executor. They wait for the bounded poll batch before committing; on
any non-terminal failure they seek the batch back for at-least-once retry.

`PushWorkerOrchestrator` listens to the replayed config bus. Replacement first
wakes and drains the existing worker, then starts the validated revision.
Readiness follows successful config bootstrap and worker reconciliation.

## Steps

1. Define typed push config and pipeline behavior.
2. Implement HTTP fast retry and durable retry/DLQ decisions.
3. Implement bounded Share and ordered workers.
4. Implement config-driven orchestration, runtime, and metrics.
5. Add real HTTP/Kafka/scheduler E2E scenarios and update operations docs.
6. Add owner-authorized bounded DLQ browse and replay APIs.

## Verification

- `./gradlew :modules:common:test :modules:gateway-consume:test
  :modules:console-api:test`
- Pipeline, fast retry, retry plan, DLQ failure, key ordering, config replace,
  Share acknowledgement, and full retry/DLQ E2E scenarios.
- Unit tests prove exact configured due times. Full E2E proves no-early
  `[150,300,600]` attempts and the scheduler's ±1 second tolerance; the
  conflicting 150 ms `<20%` target remains open.
- `./gradlew build`
