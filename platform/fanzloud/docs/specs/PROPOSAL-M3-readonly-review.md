# Proposed bounded AP dependency for FN05 — T-0449

Status: proposal awaiting explicit owner approval under SDD§3. Not implementation
permission, no AP source edits or live reviewer execution. T-0442's Fanzloud candidate
read/download portion uses existing APIs; it cannot pass FN05 alone.

## Current gap and precise responsibility

Existing AP `result_archive.py` stores an immutable, run-bound JSON payload in the same
transaction as the writer result. Its authenticated metadata/download endpoints can
supply an exact fixed review input. This archive includes goal, base, profile, diff and
checks; it is not a source tree. Fanzloud verifies and presents its SHA256 without adding
another result authority. Existing M2 subscription drivers expose read/write/exec and
only return coding outcomes. Neither a review prompt nor Workforce's historical native
review route proves the mandatory isolated readonly tool/credential boundary.

Request one bounded AP extension, still under the existing Worker lease, Connector
fence, cancellation and release authority:

1. Authenticated idempotent review admission referencing writer run, archive ID and exact
   archive SHA256, plus the other vendor's pinned profile. AP resolves actual writer
   profile/backend and immutable archive, rejects same vendor/missing/pruned/hash mismatch
   before creating a review run. Client cannot supply arbitrary candidate bytes, mounts,
   host path, command or provider configuration. Persist lineage and round count in AP's
   existing transaction/command framework; same key conflicts or returns prior receipt,
   never launches again after unknown. Fanzloud retains its pre-POST durable intent rules.
2. Explicit review-purpose run using AP's existing lifecycle/lease. In a new isolated
   VM, materialize an independent copy of the fixed candidate archive before tool
   admission; hash-check trusted transfer and enforce filesystem readonly access for
   the repository/tool UID. Candidate-only review reads the complete original task,
   diff and checks; do not claim a full-tree inspection. No access to writer's workspace.
3. Add review capability to the existing trusted subscription bridge: only candidate
   read is advertised. Connector independently denies write/exec/forged operation types
   on review runs, including direct tool requests; CLI built-ins/network/delegation stay
   disabled. Credentials remain trusted-side. Use the accepted exact Codex0.166.0 and
   Claude Code2.1.312 routes unless a separately reviewed pin change is necessary.
4. Persist a bounded structured review result: candidate/run/writer/reviewer references,
   candidate SHA256, verdict (`accept`, `request_changes`, `reject`) and reasons. Verify
   output binds the expected hash; mismatch/malformed/oversize/provider failure is explicit
   failure, not acceptance. Save actual CLI/tool/stop receipts. Review terminal state does
   not change writer success or mark product/task Done. Extend AP result projection/archive
   only as needed to expose this typed review result, preserving existing writer contracts.
5. Explicit operator handoff in the same Fanzloud Web: durable intent before POST, display
   reviewer progress/result on the same candidate, restart GET-only readback. At most one
   explicit rework writer and a second review per lineage; count atomically in AP so new
   keys/reload/concurrent requests cannot reset the bound. No autonomous reviewer loop,
   auto-apply, automatic writer retry or silent third round. Rework is a new isolated
   writer with explicit operator action and frozen parent candidate reference.

## Writable implementation scope after approval

AP: review admission/domain/store migration and API; existing runtime_worker/subscription
bridge/Connector guest preparation/tool gates; typed result archive/projection and focused
regression/security tests; SUCCESS/contracts/board. Fanzloud: review/rework intent binding,
UI and bounded projection/tests. Reference Workforce contracts only; no Workforce changes.
No scheduler, VM manager, new backend authority, API billing, package dependency, general
multi-agent DAG, account pooling, public deployment, release or adjacent project expansion.

## Acceptance and bounded execution proposal

- R01 native/HTTP/DB: same-key/mismatch/concurrency and round ceilings, auth/CSRF, vendor
  mismatch, candidate expiry/hash mutation, lost reply and recovery zero automatic resend.
- R02 actual OS/tools: independent candidate copy matches archive hash; write/exec,
  traversal, secret/cross-workspace and network attempts denied; writer archive unchanged.
  Must prove denial at Connector and guest capability boundaries, not model compliance.
- R03 actual Web: select an accepted real writer result from the other vendor, explicitly
  submit one review, show actual progress and hash-bound verdict/reasons, download and
  reopen exact result after restart. No new writer invocation required for first review.
- R04 deterministic tests prove one explicit rework/two-review ceiling and unknown lock.
  A live rework is only used if the first actual review requests changes; no new writer
  simply to manufacture a round. Retain rejected/malformed/unknown outcomes.
- R05 cleanup/source: pinned versions, input/output hashes, actual AP/VM/run/CLI receipts,
  stop/release/no-reservation evidence, required CI and fresh independent acceptance.

Same previously approved host, maximum one4vCPU/4GiB VM, zero warm capacity, no resource
expansion or other-service changes. At most600seconds per actual invocation; preferred
acceptance uses one reviewer on the retained real writer candidate. At most one justified
correction and second reviewer; if actual rework is needed, at most one new writer (three
new invocations total ceiling: reviewer1 + writer1 + reviewer2). No retry of unknown.
A single20minute live window includes launch, inspection and cleanup; reserve its last
3minutes for stopping/cleanup, no new work then. Missing prerequisite or exceeding the
window stops affected execution and records exact status. This window is a proposal,
not implicit authority to run while waiting.

Estimate120–180 active minutes plus CI after approval,20min progress checkpoints.
One bounded AP implementation worker and one independent reviewer at most; no recursion.
Same failure at most two evidence-based corrections; no unchanged green replays. Build25min
and CI observation30min bounds. Provider requests/tokens/cost remain unknown. Existing
M1/M2/M3 evidence and dirty workers stay intact; no old Cloud catalog investigation.

This is the necessary remaining FN05 dependency within existing M3, not a new milestone.
Full FN04/FN07 and whole-MVP claims still require their own outstanding actual evidence
and owner operation confirmation. Approval of this proposal does not grant deployment.
