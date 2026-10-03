# HTB-P0A-003: SQLite/API/Fake vertical slice

## Goal

Connect the accepted domain kernel and web shell through normalized SQLite, REST commands, resumable
SSE and the deterministic Fake executor for one create → dispatch → candidate → review/evidence →
human completion flow plus negative recovery paths.

## Inputs

- Accepted ADR-001/002/003/005
- `docs/sdd/persistence-and-recovery.md`, `docs/sdd/executor-and-security.md`
- accepted OpenAPI and artifact envelopes
- HTB-P0A-001 and HTB-P0A-002 verified outputs

## Scope

Backend application/ports/adapters, SQL migrations, API/SSE, Fake adapter, web API client, integration
fixtures and tests explicitly named by the worker envelope.

## Acceptance

- Aggregate, idempotency result, audit and outbox intent commit or roll back together.
- Start/ack loss, stale epoch publication, lease expiry, cancellation uncertainty and response loss are
  deterministic and never imply stopped/success/retry.
- Completion creates a subject-bound CompletionRecord atomically; all negative gates remain visible.
- SSE closes the snapshot gap, bounds slow consumers and resets on retention/epoch mismatch.
- Fake has no shell/network/external write capability; authorization precedes sensitive reads.
- Backend/frontend/integration/race/failure-injection gates pass with retained evidence.

## Forbidden

No real executor, provider credential, external mutation, Slack/Lark, merge, deploy or release.
