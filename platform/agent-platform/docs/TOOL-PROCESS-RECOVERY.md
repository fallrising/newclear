# Tool broker process crash recovery

This opt-in acceptance extends [TB-2b](TOOL-BROKER-TB2B.md) and
[SDK event polling](SDK-EVENTS.md) with actual host process death. It uses the
existing fixture-only ToolSession, production Worker claim/heartbeat/reconcile
methods, durable SQL broker ledger and a real connector process. It does not
activate tools in the normal production Worker or add a runtime dependency.

## Contract and process boundaries

A controller owns a disposable database, mock GitHub server and isolated KVM
node. A separately launched worker fixture owns its Worker identity, heartbeat,
Broker and ToolSession. SIGKILL must be sent to that exact child PID and reaped
with the signal exit status. Recovery uses a fresh process and Worker identity;
SQL lease expiry occurs naturally after the old heartbeat dies. No SQL lease
rewrite is accepted as process recovery evidence. The original binding and
reservation remain until full stop proof. The successor uses production
reconciliation/claim/fence. The interrupted run keeps unknown cleanup state,
and fresh tool authority remains denied;
it must not replay the original tool invocation or SDK prompt.

The connector is another controller-owned subprocess. It is killed and
restarted using exactly the same private configuration, journal and fence
files. The new process must reject old channel access and rebinding. A new
connector epoch never grants authority to an old bound mailbox. Journal intent
and delivery metadata must survive restart; a restart must not invent an ACK.

## Bounded acceptance matrix

| Case | Crash barrier | Required outcome |
| --- | --- | --- |
| normal | No crash; independent worker process | Three exact tool results/SQL ACKs, seven mock hops; actual SDK events through finished/caught_up |
| worker-in-flight | Mock confirms authenticated first request is blocked; SQL admission exists | Actual SIGKILL and natural lease loss; new owner/generation, same binding; durable admitted operation remains conservatively uncertain, no ACK/result replay, original terminal drains with withheld error |
| worker-settled | Broker durably succeeded/pending; worker has not taken the delivery tick | SIGKILL loses ephemeral result/receipt; successor preserves succeeded/pending without claiming confirmed delivery; no dispatch or result replay, withheld terminal |
| connector-in-flight | First request blocked, bound channel and pending metadata durable | SIGKILL/restart same journal; old poll/bind denied, host session revokes; no late delivery/ACK/replay; terminal drains with withheld error |
| connector-delivered | Guest response accepted and connector delivered metadata durable; SQL ACK not yet applied | SIGKILL/restart refuses old channel and rebind; no resend and no invented SQL ACK. Already delivered guest output may be consumed; it cannot be recalled. |

The worker fixture advances relay ticks under controller commands so the
settled and delivered barriers do not depend on racing wall-clock sleeps.
External effects already dispatched are not rolled back. A successful broker
operation with unknown delivery is not a successful platform workflow. The
normal case alone proves successful tool completion. Fault cases separately
assert terminal observation/error where available, durable conservative status,
no duplicate SDK event IDs, and full cleanup. Failed connector restart must recover its owned listener for
native cancellation while the disposable SQL database still exists. The port
probe matches the server's SO_REUSEADDR behavior without taking a live listener.
A broker-only regression may
restore a synthetic live SQL fixture to exercise explicit rebind, but KVM must
not manufacture live state to bypass conservative production recovery.

## Verification and safety

Use deterministic subprocess/SQL regression tests for durable operation states,
old token rejection and at-most-once dispatch. Focused tests must fail when the
corresponding safety invariant is deliberately violated; pre-existing safe
behavior can be covered without an artificial production edit. Any discovered
product defect gets a minimal failing regression before its fix.

Run the KVM driver only on an explicitly authorized dedicated empty sealed
deny-all node, with fresh private state and the repository's pinned runtime and
locked dependencies. Credentials stay in private configuration/IPC, never in
public evidence or guest output. Each child is tracked by its own process
handle; no process-name-wide kill or unrelated service mutation is allowed.

Every exit path attempts owned child termination/reaping and native VM cancel.
Reservations are held until the original VMM, VM record, runtime directory and
CPU scope are all confirmed gone. Nonzero claims, VMs, reservations, child
processes or cleanup failures fail acceptance. Remove only the test wrapper's
own PostgreSQL container. Stop the owned node service after final verification;
preserve journals and compact failed-attempt evidence.

## Running the acceptance

Start only an owned node with the documented sealed launcher:

```sh
PYTHONPATH=src python -m agent_platform.egress_node \
  --config <private-state>/connector.json \
  --sandbox-config <private-state>/sandboxd.json
```

Use the delegated user-service setup from TB-2b, wait for golden readiness and
check that the node has no claims/VMs. The new driver owns its connector process;
leave the selected loopback connector port unused. It starts the unchanged
`create_connector` application through a fixture launcher which records PID and
process epoch privately; no production endpoint or crash hook is added.

```sh
PYTHONPATH=src python scripts/test-postgres.py python scripts/tool-process-recovery-kvm.py \
  --config <private-state>/connector.json \
  --origin http://127.0.0.1:19888 --output <new-private-output>
```

`--case` selects one matrix row. Each invocation requires a fresh database and
output directory. Raw connector/worker logs and stdio IPC remain private. The
controller reuses TB-2b's API setup, SDK cursor/finished checks and cancellation;
the child owns allocation/Worker heartbeat and all relay ticks. A successor
borrows the already registered catalog without registering a reserved node.

The existing host memory/disk reserve and sealed-policy gates must pass. On a
dedicated empty node, an owned golden snapshot may be stored sparsely only when
its bytes/hash remain identical; this is a test setup optimization, not a lower
reserve threshold. An uncertain allocation follows the existing explicit
ownership reconciliation procedure and keeps its journal.

Focused regression command:

```sh
PYTHONPATH=src python scripts/test-postgres.py python -m unittest discover \
  -s tests_platform -p test_tool_process_recovery.py -v
```

The three broker/SQL tests use real child SIGKILL with IPC barriers. Their
synthetic live generation setup isolates `Broker.rebind`; it does not stand in
for KVM natural lease expiry. Three cleanup regressions prove connector shutdown is attempted even if native
node cleanup raises, a dead owned connector is restarted before cancellation,
and a TIME_WAIT address is reusable while an active listener is still refused. The full native gate is `make platform-check`.

## Acceptance record

On 2026-10-03 the complete five-case matrix passed on real KVM; the
[sanitized record](evidence/tool-process-recovery-2026-10-03.json) includes the
17 driver/runtime source hashes, exact operation/binding/hop facts, old/new
process IDs and connector epochs, natural lease timings, SDK event results and
cleanup. Normal completion consumed 13 unique events and three SQL ACKs over
seven authenticated mock hops, with all 25 guest isolation checks passing.
Both worker replacements advanced generation from 1 to 2 after the existing
lease expired naturally. They retained interrupted/unknown lifecycle state and
denied old token and fresh session authority. All fault operations had exactly
one dispatch and no SQL ACK; only `connector-delivered` already exposed the
original result. Every case continued event polling through SDK finished and
caught_up without duplicate IDs. This is fixed-terminal fixture completion,
not arbitrary model-driven platform workflow health.

Final claims, VMs, VM CPU scopes, SQL reservations, worker/connector children
and test PostgreSQL containers were zero; the owned node service was stopped.
`make platform-check` passed 45 unit and 348 platform tests with Ruff covering
126 files; the focused six regressions also passed. No production source or
runtime dependency changed.

Earlier failed attempts remain private and are not acceptance passes: golden
creation correctly blocked the empty-node gate; an incorrectly launched node
failed sealed-policy attestation; insufficient disk reserve prevented an
allocation and required native ownership reconciliation. An unblocked mock
exposed a settlement barrier race, fixed by explicit hold/release. A TIME_WAIT
port-probe failure prevented connector restart and left one owned VM until
manual exact-identity native handle cleanup established all four stop proofs;
the expired lease was not changed. The driver now accepts reusable TIME_WAIT
addresses, rejects live listeners and restores its dead connector before
cancellation. Cleanup exceptions also always stop the connector. These driver
fixes have focused regression coverage.

The first native run failed one unchanged pause test when a single recovery
claim returned None. Ten unchanged baseline repetitions passed; a controlled
baseline row-lock probe reproduced that assertion under SKIP LOCKED, but did
not establish the original cause. Subsequent full native checks passed. This
pre-existing timing limitation is retained as a separate follow-up; pause code
and validation were not changed.

The connector matrix covers pending request and completed guest delivery. It
does not inject a KVM crash in the narrower interval between the connector's
`delivering` journal write and its HTTP response, and it does not test host
reboot. Normal production Worker integration and live-provider activation are
separate slices.
