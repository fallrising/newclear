# SDK events after approval

This repair extends [TB-2b](TOOL-BROKER-TB2B.md) with continuous SDK event polling.
The normal Worker and fixture-only tool transport activation policy are unchanged.

## Root cause

Approval-only conversations used the pinned SDK's REST `ConversationInfo`, which
reads autosaved state. The SDK can already be running after approval while that
snapshot still says `waiting_for_confirmation`. Events are read separately from
current history. Combining these observations can invent another pending approval:

- A later state read is already running: `approval_backend_not_waiting`.
- History already contains the matching observation: `approval_batch_invalid`.

The first case was captured on real KVM using the original connector while
polling a normal approved terminal through SDK completion. Both variants have
minimal deterministic regressions. The original earlier failure logs contain only
the generic client error; they do not establish their exact downstream code.
Timing-dependent baseline runs can also pass.

The HTTP transport discards error bodies and RuntimeClient maps non-200 responses
to `connector_operation_unconfirmed` (HTTP409), hiding that distinction. The
repair does not forward raw errors or relax error handling. Private reproduction
instrumentation captured only allowlisted fixed codes and execution states; it is
not part of the production connector or the repaired acceptance run.

## Repair and invariants

Polling reads the newest validated `execution_status` update from the same durable
history as the returned events and approval proposal. The pinned SDK persists these
updates immediately through its normal event callback; its base-state save may wait
until the current step exits. Event search reads immutable history without acquiring
the conversation state lock. Before any durable status update exists, the existing
REST status remains the fallback.

A broad switch to live WebSocket `full_state` was tested and rejected: the SDK holds
its state lock during a terminal step, so that snapshot can wait on the very broker
progress blocked by synchronous polling. The experiment returned connector503
(`TimeoutError`), also masked as generic client409. It is preserved as failed evidence.
Active polling does not subscribe to full_state. Actual approval mutations retain
fresh before/after snapshots, exact digest, policy, generation and expiry checks at
the stable approval boundary. The event response is only a proposal, never authority.

A completed durable receipt whose digest exactly matches the proposed batch means
the confirmation was already applied, even if asynchronous run startup has not yet
appended `running`. In that narrow interval the response reports nonterminal running
without proposing the same approval again. Started/uncertain or different receipts
do not match; a new batch still requires approval. Neither a receipt nor a tool ACK
can establish finished: only an SDK status observation plus fully consumed history
can satisfy completion.

There is no broad retry or swallowing of 409, no raw-error forwarding, no new journal
schema or runtime dependency, and no weakening of cursor continuity, duplicate-ID
rejection or credential filtering. Unknown, malformed or sensitive durable status
values fail closed; genuine invalid pending batches remain errors.

Pinned upstream implementation:
[state-change persistence](https://github.com/OpenHands/software-agent-sdk/blob/856d99d48e4b11c70c5f1cab21e7830570dbc324/openhands-sdk/openhands/sdk/conversation/state.py),
[callback and tool lock](https://github.com/OpenHands/software-agent-sdk/blob/856d99d48e4b11c70c5f1cab21e7830570dbc324/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py),
[event search and snapshots](https://github.com/OpenHands/software-agent-sdk/blob/856d99d48e4b11c70c5f1cab21e7830570dbc324/openhands-agent-server/openhands/agent_server/event_service.py).

## Verification contract

Focused tests distinguish persisted REST from durable SDK status events and cover normal
approval → observation → finished, a REST transition during polling, fault output
and credential redaction, cursor/metadata refusal, genuine invalid pending batches,
receipt matching, new batches, terminal-state pagination, and a busy live-state lock.
The synchronous non-VM integration fixture explicitly
models one consistent state; it does not establish WebSocket or KVM behavior.

The real KVM driver uses a local deterministic model and authenticated mock GitHub.
Normal completion requires three exact tool results, three durable broker ACKs,
seven HTTP hops, all 25 guest isolation checks, and an SDK `ObservationEvent`
carrying the fixed terminal success marker. Polling must then reach `finished`
with `caught_up: true`, preserving cursor continuation and unique event IDs.
A tool result file or ACK cannot satisfy that completion gate.

Helper/session/ownership and applicable revocation faults require the fixed
withheld-result marker in the SDK observation, followed by finished, with one
original dispatch, no result ACK and no replay. Here finished means the SDK
completed the deterministic error-handling fixture; it does not turn a failed
tool request into a success. Cancellation and pause retain their own control
contracts; stopped guests are not required to emit a finish event.

Run from the component with the locked dependencies:

```sh
PYTHONPATH=src python -m unittest discover -s tests_platform -p test_sdk_events.py -v
PYTHONPATH=src make platform-check
PYTHONPATH=src python scripts/test-postgres.py python scripts/tool-broker-kvm.py \
  --config <private-state>/connector.json --origin http://127.0.0.1:18888 \
  --output <new-private-output>
```

Use the dedicated-node prerequisites in TB-2b, fresh task-owned state and output,
and retain failed attempts. Confirm full stop proof and zero owned claims, VMs,
reservations, VM CPU scopes and test containers before stopping test services.
No live GitHub, paid model, new runtime dependency or production activation is
part of this proof. This does not establish arbitrary model-driven workflow health.

## Acceptance record

On 2026-10-03 the [sanitized acceptance record](evidence/sdk-events-2026-10-03.json)
passed all ten real KVM cases. Normal completion read 13 events across 25 polls,
including the terminal observation and SDK finished/caught-up. Helper restart,
session rebind, SQL worker takeover, revoke and cutoff each read the withheld
observation through finished, with no ACK/replay. Cross-run, pause, cancel and
partial-stop-proof retained their distinct gates. All owned runtime resources
were zero and both test services were stopped; private journals and failed runs
were preserved.

The 11 focused regressions passed. `make platform-check` passed 45 unit and 329
platform tests, with Ruff covering 121 files. Local tests used Python 3.12.3;
actual KVM used Python 3.13.5 and the pinned SDK/runtime. Exact source hashes are
in the record. CI is checked separately against the pull request's final head.
