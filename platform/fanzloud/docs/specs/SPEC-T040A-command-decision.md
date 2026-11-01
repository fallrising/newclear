---
id: SPEC-T040A
title: Pure version-1 session command decision
status: verified
contract_unit: CU-SES-03
module: codebox-domain
milestone: P1
archetype: A
atomicity: E0
invariants: [INV-003, INV-004]
depends_on: [SPEC-T010, SPEC-T020]
td_sections: [4.2, 4.4, 4.7, 8.1-8.10, 9.3, 10.3, 11.1-11.4, 16.3]
adr_refs: []
risk: medium
---

# Intent

Define the first independently implementable actor prerequisite using only accepted T010 types
and T020 version-1 reducer behavior. [Independent design acceptance](../acceptance/T040A-design.acceptance.md)
preceded test-first implementation; separate [runtime acceptance](../acceptance/T040A.acceptance.md)
now accepts this pure command prerequisite.
All A01–A09 requirements trace to the cited TD/T020 clauses; exact command representation,
precedence, codec and test partitions are reversible `[NEW-SPEC]` local derivations.

# Responsibility

## Does

Produce one immutable decision and canonical request identity from an immutable reducer and one
typed command. An accepted decision proposes zero or one version-1 event; it does not start a turn.

## Does Not

Perform I/O, read a clock, generate identifiers, authorize an operator, validate a lease, store a
receipt, append an event, publish a frame, change input memory, or invoke/cancel any backend.
WaitingApproval cancellation is deliberately unsupported by this version-1 prerequisite.

# Public Boundary

```rust
pub enum ActorRef { Operator }
pub enum ApprovalScope { Once }
pub enum ApprovalReason { OperatorApproved, OperatorDenied }
pub struct CommandEnvelope<C> {
    pub command_id: CommandId,
    pub session_id: SessionId,
    pub expected_version: Option<u64>,
    pub actor: ActorRef,
    pub issued_at: DateTime<Utc>,
    pub payload: C,
}
pub enum SessionCommand {
    StartTurn { turn_id: TurnId },
    ResolveApproval {
        turn_id: TurnId, approval_id: ApprovalId,
        decision: ApprovalDecision, scope: ApprovalScope, reason: ApprovalReason,
    },
    CancelTurn { turn_id: TurnId },
}
pub enum CommandKind { StartTurn, ResolveApproval, CancelTurn }
pub enum CommandDecision {
    Accepted { event: Option<NewDomainEvent> },
    Rejected(CommandRejection),
}
pub enum CommandRejection {
    WrongSession { expected: SessionId, actual: SessionId },
    SessionNotFound,
    SessionArchived,
    ExpectedVersionConflict { expected: u64, actual: u64 },
    InvalidApprovalReason,
    TurnAlreadyRunning { turn_id: TurnId },
    CancellationRequiresVersionedAmendment,
    WrongState { command: CommandKind, state: SessionStatus },
    ActiveTurnMismatch { expected: Option<TurnId>, actual: TurnId },
    PendingApprovalMismatch { expected: Option<ApprovalId>, actual: ApprovalId },
    SequenceExhausted { head: EventSeq },
}
pub struct CommandPlan { /* private canonical command bytes and decision */ }
pub fn decide_session_command_v1(
    state: &SessionReducer,
    command: &CommandEnvelope<SessionCommand>,
) -> CommandPlan;
impl CommandPlan {
    pub fn canonical_command(&self) -> &[u8];
    pub fn decision(&self) -> &CommandDecision;
}
```

These signatures are implemented in [command.rs](../../crates/codebox-domain/src/command.rs)
and exported by codebox-domain. Read-only output getters add no independent I/O boundary. This CU has no public raw-byte/JSON parser or canonical-byte import constructor.

# Inputs and Outputs

**A01 — Typed, bounded domain.** Identifiers reuse non-nil T010 newtypes. `issued_at` retains
every accepted Chrono UTC value, including extrema/leap precision; no freshness restriction is
implied. The sole actor label is Operator, not an authentication claim. ResolveApproval carries
explicit actor/scope/decision/reason; Approved pairs only with OperatorApproved and Denied only
with OperatorDenied. No string, prompt, credential, path, provider configuration, or output is
accepted. Inputs remain caller-owned. Trace: TD §§4.1/4.4/8.3; SPEC-T020; `[NEW-SPEC]`.

**A02 — Exact canonical identity.** Every input field participates in equality. Encode, in
order: ASCII `CBC1` (4 bytes); big-endian u16 codec1 (2); command UUID (16); session UUID (16);
expected-version option (tag0 plus eight zero bytes, or tag1 plus big-endian full-u64 value:9);
actor byte Operator=0 (1); signed big-endian i64 timestamp seconds (8); big-endian u32
nanoseconds (4); command tag StartTurn=0/ResolveApproval=1/CancelTurn=2 (1); then payload.
StartTurn/CancelTurn payload is turn UUID16. ResolveApproval payload is turn UUID16,
approval UUID16, decision Approved=0/Denied=1, scope Once=0, and reason
OperatorApproved=0/OperatorDenied=1:35 bytes. Thus lengths are exactly77 or96, never more96.
Nanoseconds preserve Chrono's accepted leap representation. UTC-equivalent timestamp inputs
encode equally; different seconds/nanos do not. No padding, hashing, lossy conversion, owner,
lease token or receipt timestamp participates. Canonical identity is available even for a rejected
decision. It proves request equality, not uniqueness, authenticity or durable acceptance.
Trace: TD §4.4; `[NEW-SPEC]`.

# Preconditions and Disposition

| ID | Condition | Disposition / trace |
|---|---|---|
| P01 | Non-nil IDs and valid UTC timestamp | Type invariants, accepted T010/T020 |
| P02 | Same reducer/command session | Checked decision rejection, A03 |
| P03 | Session projection exists and is not Archived | Checked decision rejection, A03 |
| P04 | Optional expected version equals reducer high-water | Checked decision rejection, A03 |
| P05 | Approval reason agrees with explicit decision | Checked decision rejection, A03 |
| P06 | State and identities allow the proposed event | Checked decision rejection, A03/A04 |
| P07 | Proposed next sequence is representable | Checked decision rejection, A03 |

# Success Postconditions

**A03 — Total decision and error precedence.** The function returns a complete CommandPlan for
every typed input, including rejection; it does not panic. Checks run in this order:
(1) session mismatch; (2) absent projection; (3) Archived; (4) expected version mismatch;
(5) inconsistent approval reason for ResolveApproval; (6) A04 state rule;
(7) active-turn identity when the state rule permits an identity check;
(8) pending-approval identity for ResolveApproval; (9) sequence exhaustion if an event is proposed.
A matched CancelTurn in Cancelling is accepted without an event and therefore needs no next
sequence. This order is independent of timestamps/UUID ordering. Trace: TD §§4.2/8.2/8.3/16.3;
SPEC-T020 transition/identity checks; `[NEW-SPEC]`.

**A04 — Complete state/command matrix.** `S` proposes TurnStarted; `R` proposes ApprovalResolved;
`C` proposes TurnCancellationRequested; `N` accepts with no event; `W` rejects WrongState;
`T` rejects TurnAlreadyRunning with the current active turn; `V` rejects
CancellationRequiresVersionedAmendment; `A` rejects SessionArchived. Identity checks apply only
to R/C/N; S accepts the supplied turn ID without proving it is globally unused.

| Existing state | StartTurn | ResolveApproval | CancelTurn |
|---|---|---|---|
| Provisioning | W | W | W |
| Ready | S | W | W |
| Running | T | W | C |
| WaitingApproval | T | R | V |
| Cancelling | T | W | N |
| Idle | W | W | W |
| Failed | W | W | W |
| Archiving | W | W | W |
| Archived | A | A | A |

An empty reducer rejects SessionNotFound for all three commands. A WaitingApproval CancelTurn
returns V even if its turn ID is wrong; it never fabricates an approval decision. T uses the
active turn guaranteed by accepted T020 construction. Every W carries exact kind/state.
Trace: SPEC-T020 version-1 transition table; TD §§4.2/4.7; `[NEW-SPEC]` no-op cancellation policy.

**A05 — Proposed event metadata.** Every proposed event has schema_version1, occurred_at equal
to issued_at, causation_id=Some(command_id UUID), and correlation_id=command_id UUID. S carries
the requested turn; R carries exact turn/approval/decision; C carries exact turn. The plan assigns
no actual event ID/sequence. At a representable next sequence, applying an envelope built from
the proposal to the same accepted reducer must succeed and produce exactly A04's state.
Caller-supplied timestamps may move last_activity backwards, as accepted T020 already permits.
Trace: TD §§4.4/4.7/16.3; SPEC-T020; `[NEW-SPEC]` correlation derivation.

# Non-Guarantees

**A06 — Ownership limits.** An accepted proposal is not a receipt or evidence of durability,
authorization, effect execution, turn completion or uniqueness across turns. Repeating a decision
does not reserve a turn or consume a command ID. The function cannot make WaitingApproval cancel
legal, populate the full policy/tool audit, or infer provider cancellation from a lifecycle event.
Those guarantees belong to blocked parent children. Trace: TD §§4.7/4.8/8.8/16.3.

# Exit Invariants and Failure Atomicity

**A07 — E0 and deterministic laws.** Success, rejection, future caller timeout/cancellation and
repeated invocation leave the reducer and command unchanged and touch no external/shared mutable
state. Equal complete inputs yield equal canonical bytes and decisions; every accepted event
preserves the T020 single-active-turn and contiguous-sequence rules when later correctly appended
and reduced. No I/O, owned task/thread, retry, timer or crash-recovery resource exists here.
Trace: TD §§8.5(A)/8.6/8.7; SPEC-T020.

# Side Effects, Idempotency, Concurrency and Streaming

None. Calls on immutable inputs are independent. Replay-idempotence means repeated decision
equality, not idempotent event append. Input/event sequence is authoritative; no mailbox, provider
stream, chunk ordering, termination, live fanout or backpressure is owned. A02's fixed96-byte
ceiling and A04's zero/one event bound limit output; no large buffer or variable text is accepted.
Process interruption discards caller memory only. Trace: A02/A06/A07; TD §§4.4/8.5/8.8.

# Failure Modes and Error Contract

**A08 — Bounded rejections.** A03's exact variants are domain decisions, not storage errors.
They carry only listed enums, IDs or numbers; their Display/Debug contain no arbitrary content.
There is no automatic retry. A caller may change its input/state and recompute; whether a future
durable rejection is replayed permanently belongs to the receipt contract. Every rejection has
zero proposed events. Trace: TD §§8.2/8.6/16.3; `[NEW-SPEC]`.

| Rejection | Caller action |
|---|---|
| WrongSession / SessionNotFound / SessionArchived | Correct routing or select a usable session |
| ExpectedVersionConflict | Obtain current state and re-decide; never blindly advance expected |
| InvalidApprovalReason | Supply a consistent explicit decision/reason |
| TurnAlreadyRunning | Wait or explicitly cancel the named active turn |
| CancellationRequiresVersionedAmendment | Use no v1 workaround; await separately accepted amendment |
| WrongState | Re-read state and choose a legal command |
| ActiveTurnMismatch / PendingApprovalMismatch | Correct the exact current identity |
| SequenceExhausted | Stop proposing mutations; operator investigation |

# Security, Observability and Audit Contract

**A09 — No authority inference.** Labels and IDs grant no capabilities. No JSON/HTTP/provider
input is parsed here; future ingress must perform its own bounded strict decode/authentication.
No logs, metrics, audit record or event are emitted. Explicit approval fields survive canonical
identity, but INV-010's durable actor/scope/time/reason provenance is not established by A.
Trace: TD §§2.3(INV-010)/4.4/6.6/8.5(F); `[NEW-SPEC]`.

# Test Specification and Clause Matrix

All exact named oracles first compiled and failed substantive assertions before implementation.
They now pass in the integration target and the in-crate overflow unit module; the separate
runtime acceptance records their executed evidence and retained historical design boundary.

| Clauses | Exact machine name | Concrete oracle |
|---|---|---|
| A01/A09 | `command_v1_inputs_are_closed_typed_and_authority_free` | Compile-fail ID confusion; inspect exact enums/fields and absence of parser/I/O/secret/path/execution APIs; nil remains T010-rejected |
| A02 | `command_v1_canonical_bytes_cover_every_field` | Independent exact byte fixtures for all commands, both expected tags, decisions/reasons; mutate each field individually and assert distinct bytes, excluding nonexistent owner/token |
| A01/A02 | `command_v1_canonical_bounds_and_timestamp_extrema` | Length77/96; expected0/u64::MAX; MIN_UTC/MAX_UTC/leap timestamps roundtrip by independent test decoder; equal UTC instant preserves identity |
| A03/A04 | `command_v1_decision_covers_all_states_and_commands` | All27 matrix cells plus3 empty cases from legal public reducer histories; assert exact decision/rejection payload and event count |
| A03 | `command_v1_rejection_precedence_is_exact` | For every co-reachable pair of checks, combine both violations and assert the earlier variant; explicitly prove unreachable pairs (e.g. absent projection and Archived) from accepted reducer construction |
| A03/A04 | `command_v1_exact_turn_and_approval_identities_are_required` | Running/Cancelling cancel wrong turn; waiting resolve wrong turn, wrong approval and both; unchanged inputs and exact expected/actual IDs |
| A03/A04/A06 | `command_v1_waiting_cancel_requires_amendment` | Waiting with correct/wrong turn both V, no events/approval resolution; retained v1 reducer still rejects direct cancellation event |
| A04/A05 | `command_v1_accepted_events_match_existing_reducer` | Apply each proposal with next seq to original reducer; check all fields, exact causation/correlation/schema/time and resulting projection; Cancelling N emits no event |
| A03/A05/A08 | `command_v1_sequence_exhaustion_is_safe` | In-crate cfg(test) unit oracle uses a crate-private test-only reducer seam for Ready/Running/Waiting heads u64::MAX; no wrapped event; Cancelling matched N succeeds; earlier state/identity errors win |
| A06/A07 | `command_v1_decision_is_deterministic_and_e0` | Generated bounded legal histories and commands; equal calls equal plans, complete input snapshots unchanged for every accepted/rejected case; parallel calls match serial decisions |
| A08/A09 | `command_v1_rejections_and_debug_are_bounded` | Trigger all11 variants, inspect exact fields/Display/Debug; no arbitrary text or misleading authorization/durable-success labels |

The overflow oracle belongs to an in-crate cfg(test) unit module and the full-domain-suite command;
the public command_decision_v1 integration target uses only legal public reducer histories. Any
seam is crate-private and cfg(test), not a new public constructor or production restore API.
Unit/property/model tests apply; external adapter, database, network, disk-full, process-kill and
fault-injection tests are not applicable to this pure CU. Absolute paths/../symlink/NUL/invalid
UTF-8/partial JSON/unknown tool/nesting partitions belong to absent raw-input/resource boundaries;
source inspection proves those inputs are unrepresentable here. Empty/one/many is the complete
zero/one event bound; every count/enum/identity/time edge is covered above. No provider/tool
regression is claimed by this prerequisite. Trace: TD §§11.1–11.4.

# Acceptance Evidence

Runtime Accepted. The [runtime report](../acceptance/T040A.acceptance.md) records the actual
RED/GREEN checkpoint, 41 passing domain checks, 306 passing workspace tests, 10 Node tests,
independent 5,760-case model, complete clause review and preservation checks. The historical
design report remains unchanged. These implementation commands were executed successfully:

```bash
cargo test --offline --locked -p codebox-domain --all-features --test command_decision_v1
cargo test --offline --locked -p codebox-domain --all-features
cargo fmt --all -- --check
cargo clippy --offline --locked -p codebox-domain --all-targets --all-features -- -D warnings
git diff --check
```

# Traceability, TD Gaps and Self-Check

CU-SES-03 is a TD §8.4 extension, not CU-SES-02 durable dispatch. A01–A09 map to the
named tests above and existing SPEC-T020 behavior. No high-risk gap remains inside this narrow
E0 proposal. Parent actor gaps remain in [SPEC-T040](SPEC-T040-session-actor.md).
Archetype A is total, deterministic, replay-idempotent and property-testable; immutable inputs
prove E0. F/B/C/D/E resource, authorization, persistent concurrency and effect guarantees are
explicitly outside this CU. T040A has independent runtime acceptance. The project-wide automated
rustdoc/spec drift checker remains a known tooling gap; the actual API/contract projection was
reviewed explicitly, without claiming unavailable automation.
