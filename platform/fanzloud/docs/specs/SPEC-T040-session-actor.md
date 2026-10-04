---
id: SPEC-T040
title: Session actor design coordination and blocked prerequisites
status: draft
contract_units: [CU-SES-02, CU-SES-03, CU-PROTO-04, CU-SES-04, CU-SES-05, CU-SES-06, CU-SES-07, CU-SES-08]
module: codebox-session-runtime
milestone: P1
atomicity: not-applicable-coordination
invariants: [INV-003, INV-004, INV-006, INV-010, INV-012]
depends_on: [SPEC-T010, SPEC-T020, SPEC-T030A, SPEC-T030B, SPEC-T030C, SPEC-T030D]
td_sections: [4.2-4.8, 8-11, 14-16.3]
adr_refs: [ADR-0005, ADR-0006, ADR-0007]
risk: high
---

# Intent and Status

Coordinate small independently accepted prerequisites for TD §4.7/16.3. This is a blocked design
roadmap, not one implementable mixed-atomicity CU. Only [SPEC-T040A](SPEC-T040A-command-decision.md)
has a complete, independently accepted design contract and finite future machine oracles. [ADR-0007](../adr/ADR-0007-session-actor-contract.md)
is draft; all later production units require their own complete specifications before Ready.

# Source-Backed Current Versus Proposed Boundaries

| Current source / accepted contract | Proposed owner and missing guarantee |
|---|---|
| domain `id.rs`: CommandId exists; no ActorRef/envelope/command | A: typed pure command intent and exact identity |
| domain `event.rs`/`reducer.rs`: schema1, cancel legal only Running | B: versioned WaitingApproval withdrawal, preserve exact v1 behavior |
| event-store `sqlite.rs`: application0x43425831, exact schema2; append has no token/receipt | C/D/F: managed identity, lease authorization and atomic receipt+events |
| Existing append/save and replay/load check identity on fresh operation connections | C: all old mutation handles must reject managed identity, including post-upgrade calls |
| ADR0005: snapshots are verified disposable96-byte caches | E: immutable durable command records; corruption must error, never miss |
| session-runtime `lib.rs`/`runtime.rs`: only provider-specific process-lifetime P0 | G/H: separate pinned startup observation and durable P1 mailbox/dispatch |
| TD §4.8/T110 and §5.1/T180: P1 ledger/backend remain unimplemented | I: effect-specific authorization, fencing, completion and reconciliation contracts |

# Proposed Semantics and Deliberate Gaps

**P01 — Request/receipt identity direction.** Scope receipts by `(session_id, command_id)`;
compare complete A02 canonical envelope bytes, including expected_version/actor/issued_at/payload.
Receipt replay uses exact same persisted outcome after head advance, restart or new owner,
before new-command checks. Different bytes conflict without overwrite. A durable domain rejection
is a successfully committed E1 outcome; it remains stable on same-key replay. Session-not-found,
wrong routing, malformed ingress, lease/storage failures and initial archived-session rejection
create no receipt. Equal-key observation is E0; None proves only absence in that pinned view.
Serialize/quiesce an earlier worker or arbitrate a same-key transaction before deciding it did
not commit. Receipt replay must never launch/relaunch an effect. Trace: TD §§4.4/8.6/16.3;
ADR0007 proposal. Exact codec/retention/capacity/precedence belongs to E/F and is not Ready.

**P02 — Ownership and memory direction.** Lease acquire/renew/release is a separate E1 mutation.
Owner UUID distinguishes process incarnations; monotonic fencing token rejects stale owners.
Every event, receipt, cache/schema or system-transition write in managed mode requires its
applicable fenced boundary; old unfenced handles cannot bypass this through the new identity.
Receipt observation alone needs no live lease. Commit precedes authoritative in-memory state,
response and publication. Lost COMMIT acknowledgement cannot promise no mutation; stop the
actor's new writes until serialized receipt/history reconciliation. Trace: TD §§4.7/8.6/16.3.

**P03 — Cancellation, ordering and recovery direction.** Ordinary commands are serialized by
admission order, not issued_at. A bounded out-of-band cancel lane may interrupt a blocked provider
stream, but cancellation events/receipts/terminal events remain serialized/fenced. A signal or
caller timeout is not durable cancellation. Browser disconnect does not cancel. WaitingApproval
must withdraw the outstanding approval explicitly under B; approval resolution racing withdrawal
has one committed order and cannot authorize a cancelled turn. Lease loss halts new effects;
recovery never blindly reruns Started or OutcomeUnknown work. Trace: TD §§4.2/4.7/4.8/6.5/16.3.

# Owned TD Gaps

| Gap | Question / known constraint / required resolution | Blocking owner |
|---|---|---|
| `[TD-GAP: ACT-VERSION]` | Exact v2 withdrawal payload/reducer and v1/v2 row/cache compatibility; preserve v1 fixtures and identities, no fabricated human decision | B, then C/F/G/H |
| `[TD-GAP: ACT-SCHEMA]` | Exact managed DDL/object inventory/locked upgrade, old-handle rejection, no mixed-version downgrade, private path/sync/crash policy | C |
| `[TD-GAP: ACT-LEASE]` | Persisted trusted clock identity, namespace/boot mismatch, unavailable clock, token/deadline overflow, renewal/release, final transaction linearization and race oracles | D |
| `[TD-GAP: ACT-RECEIPT]` | Exact bounded immutable codec, corruption gates, lifetime retention, no eviction/key reuse, capacity policy and E0 lookup error precedence | E/F |
| `[TD-GAP: ACT-COMMIT]` | Same-key races, durable rejection policy, expected-head re-decision, replay bounds, atomic audit fields and commit-ack ambiguity | F |
| `[TD-GAP: ACT-STARTUP]` | One pinned complete-history view, bounded replay/resumption, no cache restore, corruption and lease-claim ordering | G |
| `[TD-GAP: ACT-MAILBOX]` | Finite queue/cancel lane/admission/deadlines/shutdown; capacity reserve for terminal/cancel paths; no provider await under writer loop | H |
| `[TD-GAP: ACT-AUDIT]` | Actual authenticated actor provenance and immutable actor/scope/time/decision/reason linkage; A fields are labels only | F/H and future ingress/policy |
| `[TD-GAP: ACT-EFFECT]` | Receiver-enforced token/operation-ID admission, query/reconciliation, intent/authorization/Started/outcome, uncertain external cancellation, one terminal/result invariant | I with T110/T180/T190 |

Each gap is a known missing high-risk contract, not an implementation detail to invent. Proposed
recommendation is the least-authority direction in P01–P03/ADR0007; no affected child is Ready.

# Archetypes, Resources, Security and Evidence

A's complete A/E0 questions are answered in its own specification. Future B/E state changes
must name legal transitions/writer winners/re-read/commit order and every exit invariant. Future
B resource units must inherit private administrator paths, fixed SQL, size gates and cleanup,
including inherited same-UID replacement limits. Future C/E2 or C/E3 effects must specify every
crash boundary and explicit reconciliation; E3 can never be automatically retriable. Future D
streams must specify ordering, termination, chunk invariance, cancellation/backpressure. Future
F ingress must specify authentication/error mapping, input/rate/time bounds and redaction.
No unbounded queue, history collection, public path/SQL, plaintext secret or private reasoning is
authorized by this roadmap. Applicable numeric policies/codecs belong to the blocked children.

Future clause-test matrix and exact commands must be written per child before Ready; parent
acceptance requires all child runtime acceptances plus restart/lease-loss/duplicate-key/cancel/
approval-race/outcome-unknown composition tests and retained P0 regressions. None ran here.
This draft's evidence is documentation/link/name/dependency and diff audits only; design acceptance
is separate from implementation/runtime/parent acceptance. Root owns TD/traceability/status projection.
