# ADR 0004: Durable Encrypted Inbox and Outbox

## Status

Accepted

## Context

Network interruptions, handler failures, and MQTT QoS 1 duplicates require durable state
without storing plaintext at rest in the outbox.

## Decision

SQLite (WAL mode) stores encrypted envelopes in outbox before publish and in inbox before
handler execution. Replay dedup uses UNIQUE(sender_id, msg_id). Sequence allocation is
transactional.

## Consequences

- Restart resumes pending outbox and inbox work.
- Plaintext never written to outbox.
- Handler invoked at most once per (sender_id, msg_id) pair.