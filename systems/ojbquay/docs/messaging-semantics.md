# Messaging Semantics

## Send

A successful synchronous send means the producer gateway received a successful
Kafka acknowledgement. It does not mean a consumer processed the message.
Gateway retries are bounded by the client deadline and only cover classified
transient broker failures.

## Delivery

All delivery is at-least-once. Duplicate delivery can occur after client
timeouts, gateway failure after broker acknowledgement, lost consumer
acknowledgements, runtime restart before commit, retry, and replay.

Messages carry a stable key and trace context when supplied. Consumers must use
a natural idempotency key or inbox/deduplication store for side effects.

## Ordering

Ordering applies only to the same topic and ordering key. Normal push and pull
subscriptions prioritize throughput. Ordered push subscriptions use a classic
consumer group and serialize each key lane; failures block that lane until
success or an explicit DLQ policy releases it.

## Retry and DLQ

Push delivery performs at most two in-process transport retries before the
configured scheduled retries. A successful retry handoff acknowledges the
original record. Exhaustion writes DLQ before acknowledging. Silent drop is
forbidden.

Unordered push uses explicit Kafka Share Group acknowledgement. A filtered
record and successful HTTP 2xx are `ACCEPT`; failed durable retry/DLQ handoff
is `RELEASE`; finite exhaustion without DLQ is `REJECT`. Retry commands retain
the original topic, partition, offset, key, tags, trace context, and payload.
The control plane initializes new Share groups from the earliest retained
offset.

Ordered push retries inline on a bounded key stripe. The v1 commit rule is a
conservative bounded poll-batch barrier: the batch commits only when every
record reaches HTTP success, filter success, or durable DLQ. Any unresolved
record seeks the batch back, which preserves delivery but can duplicate
already completed calls.

DLQ browse is bounded to 500 tail records. Replay addresses exact
partition/offset pairs, republishes the original key/value/partition to the
source topic, removes retry, DLQ-reason, and delay-id headers, and records an
audit event. Replay is an explicit at-least-once action and is not deduplicated.

Pull delivery uses Kafka Share Group acknowledgement:

- `ACK` accepts the record.
- `NACK` releases the record.
- lease/lock expiration makes it available again.
- delivery count is visible to the client.

Pull batches and active deliveries are bounded by the subscription concurrency.
Acknowledgement tokens are opaque, unique to one delivery attempt, and
single-use. Poll and acknowledgement calls must use the same consumer-gateway
instance in v1; deployments therefore need connection affinity. A lost
acknowledgement can cause redelivery, so handlers remain idempotent.

## Delay

Delay commands are idempotent by delay ID. A message is either pending, done,
canceled, or expired. Kafka acknowledgement of a schedule or cancellation
means the command is durable; application to PostgreSQL is asynchronous.
Cancellation only changes a pending row.

Finite recurrence advances the same locked row after the current send
succeeds, preserving one stable delay ID for the series. A dispatcher that
locks first may emit the current occurrence; cancellation then stops any
remaining occurrences. PostgreSQL and Kafka are separate transaction domains,
so a crash after Kafka acknowledgement but before database commit can emit a
duplicate. Consumers must deduplicate side effects.

The default direct threshold is zero. Already-due one-shot requests bypass
PostgreSQL but still carry `x-ojbk-delay-id`. Configuring a positive threshold
explicitly accepts the same amount of possible early delivery.

## Offset Reset

The broker offset is the source of truth. Reset requires the subscription to be
paused, all runtimes to confirm fetch has stopped, inflight work to drain or be
explicitly abandoned, the target to be previewed, authorization, execution,
verification, and an audited resume. The pause confirmation is a hard gate.
