# ADR-010 — GROUP payload v1 and consumer-group state machine

- Status: accepted
- Date: 2026-10-06
- Applies to: M6 and later; persistent `KindGroup` WAL entries in `__mkfk_groups/0`

## Decision

Every consumer-group transition is one `KindGroup` WAL entry whose payload is canonical JSON. The command name lives in the `command` field, matching the pinned GROUP vector in `testdata/golden/wal-v1.json`; the `"type"` key in the CSR §11.8 example is superseded. Integers are canonical decimal strings, lists are sorted and duplicate-free, and fields a command does not use are omitted and rejected on decode.

| command | fields besides `command`, `group_id` | effect when applied |
| --- | --- | --- |
| `JOIN` | `request_id`, `member_id`, `subscription` | creates the group (first member fixes the subscription) or adds a member; a new member starts generation g+1 |
| `SYNC_READY` | `member_id`, `generation` | the member revoked its old assignment for this generation; when every member is ready the group moves to ASSIGNING |
| `SET_ASSIGNMENT` | `request_id`, `generation` | computes the deterministic round-robin assignment from state and moves to STABLE |
| `LEAVE` | `request_id`, `member_id`, `generation` | removes the member (no-op if absent) and starts g+1 |
| `REMOVE_MEMBERS` | `request_id`, `member_ids`, `expected_generation` | coordinator-issued session/rebalance timeout; ignored unless `expected_generation` is current |
| `BEGIN_REBALANCE` | `request_id`, `expected_generation`, `generation` | starts g+1 without a membership change; issued by a new coordinator term so old sessions must re-sync |
| `COMMIT_OFFSETS` | `request_id`, `member_id`, `generation`, `offsets[{topic, partition, offset, high_watermark}]` | all-or-nothing update of committed next-offsets |

The state machine (`internal/group`) is a pure function of committed entries:

- Every generation change clears the assignment, so commits from older generations fail with `ILLEGAL_GENERATION` as soon as the entry applies.
- `SET_ASSIGNMENT` carries no assignment. The assignment is recomputed from sorted members and sorted `(topic, partition)` (`members[i % n]`), so replay always reproduces it.
- `COMMIT_OFFSETS` carries the quorum-confirmed high watermark the coordinator obtained before proposing. Apply re-checks generation, STABLE phase, ownership, `existing <= offset <= high_watermark` for every entry, then writes all of them or none. Carrying the proof keeps apply deterministic.
- Sync and heartbeat requests carry no `request_id`; they are idempotent by `(member_id, generation)`. `COMMIT_OFFSETS` keeps each member's last request and result so a retry with the same `request_id` returns the original outcome even after a rebalance. A different payload under the same `request_id` is `REQUEST_CONFLICT`.
- An unknown member gets `ILLEGAL_GENERATION` (it must rejoin). Groups are never deleted and their subscription never changes.

`GET /v1/groups/{group}/offsets` encodes the partitions to read as query parameters, per the endpoint table in `docs/sdd/03-protocol-clients.md` §2. The schema's request body for that GET is not used.

## Consequences

- Rebalance-deadline removal and coordinator failover are durable entries the coordinator proposes itself (`REMOVE_MEMBERS`, `BEGIN_REBALANCE`), never client requests.
- Until brokers talk to each other (M7), the high-watermark proof comes from an injected source in-process. This is a stated limitation, not a weaker rule.
- Heartbeat `last_seen` stays volatile in the coordinator term, as `03-protocol-clients.md` §6.1 allows.

## Rejected alternatives

- Bumping the generation in a separate `BEGIN_REBALANCE` after every `JOIN`/`LEAVE`. The window between the two entries would let old-generation commits succeed against a changed membership.
- Carrying the computed assignment in `SET_ASSIGNMENT`. Recomputing from state removes a whole class of "replicated assignment disagrees with the rule" bugs.
- Validating offsets against the coordinator's local view of a data partition. Local LEO is not a committed high watermark.
