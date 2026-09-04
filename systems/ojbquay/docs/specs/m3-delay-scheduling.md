# M3 Delay Scheduling

## Context

M2 can durably acknowledge immediate Kafka sends. M3 adds delayed, recurring,
and cancelable sends without rebuilding a broker timer wheel or introducing a
leader election service.

The normative SDD says a recurring occurrence is marked done and the next row
is inserted, while the v1 schema makes `delay_id` the primary key. This slice
resolves that ambiguity by atomically advancing the same locked row to its next
due time. The delay ID therefore remains the stable cancellation and
idempotency key for the finite series.

## Goal

The producer API can accept an idempotent delay command, the scheduler can fire
it within ±1 second, cancellation can win cleanly against dispatch, and a
finite recurring series can complete without duplicate dispatch by concurrent
workers.

## Non-goals

- Exactly-once delivery across PostgreSQL and Kafka.
- More than 30 days between acceptance and the first due time.
- Infinite recurrence.
- Calendar/cron expressions.
- Kafka Streams state-store scheduling.

## Acceptance Criteria

- Given a delay-enabled topic and valid token,
  when a future delay is produced,
  then an `ADD` command is acknowledged from `__ojbk.delay.inbox`, ingested
  idempotently, and fired to the target topic with `x-ojbk-delay-id`.
- Given the same `ADD` command more than once,
  when the ingestor replays it,
  then PostgreSQL contains one pending series.
- Given PostgreSQL rejects an inbox batch,
  when the ingestor retries,
  then its consumer position is rewound and no later offset can skip the
  failed command.
- Given a pending delay,
  when `CANCEL` commits before the dispatcher locks it,
  then no target record is produced and the row is `CANCELED`.
- Given the dispatcher locks first,
  when cancellation races,
  then the current occurrence may fire once and cancellation applies only if a
  later occurrence remains pending.
- Given a finite series of three occurrences,
  when each send succeeds,
  then three target records are emitted and the row becomes `DONE`.
- Given two dispatchers,
  when both scan the same due rows,
  then `FOR UPDATE SKIP LOCKED` gives each row to one worker per transaction.
- Given a send failure,
  when the transaction rolls back,
  then the row remains pending for retry; a crash after Kafka acknowledgement
  may duplicate the occurrence under the documented at-least-once contract.

## Constraints

- Scheduler workers are framework-free Java 25 LTS processes.
- Inbox polls and due claims are at most 500 records.
- Dispatcher tick defaults to 100 ms.
- Delay IDs and payloads are never written to default payload logs; the ID may
  appear in structured operational metadata.
- Default direct threshold is zero: only already-due commands bypass
  PostgreSQL. Operators may configure a positive threshold and thereby accept
  an equally bounded early-send tolerance.
- A first due time is at most 30 days in the future; recurrence is finite and
  bounded at 10,000 occurrences, with each interval at most 30 days.
- Internal gRPC and Kafka envelopes reserve bounded overhead so the public
  4 MiB value limit remains usable after Protobuf framing or JSON base64
  expansion.

## Assumptions and Unknowns

- PostgreSQL and Kafka remain independent transaction domains, so delivery is
  at-least-once.
- A successful schedule or cancel response means Kafka acknowledged the
  command, not that the scheduler has applied it yet.
- Reusing a delay ID is first-write-wins. The inbox path cannot synchronously
  distinguish a byte-identical retry from conflicting content.
- Production capacity targets require the final load gate; M3 functional tests
  do not establish 3,000 schedules per second or 50 million pending rows.

## Design

The gateway validates the same topic state, token, quota, size, and partition
rules as immediate production. Already-due commands send directly. Future
commands publish a versioned JSON `DelayCommand` keyed by delay ID.

`KafkaDelayIngestor` polls with group `ojbk.scheduler.ingest`, applies at most
500 commands in one PostgreSQL transaction, then commits Kafka offsets
synchronously. Replays are safe because `ADD` uses `ON CONFLICT DO NOTHING` and
`CANCEL` only changes `PENDING`. Decode, database, or offset-commit failure
rewinds every partition in the poll to its first fetched offset before retry.
Tags, user headers, and the optional target partition are encoded inside the
existing `headers` JSONB field, so the committed v1 schema needs no migration.

`DelayDispatcher` opens a database transaction, locks due rows with
`FOR UPDATE SKIP LOCKED`, and sends them while the locks are held. A successful
one-shot becomes `DONE`; a recurring row advances `due_at` and decrements its
remaining count in the same transaction. Failure rolls back the batch.
Terminal rows older than 24 hours are deleted by a separate bounded cleanup.
The runtime starts two dispatcher workers by default, exposes liveness,
readiness, pending count, fire-result, and fire-lag metrics, and refuses
readiness until the delay table and inbox topic are available.

## Steps

1. Define and test delay IDs, command validation, and codec.
2. Extend producer gRPC and Java SDK schedule/cancel behavior.
3. Implement idempotent inbox ingestion and offset commit.
4. Implement locked dispatch, expiry, recurrence, and cleanup.
5. Add scheduler runtime, metrics, and real Kafka/PostgreSQL E2E tests.

## Verification

- `./gradlew :modules:gateway-produce:test :modules:scheduler:test :sdk:java:test`
- Accuracy, duplicate ADD, cancellation, recurrence, rollback, and two-worker
  integration scenarios.
- Java SDK → Netty gRPC → delay inbox → PostgreSQL → target Kafka E2E.
- `./gradlew build`
