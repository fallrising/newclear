# M2 source freshness runtime contract

This refines `SourceFreshness` / `SourcePage` in OpenAPI and SDD 05 before
implementation. The API returns exactly those fields; credentials, token
references, hashes, generations and transition counters remain private.

- A source is the configured **name authenticated by its bearer credential**.
  Event URI prefixes may overlap; they are authorization scopes, not attribution.
- A committed new event or identical authorized duplicate updates that name's
  `last_received_at` and `last_event_time` atomically. The latter is the event
  timestamp of that latest delivery (including replay), not a maximum timestamp.
  Invalid, forbidden, conflicting, or rolled-back requests never refresh it.
  Event raw bytes, canonical identity and original receipt timestamp never change.
- Before its first attributed delivery the state is `never`, with both times null.
  Missing interval disables age checks: seen sources are `fresh`. Otherwise
  `late` means age strictly greater than the interval and `silent` means strictly
  greater than twice the interval. Exact boundaries remain in the earlier state.
  Clock reversal clamps age to zero and does not regress the recorded receipt;
  a successful delivery still updates its event time and can recover silent.
  Positive integer s/m/h/d intervals use arbitrary-precision arithmetic, including
  their doubled threshold; very large valid intervals cannot overflow.
- `sources_state` and internal transition events commit in the same transaction.
  The evaluator runs once before listening, then every second; source reads also
  evaluate, so a successful read reflects its request time. It emits one
  `signalhub.source.silent` upon entering silent and one
  `signalhub.source.recovered` when a committed delivery leaves persisted silent.
  An ingest arriving after a stalled evaluator refreshes a non-silent source
  directly; no artificial silent/recovered pair is manufactured for an outage
  that was never observed. A backwards clock does not recover a persisted silent
  source; recovery requires a delivery or a deliberate interval change.
- Internal events have source `urn:signalhub:sources:<name>`, subject `<name>`,
  type above, severity warning / info, and ID `source:<generation>:<transition>`.
  Generation increases on attribution scope reset, skipping generations already
  used by any historical event at that internal source URI (including M1 events).
  Transition increases for
  each emitted event. Rows survive removal, so remove/re-add cannot reuse IDs.
  Internal insertion is process-only. Public ingest rejects `signalhub.*` types
  and the reserved `urn:signalhub:sources:` URI namespace, even if its credential
  has a broader URI prefix. This prevents producers occupying transition IDs
  with a non-internal event type (HTTP 403 `forbidden`).
- Startup reconciles configuration transactionally. Name, URI prefix, sorted
  allowed types and token reference define attribution scope. Scope changes or
  reactivation after removal reset to never and increment generation. Interval
  changes retain attributed receipt times and recompute status; leaving silent
  because checks were relaxed emits recovered. Retention changes have no effect.
  Removing a source hides it and stops evaluation, without inventing recovery.
- **M1 upgrade:** M1 stored event URI but not authenticated configured name.
  Historical events cannot establish reliable attribution, even if the current
  prefixes appear unique. Migration preserves all events but initializes sources
  as never until their first authorized M2 delivery (a duplicate suffices).
- Source pages sort name ascending; default limit 100, maximum 200. The opaque
  cursor binds its last name to a fingerprint of the complete active source
  configuration; changing that configuration invalidates existing cursors.
  Freshness times/status may change between pages; this is a live view, not an
  event-log snapshot. Empty lists return `items: []`, `next_cursor: null`.

The process must successfully configure and evaluate before accepting requests.
A tick failure is reported without sensitive details and retried on the next tick;
failed transactions publish neither new state nor an internal transition event.
The worker stops and joins before database close. No delivery or deployment is
included in M2.
