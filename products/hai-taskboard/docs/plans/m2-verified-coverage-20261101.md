# M2 verified coverage — proposed bounded contract

Status: **Proposed; Claude plan REWORK → ACCEPT for owner presentation; owner decision required before production/API changes.**
Task: T-0339 / BOARD HM2C. Source: `d3207b3a97a5b223da501af1418e64e94745bf10`.
Identity (#854/#855) and immutable project policy (#868/#880) are delivered. This proposal does
not reopen those decisions or close full M2, completion UI or SUCCESS AC-02..04.

## Goal and authority

Give an authenticated operator a complete, bounded observation of which required ACs have verified
current evidence for one candidate, and separately whether the current QA material satisfies the
completion eligibility rules. A read never creates evidence, allocates IDs, reserves a result,
consumes an approval or authorizes completion.

Sources: [accepted domain coverage](../sdd/domain-and-gates.md#evidence-coverage),
[Done requirements](../SDD.md), [M2 remaining work](remaining-work-20261029.md),
[pending coverage contract](m2-ac-identity-20261031.md#pending-coverage-contract),
[preparation](../sdd/completion-preparation.md) and
[immutable project policy](../sdd/local-project-policy.md).
The accepted requirements demand verified per-AC coverage; the prior plan explicitly leaves the
wire contract, bounds and race oracle unaccepted. This document fixes that missing proposal.
Proposed precise amendment to the accepted domain coverage paragraph (apply only after owner acceptance):
“In P0-A V1, Accepted disposition means an admitted immutable semantic Evidence record created through
existing command/provenance validation, rather than an unadmitted Run output. Fresh applicability maps
to stored Current. Admission is not a Passing verdict; every existing verdict, exact-subject, availability
and independence check still applies. There is no separate editable disposition field in V1.”
This makes the vocabulary mapping explicit; it does not erase the accepted condition. No policy redesign.

No open HAI PR or changed HAI source was found at intake; the latest HAI commit remains #880.
Session/provider control-room designs remain Proposed and do not alter this Fake-only slice.

## Proposed contract COV-01: scope, route and phases

Add `GET /api/v1/projects/{project_id}/work-items/{work_item_id}/candidates/{candidate_id}/verified-coverage`.
Use the existing session, project authorization, canonical path, Host, read Origin semantics,
resource identifier predicates and `Cache-Control: no-store` from completion-preparation.
Authorize before material lookup. No query parameters, body, client actor, client policy or subject
selection. Actor is the authenticated operator. No new permission or dependency.

An absent candidate/Run or wrong candidate scope returns 404; no subject can be constructed.
A present valid candidate with unavailable artifact bindings/bytes can still produce an unsatisfied
observation. Do not reuse preparation's early CandidateAvailable rejection.

Support Review and QA only. Other phases, including Done, return `422 lifecycle_rejected`;
historical Done applicability is a separate future read, not inferred from current coverage.
In Review use the same prospective QA subject as preparation (actual version + 1), labeled
`subject_mode: prospective_qa`; report evidence for that exact subject, without pretending the
WorkItem is already QA. Missing evidence in Review means no matching observation, not a failed test.
The current human-report service permits Evidence in Review (human_report.go checks Review-only only
for kind=review); thus prospective coverage can be meaningful before RequestQA. Human reports require the human/independent/environment rule; any future automated-class policy
may normally remain evidence_missing before QA. This does not enable automated verifier execution.
No auto-verifier is started by this GET. In QA use its current subject and `subject_mode: current_qa`.

## Proposed contract COV-02: closed response

A successful response has exactly these required fields; false booleans and empty arrays are explicit.

| Field | Value |
| --- | --- |
| schema_version | integer 1 |
| observation_only | boolean true |
| observed_at | UTC RFC3339Nano timestamp sampled during final revalidation |
| expected_version, phase | actual WorkItem version and Review or QA |
| subject_mode | prospective_qa or current_qa, consistent with phase |
| completion_subject, completion_subject_digest | same exact subject codec and digest as preparation |
| lease_epoch, restore_generation | positive SQLite-safe integers from verified Run authority |
| cursor | existing `{stream_epoch,event_sequence}` high-water from the same final DB snapshot; positive epoch, nonnegative SQLite-safe sequence |
| approval_required, verification_rules | same complete selected-project rules as preparation |
| coverage | one entry per required AC, ordered by exact AC bytes |
| completion_eligibility | object described below |

Each coverage entry has exactly `ac_id`, `ac_revision_digest`, `covered` (boolean),
`matching_evidence_ids` (sorted unique IDs), and `reasons` (ordered unique codes).
Evidence IDs retain exact bytes, at most120 UTF-8 bytes with no control characters; invalid stored IDs fail closed.
IDs refer to *all* matching evidence, including nonpassing observations; an ID is not proof of success.
Matching means exact AC/revision, subject and verifier class, using completionInput's authoritative
selection. Wrong revision/subject/class does not match. Recipe/environment mismatch maps to stale;
missing or unverifiable material maps to unavailable. Preserve exact Unicode identities.

`covered` is true iff there is at least one match and every matching observation satisfies the
existing evidence predicate: Passed, Current, Present with verified digest, allowed class and
independence. A matching Failed/Skipped/NotRun/Unknown/Error/Inconclusive, stale, unavailable or
prohibited verifier blocks the AC even when another matching record passes. Do not introduce
latest-wins, any-pass-wins, placeholder Evidence or a new Accepted-disposition field.
Reasons are the existing evidence codes in this fixed order: `evidence_missing`,
`evidence_unavailable`, `evidence_stale`, `evidence_nonpassing`, `verifier_not_independent`.
Missing has no matching IDs; covered has empty reasons. Multiple failures remain visible.

`completion_eligibility` has exactly `evaluated` (boolean), `satisfied` (boolean), `reasons` (array).
In QA, evaluate the authoritative completion eligibility predicate against the final material and
server actor/time: phase/version, blockers, active/unknown Runs, candidate, exact subject, Review,
every required check and actor-bound unexpired Approval. `satisfied` iff no reasons remain.
In Review return `evaluated:false`, `satisfied:false`, `reasons:["phase_not_qa"]`; do not simulate
RequestQA, future approval validity or the current QA predicate. Per-AC coverage is still evaluated
for the explicitly prospective subject. No `can_complete` field or future-success guarantee.

Feed byte outcomes into the assembled domain input before evaluation: candidate binding/byte failure
sets CandidateAvailable=false; each evidence byte failure sets that Evidence availability=Unavailable.
The shared predicate emits codes in their existing positions/order with existing deduplication.
Use the existing selected Review (last created_at_ns/review_id) and Approval selector (approval_id order,
first unexpired, otherwise first expired; exact server actor/command/subject). Do not change selection.
QA's self-selected subject/version cannot return subject_stale/version_conflict as successful eligibility
reasons; concurrent changes return the HTTP stale error instead. Review does not evaluate blockers,
Review/Approval eligibility or separate active/unknown Runs; those are not claimed to be clear.
`completion_record_missing` is not a read eligibility reason: it remains a command-only construction
invariant, checked before committing Done. IDs are allocated only in the mutating command.

## Proposed contract COV-03: material and consistency

Capture bounded immutable completion material, accepted-input identity, selected project policy,
Run authority/fences and exact subject in a short transaction. Use the preparation classification
for incomplete policy, stale captured/current identity and corrupt canonical material.
In each transaction first load candidate/Run/current accepted-input material and construct the subject,
then load completion material with that exact SubjectDigest (prospective in Review), captured RunID and
accepted GraphRevisionDigest. Current SQLite queries already filter Evidence/Reviews/Approvals by
exact digest; a zero digest loads none, not all history. Do not evaluate that first-stage empty result.
Both stages and the cursor use the same transaction/connection; no gap between subject and rows.
More than1024 historical rows for other subjects must not consume this subject's capacity. Snapshot includes Reviews, Approvals, evidence verdict/applicability/availability,
artifact bindings and counts, blockers and active/unknown Run status, not just WorkItem version.

Verify all candidate bindings and the exact eligible evidence object set outside SQLite writer
transactions. A covered=true AC requires successful byte verification in this read independently of
phase or candidate availability. Do not reuse verifyCompletionMaterial's early-return gates that skip
bytes in Review or when the candidate is unavailable. Reuse the object verification primitive/filter.
The evidence byte filter is: required exact AC/revision, requested subject, matching class, Passed,
Current, Present, exact recipe/environment and a Present artifact row. This includes non-independent
records (the command verifies them too; the predicate still rejects independence). Nonpassing/stale
records need no read to establish failure; missing artifact metadata makes them unavailable.

Visit candidate artifacts by digest, then eligible evidence by evidence_id, matching current SQL order.
Deduplicate by digest and reject conflicting metadata as corruption. Count every distinct attempted
object and its declared bytes against the read budget before I/O, even if unavailable; remember each
outcome for repeated digests. Never exceed1024 opens or50MiB declared payload; per-object cap10MiB. Each bounded
read may probe one extra byte to detect oversize, so the absolute read ceiling is50MiB+1024 bytes.
An over-limit object is unavailable without I/O, consumes no remaining budget, and iteration continues
so every AC receives an outcome; a later smaller object may fit. Candidate and evidence sharing a
failed/over-limit object share unavailable. This reader accounting bounds failed work as well as success;
the command retains its existing first-failure/accounting behavior. On a dataset where the command
could pass, all objects fit and eligibility must agree. Do not label budget exhaustion storage corruption.

A candidate binding/byte failure adds candidate_unavailable only to eligibility, not to unrelated ACs.
No digest binding to the candidate digest makes the candidate unavailable. Review attachments remain
semantic approvals, not a new byte-verification prerequisite. Unknown/cancellation/I/O aborts the
projection as defined below; byte verification never proves filesystem atomicity or reserves material.

Re-read the full bounded material and compare identity, policy, authority, subject and every collection
before publishing. Revalidate after definitive artifact failures and non-cancellation unexpected I/O failures; a known
concurrent change takes precedence over either obsolete observation. Cancellation prevents final read
and returns503. If the first snapshot succeeded, later not-found, lifecycle or incomplete-policy failures
are409 stale_subject, including concurrent Complete to Done (not422) or deleted candidate (not404).
Corruption remains503 storage_corruption; unknown final DB errors remain503 projection_unavailable. Unchanged versions with changed evidence/approval/artifact counts or
fields must be caught. Return `409 stale_subject`, never a mixed or partially successful response.
Sample clock at final revalidation for approval expiry and observed_at. Capture the existing stream
epoch/high-water in that same DB transaction (HAI-API-004), never via a later independent read.
Unrelated global event-sequence advance alone is not a stale subject; return final high-water.
Both snapshots capture cursor, and unit.Within uses one consistent SQLite transaction for all its
loads (the current short immediate transaction is permitted; no artifact I/O inside it).
An epoch change or relevant material/restore change is stale. Existing SSE gap/reset behavior remains.
No automatic retry.
Bytes verified outside the transaction can change afterward; no reservation or filesystem atomicity
is claimed. A subsequent CompleteWorkItem must verify its own bytes/current material again.

The existing preparationSubject rejects ActiveOrUnknownRun before constructing a subject. Extract
only its pure subject construction for this reader, preserving preparation/command guards. A present
Succeeded/None/Confirmed candidate Run plus a separate active/unknown Run must return the relevant
eligibility reason in QA, not disappear behind a preparation lifecycle error. The candidate's own Run
must still be Succeeded/None/Confirmed, otherwise return 422 lifecycle_rejected.

Use shared pure evidence/eligibility evaluation and material verification; do not copy a second Done
predicate into the reader. Refactor completionInput into nonallocating assembly plus command-only ID
allocation. Extract command eligibility separately from completion-record construction validation,
keeping CompleteWorkItem's existing reason order, error precedence, replay bytes and allocations on
command paths. A shared verifier may collect object availability outcomes for projection while the
command preserves its existing first-failure error behavior. No command canonical bytes change.

## Proposed contract COV-04: bounds and errors

Reuse the existing 1024-record limit per material collection, 1024 unique verified objects,
10 MiB/object, 50 MiB total unique verified bytes, and 1 MiB encoded response maximum. Required ACs
are bounded by the existing256-AC accepted-input path; a stored greater count is storage_corruption; do not widen admission. Evidence ID references
are bounded by the 1024 loaded Evidence records, not 1024 per AC. Never truncate or paginate away a
blocker. These are admission limits, not throughput promises. Boundary tests cover exact/plus-one.

Missing session:401 unauthenticated. Invalid/scope-mismatched/unauthorized IDs:404 not_found.
Noncanonical path or supplied query:400 invalid_request. Unsupported phase:422 lifecycle_rejected.
Missing optional reader:503 projection_unavailable. Malformed persisted material, inconsistent object
metadata or record-count/encoded-response capacity overflow:503 storage_corruption; object/byte budget excess is unavailable as above. Unknown/cancelled dependency:
503 projection_unavailable. Introduce port.ErrArtifactUnavailable for definite size/digest/confinement rejection; recognize
errors.Is(err, fs.ErrNotExist) as definite absence. The local adapter in cmd/taskboard/local_dependencies.go
wraps explicit trust/type/link/identity rejection in that sentinel; retain unexpected OS errors and
context cancellation. The shared read/hash primitive uses the same sentinel for length/digest mismatch.
Existing command wrappers preserve their previous sanitized errors, reason lists and canonical replay;
this typed distinction changes only this reader's classification. An unexpected I/O failure is503 for
the read even where the existing command returns done_gate_unsatisfied/_unavailable. This divergence
is explicit in the owner decision and regression matrix. Do not turn every arbitrary verifier error into missing bytes. Current but incomplete policy:409 policy_rejected with fixed reason
verification_policy_incomplete. Changed comparable identity/material:409 stale_subject.
Corruption/stale/incomplete-policy precedence follows HAI-PREP-004, with race revalidation before
returning artifact availability observations. Definitive missing/tampered candidate/evidence bytes are
successful observations with unsatisfied eligibility/coverage, not transport success for completion.

Error precedence is ordered: (1) canonical request/auth/scope; (2) first-snapshot persisted corruption;
(3) comparable captured/current identity stale; (4) unsupported phase or candidate Run lifecycle;
(5) current incomplete policy; (6) external verification then final revalidation—final corruption wins,
then final relevant drift/not-found/lifecycle/policy→stale, then unknown DB/I/O→projection_unavailable;
(7) stable definitive byte/budget outcomes yield200 observations. Cancellation immediately yields503.
No precedence claim requires completing reads after cancellation. Candidate metadata storage-key/digest
inconsistency is corruption here, consistent with completion; preparation's existing404 remains unchanged.

The HTTP adapter validates a closed schema, all required fields and exact scope, byte bounds,
subject digest, sorted identical AC/rule/coverage sets, IDs/codes, phase/mode/version and boolean/reason
consistency before emitting any bytes. Reject unknown/duplicate/null fields, invalid UTF-8, nonfinite
or unsafe numbers, malformed digests, oversized response and fabricated all-green contradictions.
Explicit consistency checks: covered iff reasons is empty, and covered requires nonempty IDs;
evidence_missing iff IDs empty and it is the sole reason; AC reasons are a subsequence of the fixed
five-code order. Review iff prospective_qa/evaluated=false/satisfied=false/[phase_not_qa], subject version
actual+1 without overflow. QA iff current_qa/evaluated=true, subject version actual. QA satisfied iff
eligibility reasons empty; satisfied implies every AC covered. Each uncovered AC's reasons must occur
in QA eligibility reasons. completion_record_missing is forbidden; subject_stale/version_conflict are
HTTP errors, not successful read reasons. All numeric fields are SQLite-safe and cursor epoch positive.
The adapter checks structure/consistency, not artifact bytes; service remains the verification authority.

Worst-case response budgeting must be tested with maximum-length legal escaped strings,256 ACs and
1024 unique evidence IDs. A conservative allowance is900592 bytes:184320 for three repeated escaped
AC IDs,192512 for escaped verifier/actor/role fields,245760 for escaped evidence IDs,128000 for per-AC
syntax/reasons,150000 for digests/subject/scalars and remaining syntax. Encoded response still hard-fails
above1MiB; the implementation must verify this allowance against its actual closed serializer rather
than accepting it as measured capacity. No silent truncation. Stored IDs above120 bytes fail closed.

Sanitized APIError messages only; no object paths, report bodies, secrets or raw dependency errors.

## Fixed acceptance proposal and implementation sequence

The following IDs freeze this proposal; all product oracles are **NotRun / not implemented**.

| AC | Given / When / Then | Named oracle |
| --- | --- | --- |
| COV-AC-01 | Auth/scope/phase and strict bounded HTTP response; reject malformed data before disclosure, no-store on all responses | TestVerifiedCoverageHTTP_AuthScopeAndWireContract |
| COV-AC-02 | Real accepted multi-AC Unicode/custom-project policy and actual sealed reports; every required AC returned, exact identities and deterministic IDs/reasons, other-project rules never apply | TestVerifiedCoverage_ExactSubjectAndProjectPolicy |
| COV-AC-03 | All evidence states, mixed pass/fail, class/revision/subject/recipe/environment/independence, missing/tampered bytes; frozen-material per-check reasons equal shared predicate; QA satisfied iff command could pass (not equal first-failure error lists); Review remains prospective and not evaluated | TestCoverageProjection_MatchesCurrentDonePredicate |
| COV-AC-04 | Read twice/reopen; zero domain/result/audit/projection/outbox/consumption changes, counting ID-source fake and executor counters remain zero; snapshot all authoritative tables including allocator metadata; QA positive read followed by explicit Complete produces exactly one record | TestVerifiedCoverage_NoWritesOrAllocatedIDs |
| COV-AC-05 | Pause verification, mutate each material/fence/identity class including same-version field/count drift; stale response, including concurrent Complete→409; no mixed result; expiry uses final time; high-water shares final snapshot and epoch fencing; concurrent writer progresses during artifact read | TestVerifiedCoverage_RevalidatesAfterExternalIO |
| COV-AC-06 | Full backend format/vet/test/race/build, web regression, OpenAPI lint, docs/contracts/indexes, Claude plan/code acceptance and exact-head CI/merge/readback | Milestone evidence and BOARD |

COV-AC-03 additionally covers Review and unavailable-candidate unverified-byte traps; shared/missing/
failed objects and exact/plus-one budgets in visit order; typed not-found/mismatch/confinement vs EIO/
cancellation; all Review/Approval/blocker/active-Run reasons separately from per-AC reasons. The byte
outcome map is injected identically into pure predicate/projection comparisons; a separate real-store
positive proves GET then Complete succeeds. COV-AC-02 includes >1024 other-subject historical records.
COV-AC-05 includes first-success/final-lifecycle/not-found/policy and cancellation without final read.
COV-AC-04 repeated reads compare all stable fields except observed_at (fixed clock when byte equality
is asserted); same-process reopen is not crash/backup/restore proof.

First accept this proposal, then add normative mini-SDD/OpenAPI and compiling named test skeletons;
retain meaningful missing-route/nonallocating-read Red before production implementation. New interfaces
may require minimal stubs to compile; report this exception. Root owns implementation/review integration.
Use existing real SQLite/Fake/HTTP/local artifact fixtures for integration. No UI, browser acceptance,
new migration/dependency, real provider, activation, backup/restore, release or deployment.

Required commands after implementation: unchanged `bash scripts/check-backend.sh`,
`bash scripts/check-web.sh` in the product; pinned Redocly lint; root
`python3 scripts/check_project_success.py`, `python3 scripts/check_indexes.py`; document links and
`git diff --check`. Relevant existing completion/preparation/replay suites must remain green.
Approval consumption/replay/Done history and immutable migrations 0001..0006 remain unchanged.

## Follow-up precision conditions (carry into normative text before Red)

Claude follow-up ACCEPT specifically permits resolving these without another plan-review round:

- R1 object sequence: validate storage identity/conflicting metadata; reuse seen outcomes; zero digest,
  non-Present or >10MiB becomes unavailable without charge; exhausted remaining object/byte budget
  becomes unavailable without charge; otherwise charge one attempt/declared bytes before I/O.
  Record every outcome for deduplication. Commands still charge successes and stop at first failure;
  agreement on command-passable datasets is the oracle, not equality of failed budget accounting.
- R2 local adapter preserves Lstat and Lstat→Open not-exist causes via wrapping, including the race.
  Object size/link/type/identity failures use ErrArtifactUnavailable; short reads without an I/O error
  are mismatch. Nil/closed store, changed root identity and invalid store invocation are503 faults,
  not per-object unavailability. Extract a cause-preserving read/hash primitive; command wrappers keep
  their old external classification. Test fakes use the same typed contract. Any non-completion caller
  of the adapter gets focused regression to prove its existing error classification remains intact.
- R3 the reader's incomplete-policy check also covers empty verifier class and missing rule/environment,
  before assembly; it returns policy_rejected, never done_gate_unsatisfied. Comparable zero/changed
  graph identity is stale; corrupt identity/invalid persisted evidence/review/approval is corruption.
  Pure assembly errors map into the same precedence ladder, never leak raw text.
- R4 extract one pure per-requirement evaluator called by both command and reader. Per-AC reason
  *sets* equal that evaluator, rendered in the fixed five-code order; overall eligibility keeps
  existing per-evidence emission order/deduplication. No duplicate evidence predicate.
- R5 stage-2 material is authoritative. Recompute its subject and require exact equality to stage-1
  inside the same transaction, else corruption. Compare stage-2 snapshots across external verification.
- R6 first-snapshot incomplete policy returns409 immediately with no artifact I/O/second read, after
  corruption/stale/lifecycle precedence. This deliberate point-in-time error differs from preparation's
  two-read incomplete-policy handling; an initially successful snapshot still follows full revalidation.
- R7 short immediate DB transactions end without domain/auxiliary writes. Concurrent writer progress
  is required during the external artifact-read window, not while SQLite's short transaction holds its
  reserved lock. Snapshot every authoritative table and allocator row; filesystem WAL bytes are not
  promised identical.

## Decision and review boundary

Owner may accept together or decide D1–D3 separately: D1 explicit V1 disposition/freshness mapping;
D2 Review prospective plus QA current support (alternative: QA-only removes prospective wire/invariants
and Review cases); D3 unexpected-I/O503 on reads while commands retain unavailable (alternative:
classify read I/O as unavailable too, losing unknown-versus-definite distinction). The recommendation
is all three as written, together with COV-01..04 and COV-AC-01..06 as the bounded verified-coverage
contract, including Review prospective versus QA current semantics, all-matches veto, observation
of missing/tampered bytes, unknown-I/O503 versus unchanged command classification, and limits above. Existing policy design and Git delivery authority need
no new approval. If this is accepted, implement and complete the authorized delivery chain.
Until then, only proposal/documentation/review/ledger work proceeds; no runtime/OpenAPI amendment.

Claude Code uses exact claude-opus-5-5/high, supplied public-source packet, no tools/MCP/hooks/skills,
no session persistence or children, 480-second process-group deadline. Plan and later code review each
allow one initial and at most one materially revised follow-up; no retry on denial or model fallback.
Root planning estimate45–75 active minutes; implementation after acceptance90–150; progress checkpoints
20 minutes; CI rounds20 minutes. Same failure at most two evidence-based diagnostic attempts.
Raw review/failure evidence is retained; measured usage is separate from unknown provider requests,
billing, aggregate tool totals and precise active/wait time. No hard tool-call cap is enabled.
