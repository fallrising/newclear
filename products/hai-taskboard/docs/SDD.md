# HAI Taskboard Software Design Document

Status: **Accepted at G0 for P0-A implementation**
Last updated: 2026-09-05
Baseline: `newclear/main@3ad5533d8148a84ab19145fbee92306d1b69941b`

## 1. Decision summary

HAI Taskboard is a local-first, single-operator control plane for human/AI software delivery. Its
first proof is not a decorative Kanban board and not a multi-agent chat room. P0-A must prove that a
project can be resumed and safely completed without recovering old conversation history.

The system uses a React web control surface and a Go application service over normalized SQLite.
The first executor is deterministic and fake. The board, attention inbox and live stream are
projections of authoritative application state. A successful run can only produce a candidate; it
cannot make a WorkItem Done.

Normative words **MUST**, **MUST NOT**, **SHOULD** and **MAY** are interpreted as requirements. Every
normative clause has a stable identifier and is mapped in `docs/traceability.md`.

## 2. Goals and non-goals

### Goals

- **HAI-GOAL-001** — Persist Project, WorkItem, accepted specification bindings, dependency edges,
  Runs, Candidates, Reviews, Evidence, approvals and CompletionRecords so an operator can resume
  from durable state and a bounded ContextPack.
- **HAI-GOAL-002** — Make the WorkItem lifecycle visible and operable from Board, WorkItem detail,
  Attention and Impact Preview surfaces without treating chat as the source of truth.
- **HAI-GOAL-003** — Enforce subject-bound evidence and a server-side Done gate.
- **HAI-GOAL-004** — Demonstrate idempotent commands, crash-safe dispatch, lease fencing, explicit
  unknown outcomes, resumable updates and backup/restore before adding a real provider.
- **HAI-GOAL-005** — Invalidate only the deterministic declared dependency closure when accepted
  specification bytes or graph topology changes.

### P0-A non-goals

- Real Codex or other provider execution, credentials, arbitrary shell execution or network egress.
- Slack, Lark, MCP, webhooks, multi-user RBAC or a multi-agent chat room.
- Automatic merging, deployment, release, production mutation or unattended human approval.
- Full event sourcing, arbitrary historical time travel, semantic-equivalence inference or
  AI-authored accepted dependency edges.
- Cross-project dependencies, portfolio analytics or performance/productivity scoring.

## 3. System context and ownership

```text
Operator
   |
React Web UI --- REST commands / SSE projections
   |                              |
   +-------- Go application ------+
                 |
       domain + policy + ports
          |              |
       SQLite       Fake executor
          |
   filesystem artifact store
```

- **HAI-BOUNDARY-001** — Web is the only P0-A control channel. It MUST send application commands and
  MUST NOT write domain storage directly.
- **HAI-BOUNDARY-002** — The executor port MUST exist before any provider integration. P0-A MUST
  register only `fake/v1` and MUST reject undeclared capabilities.
- **HAI-BOUNDARY-003** — The application service owns commands, invariants, transactions, policy and
  projections. Adapters translate transport and provider representations only.
- **HAI-BOUNDARY-004** — Generated artifacts are untrusted payloads. Their content MUST NOT be
  interpreted as operator instructions by the host application.

## 4. Authority and transactional model

| Concern | Authority | Rule |
| --- | --- | --- |
| Specification bytes | Git object plus path | Immutable content addressed by commit and blob digest |
| Accepted spec binding | SQLite | Only an explicit import/accept command changes applicability |
| Operational state | SQLite | Normalized current state with optimistic aggregate versions |
| Audit history | SQLite | Append-only audit rows committed with command state |
| Dispatch work | SQLite outbox | Claimed after command commit; external calls never occur in it |
| Large artifacts | Filesystem | Immutable digest-addressed objects; metadata and bindings in SQLite |
| Board/SSE/attention | Rebuildable projection | Never an independent authority |
| Bootstrap execution status | `.team/PLAN.md` | One-time switch to SQLite; never bidirectional synchronization |

- **HAI-AUTH-001** — A command that changes authoritative state MUST commit the aggregate mutation,
  command-result/idempotency record, audit record and any outbox intent in one SQLite transaction.
- **HAI-AUTH-002** — External dispatch, filesystem publication and SSE delivery MUST occur after that
  transaction and MUST be retryable from durable intent.
- **HAI-AUTH-003** — Git and SQLite are not one transaction. Import MUST read an immutable Git object,
  calculate its digest, validate it, then atomically accept the binding in SQLite. Failure before the
  SQLite commit changes no accepted binding.
- **HAI-AUTH-004** — An artifact becomes visible only after bytes are fsynced to a temporary file,
  hashed, atomically renamed into the object store and bound by a committed SQLite row. Orphans MAY
  be garbage-collected; a database reference to absent or digest-mismatched bytes is corruption.
- **HAI-AUTH-005** — Audit is an operational accountability ledger, not an event-replay source. State
  restoration MUST use a database backup plus verified artifact objects.
- **HAI-AUTH-006** — SQLite foreign keys, WAL policy, busy timeout and engine/version behavior MUST
  be enabled and asserted at startup; migrations MUST be ordered, checksummed and transactional.

## 5. Domain model

### Aggregates and records

- `Project`: identity, name, repository binding and project version.
- `WorkItem`: identity, project, title, phase, blockers, priority/order, aggregate version and current
  accepted specification/dependency bindings.
- `ACRevision`: immutable acceptance criterion bytes/digest and revision identity.
- `DependencyRevision`: immutable typed edge set accepted for a project graph revision.
- `Run`: one execution attempt with immutable input subject, executor declaration, lifecycle, lease
  epoch and observed outcome.
- `Candidate`: immutable proposed result subject produced by exactly one run.
- `Review`: reviewer verdict bound to one candidate and required AC revision set.
- `Evidence`: one verifier result bound to the exact candidate, AC revisions, verification recipe,
  policy version and environment fingerprint.
- `Approval`: an operator decision bound to the exact command subject and subject digest.
- `CompletionRecord`: immutable proof that the Done predicate passed for a particular subject.
- `ImpactPlan`: deterministic preview of old/new graph invalidation before activation.
- `ContextPack`: bounded, generated resume projection with provenance and freshness metadata.

- **HAI-DOMAIN-001** — WorkItem, Run, Candidate, Review, Evidence, Approval and CompletionRecord MUST
  remain distinct identities and persistence records.
- **HAI-DOMAIN-002** — AC revisions, accepted dependency graph revisions, Candidates, Evidence,
  Reviews, Approvals and CompletionRecords MUST be immutable; correction creates a new record.
- **HAI-DOMAIN-003** — Blockers are a set orthogonal to WorkItem phase. Adding a blocker MUST NOT
  overwrite the phase; clearing one blocker MUST NOT clear the others.
- **HAI-DOMAIN-004** — Every mutable aggregate command MUST include `expected_version`; mismatch is a
  conflict with the current version and no partial mutation.
- **HAI-DOMAIN-005** — Every externally retriable command MUST include an idempotency key scoped by
  principal, project and command kind. Reuse with the same canonical request returns the recorded
  result; reuse with different bytes is a conflict. Retention MUST preserve a tombstone or explicitly
  reject an expired retry; it MUST NOT reinterpret an old retry as a new command.

### WorkItem lifecycle

P0-A phases are `Draft`, `Ready`, `Developing`, `Review`, `QA`, `Done` and terminal `Canceled`.
`Rework` is a guarded transition from `Review` or `QA` to `Developing`, not a persistent phase.
`Done-Stale` is a projection of a completed item
whose current accepted inputs differ from its CompletionRecord; its stored historical phase remains
`Done` until a new explicit transition starts rework.

- **HAI-STATE-001** — Draft → Ready requires at least one accepted AC revision and no blocking
  specification validation error.
- **HAI-STATE-002** — Ready → Developing requires an explicit operator command or an acknowledged
  Run start for the current subject.
- **HAI-STATE-003** — Developing → Review requires a current immutable Candidate; a successful Run
  alone is insufficient.
- **HAI-STATE-004** — Review → QA requires all policy-required Reviews to approve the current subject;
  QA → Done is permitted only through `CompleteWorkItem` and the Done predicate.
- **HAI-STATE-005** — Review/QA → Developing records a reason, preserves all historical evidence and marks
  non-current evidence inapplicable rather than deleting it.
- **HAI-STATE-006** — Drag, keyboard movement and button transitions MUST call the same server
  command and guards; the client MUST NOT optimistically persist an illegal phase.

### Done predicate

For requested subject `S`, `CompleteWorkItem(S)` succeeds only when all terms below are true:

1. the WorkItem is in `QA`, unblocked, and its expected version matches;
2. `S` identifies the current Candidate digest, Run input digest, complete required AC revision set,
   accepted dependency graph revision, policy version and completion recipe version;
3. all required checks have terminal `Passed` Evidence for exactly `S` and required verifier class;
4. no required check is `Failed`, `Skipped`, `NotRun`, `Unknown` or superseded;
5. the latest required Review for `S` is approving and satisfies reviewer-independence policy;
6. any required human Approval names the exact command and subject digest and is unexpired;
7. no newer accepted spec/dependency revision or impact activation supersedes `S`.

- **HAI-DONE-001** — The predicate MUST execute inside the same transaction that inserts the
  CompletionRecord and changes the phase to Done.
- **HAI-DONE-002** — Failure MUST return stable machine-readable unmet-requirement codes and MUST
  leave phase and CompletionRecord unchanged.
- **HAI-DONE-003** — Verifier independence is policy data; P0-A default rejects evidence produced by
  the same logical actor/run role when an independent-review check is required.
- **HAI-DONE-004** — A changed subject makes earlier Review, Evidence and Approval non-applicable; it
  MUST NOT rewrite their historical verdict.

## 6. Execution and recovery

### Adapter port

An executor declares `adapter_id`, `adapter_version`, capability set and execution policy. Its input
is an immutable Run envelope and bounded ContextPack. Its observations are untrusted and must be
validated before they become Run observations or candidate/artifact records.

- **HAI-EXEC-001** — Creating a Run and dispatch intent is transactional; invoking the adapter is not.
- **HAI-EXEC-002** — A worker MUST atomically claim an outbox dispatch and Run lease using a monotonic
  `lease_epoch`. Heartbeats, observations and terminal publication MUST carry the current epoch;
  stale epochs are rejected and audited.
- **HAI-EXEC-003** — `DispatchRequested` is not `Started`. Only a validated adapter start
  acknowledgement moves the observed execution to started/running.
- **HAI-EXEC-004** — Lease expiry means ownership is uncertain, not that execution stopped. The Run
  becomes `NeedsReconcile`; it MUST NOT be automatically redispatched when side effects may exist.
- **HAI-EXEC-005** — `CancelRequested` records intent. Only adapter confirmation establishes
  `Cancelled`; timeout or lost contact becomes `OutcomeUnknown`/`NeedsReconcile`.
- **HAI-EXEC-006** — Reconciliation compares durable intent with adapter observations, records every
  decision, and requires operator resolution for unknown side effects.
- **HAI-EXEC-007** — The Fake adapter MUST deterministically script start acknowledgement,
  heartbeat, success, failure, timeout, late/stale publication and unknown outcome without host
  shell or network access.
- **HAI-EXEC-008** — `WaitingHuman` is a resumable Run observation only for an adapter declaring
  durable checkpoint/resume. Otherwise a need for input interrupts the Run and answering its
  Question may authorize a new Run; the Question/Blocker remains the WorkItem-level fact.

Run persistence separates `desired_action`, `dispatch_state`, `lease_state`, `observed_state` and
`reconciliation_state`; no single overloaded status may erase these dimensions.

## 7. Deterministic reconciliation

Accepted dependencies are typed (`specifies`, `depends_on`, `verifies`, `produces`) and form a DAG
for P0-A. Only operator-authored, validated edges can become accepted.

- **HAI-RECON-001** — Import MUST reject cycles and dangling nodes with a deterministic diagnostic.
- **HAI-RECON-002** — A proposed change MUST build an ImpactPlan from both the old and proposed graph:
  direct byte/binding changes plus the union of their reverse transitive closures.
- **HAI-RECON-003** — ImpactPlan identity MUST bind base graph revision, proposed graph revision,
  changed node digests, algorithm version and ordered impacted set.
- **HAI-RECON-004** — Activation MUST require the current base revision and exact plan digest. A stale
  plan is rejected and recomputed; it cannot partially activate.
- **HAI-RECON-005** — Reuse is allowed only when candidate/input digest, full required AC set,
  dependency graph revision, policy, recipe/environment fingerprint, adapter version and required
  verifier class all match.
- **HAI-RECON-006** — An operator override MUST be explicit, reasoned, subject-bound and audited. It
  cannot make missing required evidence pass and cannot bypass the Done predicate.
- **HAI-RECON-007** — Activation marks affected current bindings stale and creates durable work; it
  MUST NOT delete history or silently redispatch execution.

## 8. API and projection contracts

P0-A exposes versioned JSON REST commands and queries under `/api/v1`. Commands return a stable
result envelope containing `command_id`, aggregate identity/version, audit sequence and structured
errors. An OpenAPI document is the transport contract; domain invariants remain authoritative in Go.

Minimum command surface:

- create/list/open Project and create/update WorkItem;
- accept AC/dependency revision and preview/activate ImpactPlan;
- transition WorkItem, add/remove blocker, dispatch/cancel/reconcile Run;
- publish Fake observation/Candidate/Evidence/Review in test/admin fixtures;
- approve an exact subject and attempt completion.

- **HAI-API-001** — Validation, conflict, stale subject, policy rejection, unmet Done gate and storage
  corruption MUST have distinct stable error codes.
- **HAI-API-002** — SSE cursors are `(stream_epoch, event_sequence)`. Event sequence increases
  monotonically within an epoch; reconnect replays retained events only for the same epoch or returns
  an explicit `projection_reset_required` event.
- **HAI-API-003** — Slow consumers MUST be disconnected at a documented bounded buffer threshold;
  authoritative transactions MUST never block on connected clients.
- **HAI-API-004** — Snapshot queries include a high-water event ID so the client can subscribe
  without silently losing the snapshot-to-stream gap.
- **HAI-API-005** — Projection rebuild from authoritative state MUST be deterministic and must not
  change aggregate/audit identities.

## 9. User experience contract

P0-A provides four connected surfaces:

1. **Project/Board** — Draft, Ready, Developing, Review, QA and Done phase columns, plus a
   deterministic Blocked condition projection; work cards expose current execution/evidence state.
2. **WorkItem detail** — ACs and bindings, dependency impact, Runs, Candidate, Review, Evidence,
   approvals and audit history.
3. **Attention** — actionable conflicts, blockers, unknown outcomes, stale plans/evidence and
   disconnected/reset-required states; no vanity activity feed.
4. **Impact Preview** — old/new revision, directly changed and transitively affected items, reasons,
   reusable evidence, rebuild requirements and an exact activation subject.

- **HAI-UX-001** — Every card shows title, phase, blocker count/reason indicator, current Run state,
  evidence summary and stale/attention indicator; it MUST NOT invent progress percentages.
- **HAI-UX-002** — Drag is progressive enhancement. Keyboard and single-click alternatives expose
  identical targets and guards, with visible focus and screen-reader announcements.
- **HAI-UX-003** — On server rejection, the card returns to authoritative position, focus returns to
  the triggering control and the unmet guard is announced and linked to the relevant detail.
- **HAI-UX-004** — Disconnected, reconnecting, stale snapshot, conflict, `CancelRequested`,
  `OutcomeUnknown` and `Done-Stale` are visually and textually distinct; color is never the only cue.
- **HAI-UX-005** — Destructive or authority-changing actions show exact scope; completion and impact
  activation require confirmation of the current subject digest.
- **HAI-UX-006** — Chat/log text is subordinate evidence or artifact content, collapsed by default,
  and never used as the sole representation of task state.

The selected information architecture and component interaction contract are specified in
`docs/sdd/ui-interaction.md` after independent comparison and an interactive design checkpoint.

## 10. Security and local operation

- **HAI-SEC-001** — The server binds loopback by default and refuses non-loopback bind unless an
  explicit deployment security profile is configured.
- **HAI-SEC-002** — P0-A accepts no provider credential. Secrets MUST NOT appear in specs,
  ContextPacks, logs, audit payloads, errors or artifacts.
- **HAI-SEC-003** — Paths MUST be resolved beneath configured repository/artifact roots without
  symlink traversal; uploads and artifact reads require size, type and digest validation.
- **HAI-SEC-004** — Fake execution has an allowlisted capability profile of no shell, no host write
  outside its artifact staging directory and no network.
- **HAI-SEC-005** — State-changing requests require same-origin protection and an unguessable local
  session token; logs redact authorization, cookie and secret-like fields.
- **HAI-SEC-006** — Approval validation re-hashes the current subject inside the command transaction;
  an approval cannot authorize changed bytes or expanded capability/impact scope.
- **HAI-SEC-007** — Retention and deletion are explicit policy operations. Audit/CompletionRecords
  are preserved; unbound artifact objects are eligible for garbage collection after a grace period.

## 11. Storage, backup and capacity

P0-A starts with a single process, a single SQLite database and a same-filesystem artifact object
store. Deployment packaging is local/container development only until restore evidence exists.

- **HAI-OPS-001** — Backup MUST use SQLite's online backup mechanism or a quiesced verified copy,
  capture artifact objects against a manifest and record schema version/high-water audit sequence.
- **HAI-OPS-002** — Restore MUST verify database integrity, migrations, artifact presence/digests and
  projection rebuild before serving commands. It advances a persisted restore generation and rotates
  the stream epoch; pre-restore callbacks require explicit reconciliation and cannot inherit authority.
- **HAI-OPS-003** — Corrupt/missing artifact bytes place affected subjects in an attention state and
  forbid Done; the server MUST NOT fabricate missing evidence.
- **HAI-OPS-004** — P0-A capacity evidence reports the tested project/item/run/event/artifact count,
  database size, event replay latency, board query latency, dispatch recovery time and backup/restore
  duration. Thresholds are acceptance data, not unmeasured claims.
- **HAI-OPS-005** — SSE/audit retention is bounded by policy; falling behind retention requires an
  explicit projection reset, never a silent gap.

## 12. Delivery gates

- **G0 Design** — repository boundary, this SDD, required ADRs, mini-SDDs, UI interaction contract,
  test skeleton names and traceability independently reviewed.
- **G1 Fake core** — deterministic domain and persistence tests; Fake vertical slice; completion
  negative cases; lease/recovery/SSE/restore failure injection; accessible critical UI flows.
- **G2 Real adapter** — explicitly deferred and requires separate user authorization, provider terms
  review, credential/host/network controls and a second evidence set.

- **HAI-DELIVERY-001** — No production behavior may precede its accepted normative clause and named
  test oracle.
- **HAI-DELIVERY-002** — A worker report is evidence, not acceptance. The orchestrator inspects scope,
  diff and verification output before updating the execution plan.
- **HAI-DELIVERY-003** — Required failed, skipped, flaky or NotRun checks remain visible and prevent
  an unqualified completion claim.
- **HAI-DELIVERY-004** — Product task contracts in `docs/tasks` are immutable inputs. Mutable bootstrap
  execution status exists only in `.team/PLAN.md` until the explicit SQLite authority migration.

## 13. Technology baseline

- Backend: `go 1.27` plus `toolchain go1.27.1`, standard `net/http`, explicit application/domain/port
  packages, OpenAPI contract, SQLite selected by ADR-005.
- Frontend: Node 24.20.0 LTS, pnpm 11.25.0, React/React DOM 19.2.8, Vite 8.2.2,
  TypeScript 6.0.3, Tailwind CSS/Vite plugin 4.3.3 and shadcn CLI 4.21.0 as a controlled source
  generator; use an accessible
  sortable implementation only after keyboard/non-drag contracts exist.
- Reproducibility: pinned toolchain/container digests and committed lockfiles. "Latest" means an
  explicitly recorded and independently checked version, never an unbounded floating tag.

Exact pins, compatibility exceptions and container/CI contracts are in `docs/reproducibility.md`.

## 14. Resolved G0 design decisions

- SQLite uses `modernc.org/sqlite@v1.58.0` with its linked SQLite 3.53.4 engine, per ADR-005 and
  the bounded T-004 selection evidence. Product crash, disk-full, manifest-publication, restore-
  generation and non-amd64 checks remain explicit NotRun work for later gates.
- The `/api/v1` OpenAPI contract owns wire shapes for projections, typed commands, command-result
  lookup, resumable SSE and Project-bound artifact reads. Go remains authoritative for identity,
  authorization, canonicalization and domain guards; instance-level operation/payload mismatch is
  a required contract check.
- The P0-A UI uses the independently reviewed Board-first information architecture, with Review as
  a phase and Blocked as orthogonal state. Drag, keyboard and single-click actions share one command
  path and focus-recovery contract.
- Traceability preserves all source criteria AC-01 through AC-54 and names the minimum P0-A G1 test
  subset. A NotRun row is visible debt, never passing evidence.

The only remaining G0 action is an independent re-review of these repaired artifacts. No production
behavior may begin until that gate accepts the design set.

## 15. References

- `hai-taskboard-brief.md`, SHA-256
  `74596865dcf073626d52548160b709e4506d155fa4e90cc07b6a6535d2c7d7c6`
- `hai-taskboard-design-review-v0.2.md`, SHA-256
  `f7cadae975c9300478f2a4d1bd24c2c1efbf3a3bd7bba0daa20fd4ee2db6a01c`
- `hai-taskboard-sdd-review-v0.2-augmented.md`, SHA-256
  `e03910bb3cd1cdc763201552e671f34d351a3db9cfc4c234261f507069249dbc`
