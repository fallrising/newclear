# Combined model and broker process recovery acceptance

Status: five-case real-KVM acceptance passed on 2026-10-04; final delivery CI
and merge are recorded in the task ledger.

## Scope

Exercise the ordinary Worker with both native model and tool mailboxes against
loopback mocks. Preserve the shipped recovery policy: incomplete tool authority
is never recreated merely because a new Worker owns the lease. With full native stop proof, the three incomplete-work faults must end
`failed/model_transport_uncertain`. An interrupted run with retained capacity
is a failed acceptance outcome; only a proven persisted result may recover to
success.
This slice verifies existing behavior, with minimal fixes only for reproduced
defects. It does not establish full M3, arbitrary coding workflows, live GitHub,
provider billing, a hard monetary cap, host reboot or production activation.

## Bounded matrix

All profiles require public approval. The first two fault boundaries precede
approval; the other cases require exactly one applied public approval. No
successor approval or replacement model/tool authority may be created.

| Case | Process boundary | Model rows / upstream calls / uncertain requests | Broker operation | Final run / generation |
| --- | --- | --- | --- | --- |
| normal | No injected failure | 2 final / 2 / 0 | 1 succeeded, acknowledged; one hop | succeeded / 1 |
| model-reserved | Original reserve commits, before dispatch | 1 reserved / 0 / 1 | none | failed, model_transport_uncertain / 2 |
| model-response | Actual upstream response, before original settlement | 1 reserved / 1 / 1 | none | failed, model_transport_uncertain / 2 |
| broker-delivered | Original connector deliver returns accepted, before next tick ACK | 1 final / 1 / 0 | 1 succeeded, pending; one hop, receipt present, zero ACK | failed, model_transport_uncertain / 2 |
| result-before-save | Connector returns persisted verified result, before Worker save | 2 final / 2 / 0 | 1 succeeded, acknowledged; one hop and drained event | succeeded / 2 |

Reserved rows retain `dispatch_outcome_unknown` and null settlement/token usage;
`usage_view` counts them as uncertain. They are not rewritten to `unknown`.
Final mock rows have `mock_reported_usage`. A delivered operation retains its
literal `succeeded/pending` state because native recovery does not invoke
`Broker.rebind`. Neither uncertainty nor pending delivery may be refunded,
replayed or relabeled to obtain a pass.

For the three failed cases, require no stored result and exactly one native
`model.cutoff` with reason `model_transport_uncertain` and capacity retained at
cutoff. Model/tool authority is revoked without creating successor tokens or
grants. Successful cases need lifecycle/generation fencing; they must not
require a model-token revocation timestamp that native success does not write.

At the result barrier, SQL remains `finalizing` with null result and no
`run.result_saved`; connector result is persisted and verified, SDK completion
was consumed, and broker ACK/drain is durable. Recovery inspects `phase=result`,
saves that existing result, and proves the original VM stopped without another
model step, tool start, allocation or result operation. A result without drained
evidence must fail. Empty successor polling is explicitly persisted-result
recovery, supported by the predecessor's actual finished/caught-up trace.

Native leases last 30 seconds and heartbeat every 5 seconds. Record database
clock and the actual expired lease. Native reconciliation retains the original
reservation, then the normal claim increments generation while preserving
binding. Recovery must start promptly enough to preserve the guest's normal
120-second mailbox deadline; no deadline or lease edits are permitted. Reuse
the identical policy and synthetic secret files across both Worker processes;
regenerating a fixture policy changes its service identity and is invalid.

## Injection and evidence

Use a task-owned Worker child. Test-only wrappers call the original operation
and emit an atomic private barrier record at the chosen boundary, then stop the
process; the controller verifies the barrier and kills that exact child.
Natural lease expiry and the normal Worker claim/reconciliation path determine
the next generation. Wrappers must not write lifecycle state, lease deadlines,
usage counters, grants, ACKs or results. Controller SQL is read-only. Creating
the initial test catalog/task and applying its exact public approval are setup.

Observe request/operation identities and counters privately before the fault,
after the kill, and after recovery. Track real mock upstream calls independently
of SQL, old/new Worker identity and generation, connector/VM identity, durable
events and exact SDK cursor metadata. Retain original error/failed report data.
Old-generation probes are denied negative calls, never progress drivers. A
successful result must match the expected diff and verification contract.

Normal and recovered-result cases require actual SDK finished/caught_up from
the Worker that consumed it; a successor that only loads a persisted result
must not invent new polling. Other faults use their actual lifecycle reason,
usage, delivery and cleanup oracles. Empty/partial traces are labeled; no skipped
polling, manufactured ACK, controller-driven relay or generic success fallback.

## Cleanup and acceptance

At each recovery and stop-proof boundary, observe the original reservation and
VM/claim identity. Require complete stop proof before capacity release. Attempt
all owned cleanup even after an original error, preserve its exception, reject
missing/boolean numeric evidence, and keep the final verdict false on cleanup
or report-I/O failure. Final inspection includes owned VM, claim, reservation,
CPU scope, child, connector, node, listener and test database cleanup. Keep
journals and failed attempts; never clean unrelated resources.

Add focused behavioral regression tests, including adversarial evidence and
process-boundary handling, before relying on the new driver. Run native checks
and the small real-KVM matrix on an isolated owned sealed deny-all node. Record
source hashes and exact commands/exits. Independently review code and raw
evidence, then publish only case names, states, counts, hashes and cleanup facts.
PR/main CI and merge readback are delivery gates, not replacements for KVM.

## Reproduction

Use the same isolated sealed deny-all node, pinned SDK image and loopback mock
prerequisites as [combined acceptance](M3-INTEGRATED-ACCEPTANCE.md). The output
directory must be new; keep private policies, snapshots and journals outside the
repository. Start the owned node first; this driver owns its connector, Worker
children and mocks. The PostgreSQL wrapper owns and removes its test database.

```sh
PYTHONPATH=src python scripts/test-postgres.py python \
  scripts/m3-recovery-integrated-kvm.py \
  --config /path/to/owned/connector.json \
  --origin http://127.0.0.1:23888 \
  --output /path/to/new/private-evidence
```

The driver runs the five cases in order and stops on the first failed oracle.
Partial snapshots are persisted before and after termination so a failed
successor does not erase the boundary evidence. After driver cleanup, independently
check the owned node's VM scopes and processes, stop that node, and check its
listeners and cgroup. A driver pass alone is not proof of outer node cleanup.

## Observed acceptance

The final five-case run passed on a real KVM node with sealed deny-all egress,
loopback mocks and the ordinary Worker. No runtime recovery policy or dependency
changed. [Public evidence](evidence/m3-recovery-integration.json) records only
allowlisted states, counts and hashes; private snapshots retain the exact
request, operation, process, lease and binding identities for review.

Normal and result-before-save each consumed 13 SDK events over six actual polls,
reached finished/caught-up, acknowledged the single broker operation and passed
the result contract. The recovered result used the original persisted bytes;
the successor made zero SDK polls and zero new model/tool dispatches. All four
killed originals were observed stopped, terminated with SIGKILL and reaped.
Successors claimed generation 2 only after database-clock lease expiry. Old
generation inspect was denied with the exact connector generation error.

The three incomplete-work faults ended `failed/model_transport_uncertain`,
retaining the expected reservation uncertainty or pending delivery shown above.
Their incomplete SDK traces remain incomplete; no finished event is fabricated.
The original binding and capacity were retained through complete native stop
proof, then released. Final VM, claim, reservation, CPU scope, Worker, connector,
node and listener observations were zero; node PID and cgroup were absent. Both
owned PostgreSQL wrappers, including the failed first attempt, were removed.
A scan of 41 synthetic canaries over 38 observable files found zero literal
matches; this does not establish arbitrary-secret DLP.

The final source archive contained 160 allowlisted component files, based on
`811618e9fa590a62edfafc1c0cd27a10288d80ac`, with four new code/test paths. Its SHA256
is `c9d59db8859a7aca9ff1b68812caa135f6f5e9063f18209d16158a14583545a7`.
Every archived file was verified before execution and matched the final local
source. The public evidence includes the four new file hashes and raw evidence
hashes; synthetic credential files and runtime identities are excluded.

`PYTHONPATH=src make platform-check` passed with 45 unit and 490 platform tests,
Ruff lint/format checks and owned database removal. The 30 new focused tests
include seven actual Linux subprocess tests and 23 oracle/error-path tests.
Use the locked environment and explicit source path: an initial full-suite
invocation accidentally loaded an older editable checkout, failed, and was
excluded before the complete correct-source rerun. Web/browser behavior is
unchanged; repository CI supplies the delivery regression gate.

The first KVM attempt failed in the new stale-generation probe because the shared
HTTP transport deliberately drops error bodies. The probe now uses that
transport's no-proxy/no-redirect opener, reads a bounded denial body, accepts
only the exact expected 409 error, and closes it. A complete rerun passed;
failed reports and before/after/final snapshots remain preserved. Independent
review also reproduced and corrected an oracle that accepted the wrong recovery
phase, and cleanup that could mask the primary initialization error. Regression
tests preserve these failures without altering production behavior.
