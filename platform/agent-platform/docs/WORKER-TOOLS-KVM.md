# Normal Worker tool workflow: real KVM acceptance contract

Status: planned; no acceptance driver or KVM results are delivered by this document.
The prerequisite is merged normal Worker tool integration. The inspected baseline
`61dbc06` has a fixture-owned ToolSession, but `Worker` and `execute_real` do not
own or advance it. Resolve the integration's actual configuration, immutable
profile contract and failure states from its merged source before implementing
this acceptance. Do not invent those interfaces in an independent harness.

## Objective and boundaries

Prove that the normal production Worker lifecycle can run an explicitly opted-in
tool task on real KVM using a deterministic mock model and authenticated local
mock GitHub, then produce a verified result and release resources. The separate
[process recovery acceptance](TOOL-PROCESS-RECOVERY.md) already demonstrates
fixture-owned relay process faults. Its successful SDK terminal is not evidence
that the normal Worker owns the tool session or completes platform finalization.

This is an opt-in acceptance, with tools disabled by default. It grants no live
provider access, paid model use, new runtime dependency or production activation.
It does not replace prior isolation/process-recovery coverage or attempt host
reboot, M4 export, arbitrary model-driven workflow health or a benchmark.

## Execution ownership

The driver may create task/project/profile records through public APIs, start
its own Worker/connector/node processes, host deterministic loopback mocks,
observe public APIs and read the test database and owned journals. The actual
Worker must claim and execute the run, own heartbeat and ToolSession, provision
and revoke broker authority, advance both model and tool work when configured,
consume SDK events, finalize the result and run normal resource release.

The controller must not instantiate or step ToolSession for a run, provision its
grant, call Broker rebind, mutate lease/state/result/ACK SQL, or issue lifecycle
operations directly to make a case complete. It may submit user approval/cancel
through platform APIs. Emergency owned-resource cleanup is separate evidence;
it cannot turn a failed case into a pass. Read-only observation must not mutate
returned data or drive progress. Any transport fault interposer must be scoped
to a named case, leave production logic unchanged, and record the exact boundary.

Use a new immutable profile through the integration's merged opt-in contract.
Keep an older/default profile unchanged for the disabled case. Host credentials
and broker capabilities must remain outside the guest. Guest-local transport
credentials retain their existing audience restrictions. Load secrets only from
fresh private files; use hashes/booleans, never secret values, in evidence.

## Prerequisites and preflight

Before provisioning any VM:

1. Pin the merged source commit, integration contract and locked dependencies.
   Confirm normal Worker tool wiring exists and inspect its native regressions.
   A missing prerequisite is **blocked**, not a skipped case or a passing smoke.
2. Map the exact Worker launcher/configuration, opt-in profile fields, resource
   policy, approval endpoint, event cursor and result-verification contract.
   Update this document and local assertions if the delivered interface requires
   changes. Do not relax the success or no-replay requirements to fit the code.
3. Reuse the sealed launcher and delegated service prerequisites in
   [TB-2b](TOOL-BROKER-TB2B.md), [KVM validation](KVM-VALIDATION.md) and
   [egress](M3-EGRESS.md). Use a dedicated empty node, zero warm targets, ready
   golden snapshot, pinned guest/runtime and deny-all network policy. Check
   memory/disk reserve with the unchanged gates before starting acceptance.
4. Allocate fresh private state, journals, credentials, ports, service names and
   a disposable PostgreSQL database. Assert the selected listeners are unused.
   Track exact child handles/service identities and test resource ownership.
5. Confirm bounded mock model/tool responses, request/response limits, timeouts,
   total run deadline and deterministic barriers. Use only loopback test origins;
   no production credential or live GitHub request is needed.

Only after these checks implement/run `scripts/worker-tools-kvm.py` with its
focused `tests_platform/test_worker_tools_kvm.py` coverage. Those files are planned
entry points, not runnable commands at this document's initial revision. The
source digest must include every driver, fixture and production module used by
the eventual run. Existing fixture-only acceptance results are not substitutes.

## Minimal KVM matrix

| Case | Trigger and observation | Required result |
| --- | --- | --- |
| `normal` | New opted-in immutable profile with `require_approval: true`; deterministic model requests the fixed terminal tool action; public approval; repository/issue/pinned-file calls against mock GitHub | Worker owns all progress. Exact returned values, three original tool operations, three durable SQL ACKs and seven authenticated mock hops; SDK observation plus finished/caught_up; validated expected workspace diff and profile verification; platform succeeded; normal full cleanup |
| `disabled` | Existing/default profile without opt-in, with the same host service configured; deterministic guest attempts a bounded tool call | No active broker grant or bound tool channel, and zero upstream dispatch; guest denial is observed. A harmless terminal may finish, but no tool success is claimed. Normal lifecycle and cleanup still complete |
| `cancel-in-flight` | Mock confirms the first authenticated tool hop is held; submit public cancel while Worker and heartbeat remain alive, then release the mock | Admission closes without waiting for the held provider. No further hop, replay, late delivery or invented ACK; canonical cancelled/cleanup state follows merged control contract. Reservation is held until complete stop proof |
| `tool-outcome-uncertain` | Admit one operation, then close the mock connection without returning a valid response at a deterministic external boundary | No retry of the operation, result replay or success claim. Worker follows the documented conservative failure contract, revokes authority and cleans up or retains unknown cleanup/capacity until reconciliation. SDK finished is recorded only if actually observed; an error-handling finish is not platform success |
| `partial-stop-proof` | Following actual owned VM removal, a case-scoped response interposer withholds one required stop-proof fact from every cleanup/recovery response until retention is observed | Worker must not release the SQL reservation on the partial proof. Record retained capacity; restore truthful transport and use the native supported recovery/cancel path to obtain complete proof and release. Clearly label this as proof-response injection, not a real residual cgroup |

Before public approval, observe `approval.requested` and the run's
`awaiting_approval` state, with zero tool-upstream dispatch. Submit the decision
with the actual expected state version, generation and action digest. Correlate
`approval.requested` → `approval.decided` → `approval.applied` with the same
approval/run/generation/digest before asserting successful execution. A public
request returning accepted alone does not prove approval application. Do not
allow automatic model-tool approval to substitute for this explicit gate.

For `partial-stop-proof`, keep the fault active for all proof-bearing responses
on that case's normal cleanup, exception cleanup and recovery paths. In
particular, a failed release may immediately trigger native cancel. Wait until
retained capacity/unknown cleanup is observed with the fault active, then
explicitly restore truthful transport and invoke only the supported recovery
path. Do not mistake a complete proof from an unmasked fallback for a premature
release. Never suppress or forge the underlying host's real observation.

The exact three tool requests reuse TB-2b's known bounded repository/issue/file
fixture, preserving its seven-hop oracle. The deterministic model must also
produce the bounded workspace change required by the selected verification
profile. Assert the expected diff content/hash and actual configured check
results; neither an arbitrary marker nor the old fixture-M2 assertion alone
establishes the normal profile's verification contract.

A deterministic request-held barrier must be established by the authenticated
mock, with the operation identity/admission row observed before fault injection.
Do not rely on a sleep to guess dispatch state. Every case has bounded completion
and cleanup deadlines. Late output already delivered before a boundary cannot
be recalled; do not relabel it as withheld. Such a boundary mismatch fails the
case and requires a reproducible corrected barrier.

## Completion and evidence oracles

Keep these observations separate:

- **SDK completion:** the normal Worker receives `finished` with `caught_up: true`
  through ordinary event polling, and the expected terminal observation exists.
  Preserve cursor continuity and unique upstream event IDs with a passive trace
  of the responses consumed by the normal Worker's existing transport. Record
  each request cursor, response cursor, event IDs, state and caught_up without
  changing responses or issuing extra polls. SQL event rows are already deduped
  and cannot alone prove upstream ID uniqueness. Compare trace IDs/cursors with
  persisted events; do not replace polling, swallow a generic 409 or infer
  finished from a tool result file.
- **Tool delivery:** exact operation/binding/generation and authenticated hop
  counters, durable broker status/delivery and receipt-presence booleans. An ACK
  proves adapter receipt, not arbitrary model consumption or platform success.
- **Platform result:** Worker saved the exact expected diff and profile-bound
  verification, with the expected run state and finalization events. A finished
  SDK error-handling terminal cannot satisfy this normal success gate.
- **Cleanup:** original VMM, VM record, runtime directory and CPU scope are all
  confirmed gone before capacity release. Then confirm zero owned claims, VMs,
  reservations, Worker/connector children and disposable database containers.
  Stop only the owned services and preserve their journals and failure reports.

Record source/runtime hashes, case start/end, process/run/binding/generation
identities, approvals/receipts as non-secret identifiers, mock dispatch/ACK
counts, SDK cursors and observed terminal status, result/check hashes, capacity
transitions and cleanup proofs. Keep raw event payloads, provider responses,
IPC, connector logs and journals private. Public evidence uses a strict allowlist
and must not include hostnames, private paths, keys, tokens or raw receipts.

Cancellation and destroyed-VM cases do not need an impossible SDK finish event.
They must meet their own control/fault oracle. Any original failure and manual
recovery remains visible even after a later clean run passes. Cleanup errors
must make that run fail. A failed setup does not count as a covered matrix row.

## Regression and delivery gates

Add focused tests for report/completion oracles and failure-path cleanup before
relying on the KVM driver. Deliberately violate meaningful invariants to confirm
that the assertions reject omitted finished/caught_up, a false result success,
duplicate event IDs, replay/late ACK and premature capacity release. Keep the
smallest useful test scope; do not duplicate the entire broker suite. Any actual
product defect needs a minimal failing regression and a separately scoped fix.

Run the component's native `make platform-check`, focused regressions and full
KVM matrix against the same source. Independently review the source/evidence,
verify private/public provenance, then check PR CI at the final head. A complete
delivery requires actual KVM and cleanup evidence, not doc-only CI. A partial
contract PR stays Draft; the full slice stays blocked when its integration
prerequisite is absent. After authorized merge, check main CI and hand off review.

## Current evidence status

At baseline `61dbc06`, normal Worker tool integration is absent. Inspection of
`worker.py` and `runtime_worker.py` confirms ModelSession support but no normal
ToolSession lifecycle; `tool_worker.py` is absent. This document specifies the
next acceptance boundary and contains no implementation or new runtime evidence.
No KVM resources were created for this contract. All matrix rows, driver
regressions, native integration validation and real KVM cleanup proof remain
**not run**, pending the prerequisite and driver implementation.
