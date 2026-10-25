# Manual stale binding cleanup — T-092 Phase A

Proposed contract against `234daf32cad60af231abf35fb44cfdd75bbe2a6c`.
This document is a design for independent/root review, not an implementation or
permission to operate a node. Phase B requires an accepted, committed contract
and an actual missing-behavior RED. SDD §13.2, INV-12 and AT-13 remain broader
than this slice. Event/audit retention delivered through PR641 is independent.

## Actual gap and smallest effect

`runtime_worker.persist_result` commits the immutable archive, result and terminal
`succeeded`/`failed` state **before** `cleaned(client.operation(..., 'release'))`.
`Journal.operation` fsyncs `release.state=started` before the remote mutation.
A crash before that mutation, failed transport, or partial release can therefore
leave a terminal run, retained reservation, and a started release. Quarantine
preserves the terminal state and queues the original job as interrupted. Lease
expiry also preserves terminal state and retains capacity.

Existing recovery already claims these interrupted jobs, raises generation,
attests the same instance and completes cleanup if the claim and all four host
resources have disappeared. It does not need a new collector for a lost reply
whose release actually completed. With a still-present matching VM,
`connector_recovery.inspect` rejects the unfinished operation; `Journal.operation`
rejects repeating it. Cancel rejects terminal runs and internally reuses that
same release operation. Thus there is a real stalled-release gap, without
inventing a stale-age rule or resetting lifecycle state.

The proposed new effect is **one explicitly approved release request for one
still-owned terminal sandbox**, recorded as a new cleanup attempt. It never
restarts allocation, prepare, prompt, result, export or model/tool work, and never
edits the old release operation into success. Another apply of the same attempt
only observes; it cannot send release again. A further release requires a fresh
preview and explicit new approval after ownership is revalidated. No scheduler,
bulk inventory sweep, database row pruning, arbitrary host deletion or age-based
eligibility is included. Terminal state is the existing SDD eligibility rule;
lease expiry is an ownership boundary, not a retention duration.

| Residual state | Existing behavior / proposed treatment |
| --- | --- |
| Normal result or failure, full stop proof | Existing worker confirms cleanup; no new destructive action |
| Terminal result, release started, exact live original claim/VM | New bounded manual attempt may issue one release |
| Release reply lost, claim absent and all four proofs true | Existing recovery; manual attempt may observe/finalize without release |
| Claim absent but process/VM record/directory/scope remains | Unknown partial effect; observe only, retain reservation; no host removal API in this slice |
| Active/interrupted execution, finalizing/archive failure, cancel/pause/resume | Existing recovery/control/cancel owns it; reject manual cleanup |
| Unknown allocation/no saved handle or observation | Existing explicit unconfirmed-allocation reconciliation only; do not infer ownership from an empty list |
| Missing journal/fence, changed claim/VM identity, unreachable node | Reject or record unknown; keep authoritative rows and capacity |
| Already confirmed/released, fake backend, unallocated queued cancellation | Outside destructive eligibility; never manufacture an eligible state |

Source boundaries: `runtime_worker.py` persist_result/cleaned/exception handling;
`worker.py` reconcile_expired/owned; `recovery.py` claim_recovery/quarantine;
`cancellation.py` request_cancel/execute_cancel; `controls.py` execute_control/expire;
`connector_cancel.py`; `connector_recovery.py` observe_sandbox/stopped/inspect;
`connector.py` require/guard/release/mutate; `connector_journal.py` operation;
`connector_fence.py`; `agent_platform_m0/kvm_lifecycle.py` Host.observe/removal.
Existing recovery/cancellation tests cover lost ACK, PID reuse, partition, missing
journal, lease loss and insufficient stop proofs; they do not establish a
manually approved new request for a started release with its VM still live.

## Preview, approval and eligibility

Add private local maintenance functions `stale_cleanup.preview(db, connector,
run_id=...)` and `stale_cleanup.apply(db, connector, plan, approval_digest=...)`;
CLI `stale-cleanup-preview --run-id UUID` and
`stale-cleanup-apply --plan PATH --approve DIGEST`. No new public HTTP or browser
capability. Private connector preview/apply endpoints retain its current
loopback, token, Origin, body-size and sanitized-error boundary. They accept a
run/attempt identity and fixed action, never paths, arbitrary handles or shell.

Exactly one caller-selected UUID is inspected. Plan/file size is at most65536
bytes; individual DB/journal snapshot encodings at most8MiB, otherwise refuse
before issuing a plan. No unbounded directory scan or candidate refill. Use
strict canonical JSON, duplicate-key rejection, strict UUID/integer/hash/time
types and current private-file checks. Canonical encoding is sorted keys,
compact separators, ASCII escaping, no NaN. Approval is SHA256 of the complete
plan excluding approval_digest; it detects change, not malicious same-UID or
DB-owner forgery.

The exact issued plan contains schema_version=`stale-cleanup-v1`, random
attempt_id, maintenance_id, connector_cleanup_identity, created_at, expires_at,
run_id, job_id, binding_id, node_id, current_generation, next_generation,
state_version, terminal_state, provider_handle, claim_ref, archive_id,
archive_sha256, ownership_digest, precondition_digest, action=`release-owned`,
approval_digest. Times are canonical UTC with six fractional digits;
expires_at=created_at+1hour. next_generation=current_generation+1; no caller
chosen generation. DB time enforces created_at<=now<expires_at at admission.
Approval binds a single exact snapshot and is immutable in the connector's
private journal. Plans
contain hashes of private observations, never tokens or host paths.

Preview writes issued-plan evidence but performs no release, fence grant,
generation change, reservation release or worker ownership transfer. It requires:

- OpenHands run state `succeeded` or `failed`, non-null committed result and
  retained immutable result_archive metadata, no pending control action;
- exactly its existing binding/reservation and original execute job; matching
  run/job/binding generation, binding provider_handle not pending, reservation
  unreleased, run/binding cleanup pending or unknown;
- job interrupted, or leased with lease_until<=DB clock; no live owner. A leased
  job must first go through existing reconcile_expired before apply admission;
  preview never steals or edits its lease;
- private journal/fence exist; journal generation equals DB generation; fence
  is no newer and its lease expired by connector clock; completed allocation,
  prepare, prompt and result with existing matching allocation/result identities;
  original release exists in started state; no other unfinished operation;
- exact claim ID, claim_ref, template/none/large key and journal handle; original
  Host observation attests VM ID, PID+start ticks, image digest, CPU/memory,
  runtime directory and CPU scope. Fresh observation matches all these facts.

The ownership digest binds the private handle (including owner/token), original
observation and allocation identity; precondition_digest binds relevant durable
run/result/archive/job/binding/reservation and journal operation facts, excluding
lease-renewal timestamps and the new attempt's own records. Apply rechecks both,
not just a client supplied hash. No raw journal or result is returned. Partial
host visibility, missing resources without complete absence proof, or mismatches
cannot produce a destructive plan. A planned live instance that has since fully
disappeared may complete by observation without sending release.

### First-upgrade enrollment and identity preservation

`connector_cleanup_identity` is a per-run UUIDv4, not a global connector file.
Store it inside the existing `<run UUID>.json` journal row in one versioned
`stale_cleanup` envelope. Its exact initial shape is `{schema_version:
"stale-cleanup-journal-v1", connector_cleanup_identity: UUID, enrolled_at: UTC,
ownership_digest: SHA256, issued_plans: {approval_digest: exact_first_plan},
attempts: {}, tombstone: null}`. The enrollment ownership digest binds the original
saved handle/observation/allocation and excludes changing generation/lease facts.
Existing journal operations, handle, observation, run ID and generation are
preserved unchanged as JSON values. No differently shaped `*.json` is
added under Journal.root; allocation's existing run-journal scan remains valid.

Only first **preview**, never apply/startup/ordinary recovery/restore, may enroll
a valid legacy run. Legacy means the original run row exists, has no
`stale_cleanup` key and no recognized cleanup identity/plan/attempt/tombstone
facts, and passes every DB/result/job/binding eligibility and exact original
handle/Host/expired-fence check above. Missing journal/fence/handle/observation
cannot qualify as legacy. Under the existing per-run journal lock, re-read those
facts and fence expiry, generate the UUID and first plan, and save the entire
envelope plus first issued plan in a **single existing Journal.write**. Its
temporary-file fsync, atomic replace and parent-directory fsync must finish
before returning the first plan. Enrollment changes no lease/generation, performs
no remote mutation, and supplies no ownership evidence absent from the legacy
row. It is the explicit supported first-upgrade extension of already valid
private authority, not reconstruction of missing authority.

If `stale_cleanup` exists, strictly validate its schema and complete identity,
enrollment digest/time, issued plans, attempts and tombstone before preview or
apply. Missing/null/malformed identity, unknown envelope version, identity
disagreement with any saved plan/attempt, or orphaned cleanup facts without the
envelope is corruption: refuse without generating a UUID or changing the row.
An existing envelope with no plans is invalid because first enrollment stores
its first plan atomically. Subsequent previews append plans under the **same**
identity; all reopen/restart/recovery writes preserve the envelope. Apply never
bootstraps and rejects any identity different from the exact issued plan.
Once recorded, enrollment identity/digest/time are immutable, old plans/attempts
remain, and an admitted tombstone cannot disappear or be reset.

Crash before atomic replacement leaves a valid unenrolled legacy row; no plan
has been returned, so a later first preview can enroll it. Crash after durable
replacement, including before the response, leaves the original identity and
first plan; reopening must preserve them, and another preview may append a new
plan without rotating identity. Malformed/partially visible state fails closed.
Private journal backup/restore must preserve the whole envelope with its original
row and fences. Missing or inconsistent enrollment after plans is not repaired
from DB rows or a client plan. Complete malicious deletion of **all** enrollment
evidence, or rollback to an otherwise valid pre-enrollment private backup, cannot
be distinguished from a never-enrolled legacy row without an external anchor.
This slice adds no such anchor and claims no protection against that rollback;
the existing trusted-operator/private-state preservation boundary still applies.

## Non-atomic protocol, fencing and replay

1. Apply strictly validates the exact connector-issued plan,
   approval, identities and expiry. In a short DB transaction acquire existing
   maintenance advisory77310401, then lock the job before run/binding/reservation
   in existing worker order; re-read DB time and all approved preconditions.
   Require interrupted job and expired/no live lease. Atomically increase
   run/job/binding generation to the approved next value,
   set desired_state stopped, and lease the existing job to this maintenance
   owner for30seconds. Commit before granting that exact lease to the connector.
   Do not change terminal state/state_version, result, archive or attempt number.
2. Reuse5second heartbeat/30second leases and owned checks. Connector grant must
   reject a newer fence; never lower a fence or generation to pass a restore.
   Under its existing per-run operation lock, check current fence and exact issued
   plan, original operation/ownership digests, then fresh claim and host identity.
   Recheck expiry after waiting for that lock and before admitting the effect,
   using the existing supported synchronized single-host clocks.
   Fsync a cleanup tombstone that permanently closes ordinary run mutation
   admission, and a new attempt's `started` intent **before** its one close RPC.
   All allocate/mutate/control/approval/tool/model paths must consult the
   tombstone, including when the fence generation later changes. Stopping and
   observation are the only allowed actions for this run afterward.
3. At most one SDK close request is admitted per attempt; no transport retry.
   ACK/404/timeout alone is never proof. Re-observe exact claim absence plus
   `original_vmm_process_gone`, `vm_record_gone`, `runtime_directory_gone`,
   `cpu_scope_gone`, all strictly true. Existing SDK timeout15seconds and host
   wait30seconds bound an attempt's wait, not remote execution lifetime.
4. Save the complete stop observation and immutable attempt receipt in the private
   journal. Return the existing job to interrupted under current owned checks,
   leaving reservation and cleanup state unchanged. Existing recovery then
   independently re-observes claim/four-key absence and runs its existing atomic
   cleaned transaction. The CLI reports `stop_observed; reconciliation_pending`,
   never pretends the reservation was released. It does not add another DB
   cleanup writer. Preserve the original release intent and every authority/
   replay row. Lost ownership forbids even the old owner's job update, although
   the physical effect may have succeeded.
5. On any uncertain remote result, missing proof, fence loss or DB commit failure,
   preserve the attempt journal and reservation. If still owned, return the job
   to interrupted/cleanup unknown without changing terminal state. Otherwise
   existing lease expiry performs quarantine. DB failure cannot roll back a VM
   release; connector failure cannot roll back committed DB admission.

Crash before DB admission: no effect. After admission/before connector intent:
resume the same attempt under valid current ownership, rechecking all conditions;
if the lease expired, a fresh approved plan is required. When connector intent
has not yet been saved, the journal can still be at generation N while the DB
is N+1. Run existing lease-expiry recovery before previewing again: its committed
takeover/fence and `Service.require` advance the existing journal generation
before `inspect` quarantines the original unfinished release. This performs no
new release, allocation or work. After that owner has relinquished the job and
its fence lease expires, a new exact-equality plan can be issued. A newer fence
than DB state (for example after restore) remains a refusal, never a reason to
lower generation. After connector intent
but before/after RPC: same attempt only observes and returns saved status; it
never repeats the RPC, since absence of a saved reply proves nothing. If all
resources are gone, existing recovery can also finish from the original host
proof. If the exact original claim remains live, a new preview/approval may
authorize a new attempt after prior ownership expires; retain the old uncertain
attempt permanently. If only residue remains, refuse release and retain capacity.
Concurrent apply/recovery has one DB lease winner; connector run lock serializes
with earlier admitted effects. A newer fence must be checked after waiting for
that lock and immediately before any new remote effect. Fencing does not undo an
already admitted remote call; its target must remain the exact original claim.

Replay within plan validity returns the exact stored attempt receipt only after
strict plan/receipt/identity agreement; a receipt is historical remote-observation
evidence, not a fresh assertion that DB cleanup completed. It never releases a
reservation. Inconsistent binding/reservation state is a refusal;
otherwise it observes an unknown attempt without mutation. Expired approvals
never authorize another effect. Restoration creates a new maintenance_id and
invalidates every old plan/replay before receipt lookup. A newly issued plan
after restore still requires original private journal/fences and exact live
ownership; DB rows alone never prove resource ownership or absence. Preserve
connector_cleanup_identity and tombstones with the separately managed private
journal/fences; absence or mismatch after enrollment is a refusal. The explicit
validated legacy first-preview enrollment above is the only issuance path.
DB restoration must not recreate/reset enrolled identities or their ledgers.

## Remote release authority boundary

Pinned SDK0.1.12 `Client.attach` binds only the saved owner/id/token;
`Sandbox.close` POSTs `/v1/sandboxes/{id}/release` with that token and suppresses
404. `_request` sends once. The platform wrapper forbids another origin,
redirects and environment proxies.

Pinned sandboxd source `5a800317f15554400c989d9de4c5ab5c1cacf7da`
establishes the supported capability boundary: server/server.go:383 passes the
bearer through sandboxCred:611; pool/operator.go:37 resolves a nonempty claim
token; pool/claim.go:514 checks the saved claim token in constant time.
releaseResolved:142 rechecks the resolved claim pointer under its mutex before
deleting that claim, so a competing release cannot teardown that claim twice.
Deletion is committed before cancellation-immune teardown; persistence failure
restores the same claim for reconciliation. Fresh claims receive random ID/token
at claim.go:570. This supports a separately approved new request against the
same capability, not an absolute theorem that random ID/token reuse is
impossible. Never substitute the configured root token: reject an empty handle
token or one equal to the configured sandboxd root credential before admission.
Root authority resolves by ID alone and would defeat the exact-capability guard.

After claim deletion, remove.go:47 queues failed host removal for upstream
retry; a subsequent404 cannot force that host cleanup. That is why absent-claim
partial residue remains observation-only with capacity retained. These source
facts do not prove host absence or make remote effects atomic with the DB.
Root-fetched immutable source evidence is in `.team/evidence/T094-upstream-`
`{server.go,operator.go,claim.go,claims.go,remove.go,server_http.go}` in the task
journal project. Independent review must bind the exact bytes to the pinned ref;
no missing product/retention-policy choice is needed for this narrow mechanism.

## Schema, backup and verification contract

No SQL migration, new DB table, backup parser change or schema pin is needed.
Keep issued plans, attempt intents/receipts and the permanent stop tombstone in
the existing private fsync journal; application code permits append-only attempt
facts and exact replay, never deletion/replacement of old facts. A bounded
journal-cap refusal is not permission to prune it. The DB keeps its existing
maintenance identity, job lease/generation, run/binding/reservation, event and
audit authorities. Add one existing-style audit fact for maintenance admission;
audit retention is not the attempt's replay authority. Existing quiescence
already rejects pending cleanup/unreleased reservations/non-done jobs, including
an admitted attempt. Existing recovery is the only new path to DB cleanup
completion. Native backup excludes the private journal/fences exactly as before;
document that these new permanent facts must also be preserved separately.
Restore must preserve their identity/tombstones, invalidate old DB approvals and
keep all nodes drained. Never rebuild missing journal data from DB rows.
Permanent minimal evidence grows; this slice makes no storage-retention claim.

Phase B starts with actual PostgreSQL/API fixture setup, normal result persistence
and a release fault **before effect**, leaving a live exact VM and started intent;
the missing stale_cleanup API is the RED, not a fabricated terminal SQL update.
GREEN must prove explicit plan/apply releases only that claim once, preserves
terminal result/hash and original uncertain release, retains the reservation
until existing recovery independently confirms all stop proofs, and keeps
another run/unknown VM unchanged.

Negative cases: every active/control/archive-failed state, missing/corrupt private
journal/fence, pending/unobserved allocation, changed ID/token/claim/template/
VM/PID/start ticks/path/scope/resources/generation, live lease, changed issued
plan/expiry/maintenance identity, forged plan, oversized file, repeated apply,
all four individually missing stop proofs, node partition, absent claim plus
host residue and unrelated VM. Real DB/HTTP barriers must cover recovery winning
before apply, apply winning before recovery, expired lease while DB/run-lock
waiting, old in-flight release, takeover before remote admission and takeover
after remote effect/before DB commit. Kill/restart at each durable boundary and
lost ACK must prove same-attempt observation-only replay. A separately approved
second attempt must remain exact-target safe under the pinned server behavior.

Dedicated upgrade fixture: start with an actual current-format legacy journal
produced by normal worker result persistence and a pre-effect release fault,
without hand-adding any new identity. First preview must enroll once, return a
bound plan and complete the approved apply/recovery path. Kill/restart before
replace, after replace/fsync and before preview response; prove the respective
unenrolled-or-same-enrolled identity outcomes without lease/generation mutation
or an extra release. Delete/null/change identity after enrollment while keeping
plans/attempts, remove the envelope while leaving cleanup facts, and mismatch a
plan identity: every case must refuse without silently enrolling or repairing.
Verify private restore preserves the same envelope/identity while new DB
maintenance identity invalidates old plans, and enrollment creates no global
non-run JSON that can break the existing allocation scan.

Native pg_dump/pg_restore must preserve all ledgers/result/control rows, invalidate
old plans, keep drains and reject missing/newer connector state without changing
generation. Run affected real worker/recovery/cancel/controls, private CLI and
backup tests; no new UI means no invented browser gate. Root chooses focused
commands and required CI after implementation freeze. All new jobs use the
shared launcher, distinct task IDs and protected raw evidence. Phase A runs only
static reads/hash/diff and task/report validators; no DB, Docker, VM or live API.
