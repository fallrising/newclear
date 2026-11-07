# M1c — sealed human reports and atomic submission

Status: accepted plan and locally verified implementation after Claude plan/code REWORK and revised ACCEPT (2026-10-31). Delivery: BOARD HM1C. Desk T-0339.
Source `9e536de1dc1a532c8e3d78355e770bc757e190da`. Supports H02 / SUCCESS AC-02, not full acceptance.
The newer [Session proposal](../sdd/session-control-room.md) and [provider path](provider-critical-path-20261030.md)
retain M1c and Fake-only. They do not enable L1 or change accepted completion predicates.
Authority: [remaining work M1](remaining-work-20261029.md),
accepted domain/security/integrity contracts and existing exact-subject publication guards.

## Outcome and scope

An authenticated operator explicitly submits bounded report text for an exact current completion
subject. The service seals and verifies bytes, then atomically records immutable report provenance
and a separate human Review or Evidence. The original command result survives response loss/restart.
The operator can read the recorded metadata and safely download its bytes by scoped report ID.
Uploading material is not an automatic successful Run, approval, phase transition or Done verdict.

One new command, `SubmitHumanReport`, uses existing project commands, CSRF/session/project checks,
idempotency, canonical results, audit and projection infrastructure. Do not add a general upload
service, runtime dependency, real verifier/provider, M2 policy configuration, UI or cleanup daemon.
Existing fixture commands and their canonical bytes remain unchanged. They remain fixture APIs;
the new human path accepts content and explicit intent, never a browser-supplied verified locator.

## Command and material contract

- Standard command envelope and metadata; expected WorkItem version positive and below signed-int64
  maximum. Payload: `work_item_id`, `run_id`, `report_id`, `completion_subject_digest`, `lease_epoch`,
  `restore_generation`, `kind`, `media_type`, `content`, and exactly one matching `review` or `evidence`.
- `report_id` matches `report_[0-9A-HJKMNP-TV-Z]{10,26}` and is immutable/project-scoped. Reuse that
  identifier as the created Review/Evidence ID in its distinct table; a report cannot have both kinds.
- `kind=review`: `review={verdict: Approved|ChangesRequested}`. Service computes independent human
  actor and current server timestamp; ChangesRequested maps to the existing rejected Review state.
  Only Review phase is allowed; `kind=evidence` permits Review or QA.
- `kind=evidence`: `evidence={ac_id,ac_revision_digest,recipe_digest,environment_digest,verdict:Passing}`.
  The operator explicitly asserts Passing. Require the exact bound AC revision and configured human
  verifier rule/recipe/environment; derive Accepted/Fresh/Present internally only after validation.
  Require rule.VerifierClass=`human`, rule.Independent=true, nonzero exact rule environment and exact
  configured recipe. Derive VerifierClass/VerifierRole=`human`; deny a principal equal to the producer
  lease holder or prohibited verifier actor, or when the prohibited verifier run role is `human`.
  Persist Evidence Passed/Current/Present with the sealed ArtifactDigest; command and DB labels differ.
  Unknown/non-human/zero-environment policy fails403 before Put; general policy/negative lifecycle is M2.
- Content is nonempty valid UTF-8, 1..65536 bytes, no NUL. Preserve exact bytes, including whitespace
  and line endings. Only literal `text/plain` or `text/markdown`; no charset parameters/active MIME.
  This narrower human-input limit does not change existing artifact semantics or the 10MiB store cap.
  Worst-case JSON escaping of the maximum text remains within the existing 1MiB command envelope.
- Reject duplicate/unknown/null/missing members, wrong kind arm, actor/verifier fields, timestamps,
  locators, caller digest/availability, integer overflow and noncanonical identities before material I/O.
  Digest and byte length come only from submitted bytes; identity/time/class come from authenticated service.
  Pinned Go1.27 encoding/json/v2 rejects raw invalid UTF-8 and unpaired surrogate escapes by default;
  never enable AllowInvalidUTF8. The root's actual stdlib probe confirms all three refusals and a valid
  surrogate pair. NUL is legal JSON but explicitly rejected after decoding. No custom permissive parser
  or normalization is introduced; tests assert exact decoded bytes for equivalent valid JSON escapes.
- Success adds operation-specific `report_id` and `report_kind` to the canonical result, with type
  `HumanReportSubmitted` and existing project/item/run/version/phase. Old results serialize identically.
  report_id/report_kind use omitempty and are rejected on every other operation by canonical validation.

## Ordered write protocol

1. Authorize operator/project, validate/canonicalize input (including exact content digest/length/type
   and all intent fields), then replay stored result before any file I/O. Same intent returns original
   bytes/correlation; changed bytes/type/subject/kind/intent under the same key conflicts. Expiry keeps
   existing rules. Replays do not republish bytes or duplicate any rows/events.
2. In a short transaction check current WorkItem/Run/candidate/subject/version/lease/restore generation,
   current accepted input and policy, actor independence and evidence rule where relevant. Check report-ID
   collision, existing global artifact metadata and command-result identity before Put. Identical bytes
   with differing MIME fail storage_corruption; never overwrite global digest metadata. Capture all material needed for final revalidation.
   Also reject an existing fixture Review/Evidence with the intended semantic ID. Wrong scope, stale
   identity, bad policy or unavailable capability performs no Put. New-command fence mismatch is
   explicitly409 stale_subject; old fixture422 behavior stays unchanged.
   Admission is metadata-only: prospective Review/Evidence/artifact collections and per-subject report
   rows must each fit1024; candidate plus all Evidence artifact metadata count includes a new digest.
   Deduplicated candidate + policy-eligible Evidence + proposed Evidence objects must fit1024unique
   objects and50MiB declared bytes under the existing integrity eligibility predicate. A review report
   is not added to the Done byte set. Refuse prospective overflow422 lifecycle_rejected before Put;
   recheck in step4. Do not reopen existing candidate/Evidence bytes here or alter Done predicates.
3. Outside the writer transaction call ArtifactStore.Put on bounded bytes. Compare returned digest and
   length to locally computed values, then Open/read/hash/length/Close verify the actual sealed object.
   Cancellation wins; failed/partial Put or verification never creates an accepted report/Review/Evidence.
   Step2 preflight refusals and step3 storage/cancellation failures return without command-result or
   idempotency rows. A healthy same-key retry may Put again using existing safe digest deduplication.
4. Through the existing execute transaction, replay again for races, then reread the same exact current
   subject/input/fence/version and relevant material. Metadata collision with an existing digest fails
   closed. Any guard change after file I/O rejects without domain publication.
5. Store/reuse immutable artifact metadata; create the separate Review/Evidence and immutable human
   report association; append the existing command result/idempotency/audit/projection atomically.
   Any late failure rolls back all database writes (use existing rollbackMutationError convention).
   No executor outbox, dispatch, phase or WorkItem version change; publish a normal work_item refresh.
   Report-ID collision under a new intent returns idempotency_conflict, never silently replaces it.
   Only final execute-transaction rejections use existing recordableFailure rules: version_conflict,
   stale_subject, lifecycle_rejected and done_gate_unsatisfied are recordable. A first-discovered
   metadata collision503 storage_corruption and ID collision409 idempotency_conflict are NOT recorded;
   the root/worker checked the actual helper rather than the reviewer's broader assumption. Late mutation/DB
   failures roll back result/idempotency too. Replays acknowledge a previously recorded decision,
   not transient unrecorded storage failures. Concurrent in-flight calls may both Put identical bytes,
   but only one canonical result/report/semantic record/audit/event commits.
   Capacity admission uses the same currentCompletionMaterial collections as completionSnapshot;
   do not substitute a narrower subject-only query for those collection limits. The extra report-row
   limit is per subject. A same-version work_item refresh follows fixture convention; no new UI
   consumption behavior is claimed by this backend slice.
   The existing web stream invalidates by newer projection cursor, independent of resource_version;
   a same-version event still refreshes the existing board, but no report UI is added.

Filesystem and SQLite are not one transaction. A sealed object may survive a canceled/stale/failed
commit as an unreferenced object. It grants no read authority or Evidence/Review and is never deleted
automatically. Existing staging cleanup remains; no per-request unlink can race a shared digest.
Retain immutable bound reports for the database lifetime. M6 must include all report objects in
backup/restore manifests; future explicit offline mark/sweep must account for every binding and
in-flight publication. No GC or operator-data restore is introduced here.
The current confined store uses hard-link publication; ADR-005's older atomic-rename wording is a
known implementation-description discrepancy. M1c reuses the current tested mechanics without changing
that ADR or claiming a rename implementation.

## Persistence and reads

Append migration0005; preserve0001..0004 bytes/checksums. Add immutable scoped human-report rows with
project/item/run, exact completion subject, actor, kind, artifact metadata/digest, observed server time
and historical lease/generation. Constraints/joins verify Run belongs to WorkItem/project and the
separate matching Review/Evidence agrees with subject/actor/artifact. Narrow optional port capability;
use kind-specific nullable composite foreign keys plus exclusive-kind CHECK. Review has no artifact
column: its report association owns that digest; Evidence must also agree with its artifact column.
Report-row UPDATE/DELETE abort unconditionally. Existing semantic ID validators accept the report prefix.
legacy in-memory command-only implementations fail capability checks for this new operation.
Test fresh v5, v4-to-v5 preservation, reopen, migration failure rollback and immutable constraints.

`GET /api/v1/projects/{project_id}/human-reports/{report_id}` returns closed metadata (no raw content):
project_id, work_item_id, run_id, report_id, kind, completion_subject_digest, actor_id, created_at,
lease_epoch, restore_generation, and artifact {sha256,media_type,byte_length,availability:Present,
href,disposition:attachment}. href points to the same scoped path plus `/content`.
Read immutable historical metadata without requiring the current head/version/lease; scope/association
corruption fails closed. The list of all reports and global-hash authorization are outside this slice.

`GET .../human-reports/{report_id}/content` resolves that report in the authenticated project first,
opens outside SQLite, bounds reads to65536+1, verifies digest/length and same immutable record after I/O.
Return the existing fixed attachment security headers: application/octet-stream, digest filename,
quoted SHA ETag, no-store, nosniff, CSP sandbox/default-src none, same-origin resource policy,
Accept-Ranges none and exact Content-Length. No Range/If-None-Match shortcut. Final context/session
revocation check precedes bytes. HEAD authenticates/validates identity then405 without material reads.
Noncanonical escaped/doubled/dot resource paths follow M1b's strict behavior, not redirect disclosure.

Errors use existing codes: malformed input400 invalid_request; authentication401; denied project or
missing scoped report404; unauthorized human/independence/rule403; stale/version/idempotency409;
unsupported command capability503 capability_unsupported (non-retryable); lifecycle422. Missing
read capabilities retain M1b's projection_unavailable convention. Opaque store Put/Open errors503 projection_unavailable;
service-detected mismatched bytes/metadata/read/close errors503 storage_corruption; actual cancellation
503 projection_unavailable. No submitted report content, paths or internal storage errors in responses.
Historical metadata does not guarantee byte availability. Stored success replay remains an acknowledgement
even if bytes later disappear; a subsequent download fails closed and current evidence integrity guards
still reject missing report bytes at completion.

Existing Done predicates remain unchanged: Evidence reports are verified by the current integrity gate.
A human Review report is retained provenance, not a newly invented Review-byte completion predicate.
Existing fixture publication contracts are not retroactively changed or relabeled as this new API.

## Fixed acceptance cases and verification

- REPORT-AC-01: strict authenticated command boundary; exact subject/version/fence/AC/policy/actor
  refusals before Put; content/type/size edges and forged locator/identity rejected.
  `TestHumanReport_CommandBoundary` and `TestHumanReport_PreflightGuards` start as compiling Red.
  Include non-human/zero-environment/prohibited verifier policy, raw invalid UTF-8, lone high/low
  surrogates, escaped NUL, valid pair and max-size maximally escaped content within the1MiB body cap.
- REPORT-AC-02: `TestHumanReport_SealReplayAndScope` covers both kinds through real SQLite/service/HTTP,
  real sealed bytes, digest/actor/scope records, response loss, duplicate concurrent intent, restart and
  byte-identical replay. One report plus separate Review/Evidence/audit/result/idempotency/projection;
  no phase/version/outbox/Done changes. Same key changed content conflicts, no new Put on replay.
- REPORT-AC-03: `TestHumanReport_StorageFaultsAndRollback` covers Put/Open/read/Close/cancel faults,
  post-I/O stale snapshot, late DB failure, metadata collision and orphan non-authority. Original state
  and all relevant table snapshots prove rollback; no deletion of shared sealed objects.
  Assert presence/absence of command-result/idempotency per failure class and healthy same-key retry.
  Assert exact codes, unchanged-version material drift and count-only report drift after Put; a
  version bump alone proves version_conflict, not the final stale-subject snapshot comparison.
  Include metadata-only at-limit/limit-plus-one count/unique-object/50MiB admission tests, replay at cap,
  and final-transaction capacity change. Exact MIME collision returns503 storage_corruption deliberately,
  consistent with immutable global metadata; no overwrite or misleading new Present row occurs.
- REPORT-AC-04: `TestHumanReport_ReadAndDownload` covers historical reads, cross-project/missing ID,
  tamper/missing/symlink/length failure, safe headers, HEAD and cancellation/revocation. Include actual
  confined runtime store integration, repeated GET/reopen and zero read-side table/directory writes.
- REPORT-AC-05: `TestHumanReport_Migration` covers fresh/upgrade preservation/reopen/failed migration
  rollback/constraints. Existing full completion and fixture canonical compatibility tests remain green.
  Also exercise real human Review/Evidence through RequestQA/ApproveSubject/CompleteWorkItem,
  proving report semantic IDs/role survive domain rehydration and appear in completion joins.
  Missing human Evidence bytes must yield evidence_unavailable with no completion row;
  ChangesRequested must retain the existing review_rejected gate.

Root gates: pinned backend script (format/vet/full/race/build), unchanged pinned web gates, fixed
OpenAPI lint, project/index/document/task validators, independent Claude code review and required
final-head PR CI. Named tests now have actual focused/race/full logs in the evidence report; final-head
CI and remote delivery are recorded in BOARD. No new browser acceptance is claimed.
Root owns plan/API/docs and acceptance; one bounded native implementation leaf after plan acceptance.
Claude plan/code: claude-opus-5-5 high, installed CLI safe-mode/no tools,480s each, at most one revision
follow-up each. Root90–120active minutes with20minute checkpoints; worker45minutes; CI20minutes/round.
Original failures remain retained. Aggregate tool/provider/actual cost stays unknown unless measured.
