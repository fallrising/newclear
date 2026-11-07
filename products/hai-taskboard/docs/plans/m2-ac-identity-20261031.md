# M2 AC identity alignment and policy decisions

Status: Claude-reviewed identity implementation plan; proposed policy/coverage successors unaccepted. T-0339 / H02 support; full M2 and product AC-02 remain incomplete.
Source: `24af3ab7c7d6722314125cbe3ac009db57bd4ad1` (2026-10-31); no HAI product changes since M1c delivery.
Owner continued development after M1c. Current status is [BOARD](../tasks/BOARD.md).

## Objective and boundaries

Make AC inputs in the **accepted-specification completion workflow** obey the already accepted HAI-IMPORT-003 identity rule:
1..120 UTF-8 bytes, no Unicode control/space characters, slash or backslash, exact case/bytes,
no trimming, normalization, transliteration or aliasing. This repairs fixture-evidence rejection of lawful accepted IDs and inconsistent command validation;
it does not make an arbitrary AC dispatchable. HAI-FIRST-001 explicitly freezes the legacy nonempty
Draft path; that path and its ASCII80 HTTP vocabulary remain unchanged. New accepted workflows use
empty Draft followed by explicit specification acceptance, so they do not depend on that legacy path.

M2 has three independent obligations: identity alignment, trusted general policy source, and verified
coverage. This task implements identity alignment, verifies current policy rejection, and supplies
concrete remaining design decisions. It does not claim full M2 completion. New policy configuration
requires the explicit contract acceptance stop point in the [remaining-work plan](remaining-work-20261029.md#6-開工前要解決的具體決策).
Coverage endpoint implementation stays pending that separately fixed wire/authority contract; no UI
or predicate changes are bundled into an identity repair.

Authoritative inputs: [proposal import](../sdd/proposal-import-core.md) HAI-IMPORT-003/004,
[current inputs](../sdd/current-specification-inputs.md) HAI-INPUT-002/005/006,
[completion preparation](../sdd/completion-preparation.md),
[domain gates](../sdd/domain-and-gates.md) and [M1c](m1c-human-reports-20261031.md).
The existing `local-policy-v2` binds only AC `local`. Missing rules remain fail-closed. The earlier
M2 planning observation that preparation returns stale on missing rule is superseded by M1a:
well-formed current material with incomplete policy returns `policy_rejected`; stale and corruption
keep their accepted precedence. Current mutation error semantics remain unchanged.

## Implementation design

1. Introduce a narrowly named AC identity validator at the domain dependency leaf. Exact predicates
are `unicode.IsControl` and `unicode.IsSpace`, plus UTF-8 validity, 1..120 bytes and no `/` or `\`.
Do not normalize or reject additional Unicode categories. Generic tokens, stable-ID, actor, WorkItem
and Run rules remain unchanged. Reuse it in HTTP accepted-AC validation and new initial/human
command validation. Proposal/input codecs retain their current implementation; agreement is tested.
2. Preserve legacy nonempty `CreateWorkItem` HTTP, canonicalizer and bytes unchanged under
HAI-FIRST-001. Also preserve all historically canonicalizable fixture Evidence commands: retain the
old `validText(ACID,80)` arm, and additionally allow accepted-profile IDs through 120 bytes. This
**compatibility canonicalizer is not a new-authority validator**. Exact recorded replay happens before
current authority checks. New fixture writes still require current immutable accepted Run input and
exact AC membership; illegal IDs cannot match its strict accepted identities. No legacy bytes change.
3. Tightening initial-acceptance/human command validation is intentional for new requests. Prove
that these APIs could never lawfully persist a successful whitespace/separator AC: initial acceptance
must match strict immutable proposal membership; human reports must match strict immutable accepted
Run input and policy. Include service regression snapshots showing formerly canonicalizable invalid
IDs rejected before any durable write; immutable accepted codec and stored-input decoder rejects
those IDs as well. Do not claim compatibility of hypothetical corrupt successes. Initial acceptance HTTP and strict
human/fixture command HTTP already reject those IDs before service calls, including recorded failures.
A non-test caller inventory finds only these HTTP handlers and service declarations/interfaces, with
no worker/bootstrap/CLI caller. Preserve that rg result. Direct historical fixture calls remain
compatible via the old canonicalizer arm. Generic in-process consumers outside this repository are
not a claimed supported historical ingress.
4. Align fixture Evidence schema with accepted InitialACID prose, including 120 UTF-8 **bytes**.
Keep legacy ACRevisionRef schema unchanged for CreateWorkItem. CompletionSubject already uses
InitialACRevisionRef, and preparation includes that subject; neither shares ACRevisionRef. WorkItem
response **does** share ACRevisionRef: point that response at InitialACRevisionRef to describe
accepted current IDs; leave CreateWorkItem payload unchanged. This corrects its existing narrower
response documentation. The shared
Evidence schema's existing HTTP ingress already rejects invalid accepted IDs; canonical legacy replay
is a service compatibility path. JSON Schema maxLength counts characters, not bytes. No fake schema
claim that maxLength enforces byte length. No unrelated schema or actor changes.
5. Preserve domain subject canonicalization/rehydration and `CanonicalCompleteWorkItem`; authoritative
current-input comparison and existing error classifications remain unchanged. Existing preparation
reads already reject out-of-profile historical subjects as 503 storage_corruption; preserving the
constructor is not a claim that those rows become usable through current preparation.
6. Real SQLite/service flow uses the existing `service.Config.Completion` field for explicit trusted
**test-only** policy, lawful proposal and first acceptance, Ready/dispatch, candidate, human Review/
Evidence, QA and Done. No new option/flag/env/HTTP hook. Close/reopen and exact replay preserve bytes
and counts. At least one Unicode120 HTTP flow crosses real service acceptance/evidence/Done boundaries.
Missing policy: initial acceptance invalid_request; readiness/dispatch lifecycle_rejected; preparation
409 policy_rejected for well-formed current identity; post-dispatch semantic verification stale_subject.
Human report missing rule remains permission_denied because preflight checks it before loading
material; fixture Evidence uses stale_subject from current-input verification before its later
permission check. Same producer Review, stale AC/recipe/environment and unavailable evidence remain
rejected. Preserve actual error codes and recording behavior; invalid_request is not among the
four recordable failure codes (version_conflict, stale_subject, lifecycle_rejected, done_gate_unsatisfied).
7. Before production edits, add compiling named tests and retain meaningful Red for the >80-byte
fixture evidence command and direct invalid human/initial command boundaries. Existing-correct
Unicode HTTP/accepted flow tests may be green at baseline; label them regression coverage, never
fabricate Red or claim that all named oracles failed. Record exact per-test outcomes.

### Complete ingress inventory and compatibility

All paths below are under backend/internal. `validInitialACID` also validates ProhibitedActor in
HTTP completion preparation; keep that actor check's exact HAI-PREP-003 predicates and semantics.
AC helper reuse does not broaden or tighten the actor vocabulary. Root rg inventory is preserved.

| Boundary | Current | Change / authority |
| --- | --- | --- |
| specification/manifest.go AC IDs; application/port/current_input.go | UTF-8 <=120 strict | unchanged; agreement vectors |
| command/canonical.go canonicalizeRevisions | generic text <=80 | unchanged legacy Draft; only caller CanonicalCreateWorkItem |
| httpapi/server.go acPattern/decodeRevisions | ASCII80 | unchanged; only caller CreateWorkItem |
| httpapi/server.go completionSubjectWire.domainValue | validInitialACID <=120 | same predicate via AC helper; independently loops, **does not call decodeRevisions** |
| command/vertical.go fixture Evidence | generic text <=80 | preserve old arm for replay; add strict accepted-profile120 arm |
| command/initial_acceptance.go AC contents | generic text <=120 | strict accepted profile; membership proof prevents prior illegal success |
| command/human_report.go Evidence | generic text <=120, no slash | strict accepted profile; current-input membership proof |
| httpapi/initial_acceptance.go request/response | validInitialACID <=120 | same behavior via helper |
| httpapi/completion_commands.go strictCommandWire | validInitialACID for ac_id | same behavior via helper; fixture/human routes |
| httpapi/completion_preparation.go ACs and prohibited actor | validInitialACID | same behavior; preserve actor semantics separately |
| domain/subject.go + command CanonicalCompleteWorkItem | historical generic stable IDs + current-subject guard | unchanged; no rehydration tightening |

Agreement vectors include ASCII80/81/120/121, multibyte120/121, invalid UTF-8, C0/C1 controls,
U+0085/U+00A0/U+3000 reject; U+200B/U+FEFF/U+202E retain the proposal codec's allowed outcome.
NFC/NFD spellings remain distinct. Assert HTTP escaped lone-surrogate rejection against JSONv2.
If proposal codec, Run-input decoder, HTTP validator or shared helper disagrees on any vector, stop
and report; do not change the accepted codec to make an oracle pass.


## Fixed acceptance and named tests (NotRun until evidence)

| ID | Required observable outcome | Oracle |
| --- | --- | --- |
| ID-AC-01 | ASCII80/81/120 and legal multibyte120 accepted by accepted-profile boundaries;121 bytes, empty, invalid UTF-8, Unicode control/space, slash/backslash rejected; duplicate exact IDs reject | `TestACIdentity_AcceptedBoundary`, `TestACIdentity_CommandIngress`, `TestACIdentity_HTTPIngress` |
| ID-AC-02 | Every accepted AC retains exact bytes/case/digest, no NFC/NFD merging; valid canonical fixture bytes and old digests unchanged; malformed requests add no rows | `TestACIdentity_CanonicalCompatibility` plus existing canonical fixtures |
| ID-AC-03 | Lawfully accepted Unicode/81/120-byte ACs can reach human evidence and Done under explicit test policy; missing rule, stale AC/recipe/environment, same-producer review remain denied; restart/replay preserve identity | `TestAcceptedACIdentity_EvidenceAndCompletionBoundary` plus existing current-input/completion negatives |
| ID-AC-04 | Native backend full/race/vet/build, web regression, API lint and project/document checks pass; Claude plan/code review blockers disposed; required CI/merge/readback and ledger sync observed | milestone evidence/BOARD |

Coverage outcomes will remain NotRun under `TestCoverageProjection_MatchesCurrentDonePredicate`.
No full HAI-DONE/UX/OPS acceptance follows from ID-AC-01..04. No browser behavior changes or new
browser acceptance are claimed. Valid legacy input/output bytes and migrations 0001..0005 stay unchanged.

## Pending policy contract — concrete proposal for owner acceptance

Update2026-10-31: owner approved this direction. The concrete successor is [local project policy](../sdd/local-project-policy.md), tracked by BOARD HMPOL. The proposal below remains the historical decision input; its implementation status is not inferred from approval.

Recommended bounded successor: **explicit immutable per-project policy profiles**, loaded from an
operator-selected local JSON file at startup; no HTTP/agent policy writes, hot reload or wildcard rule.
The file is an operator input, never discovered in an untrusted repository. Missing flag retains exact
legacy `local-policy-v2` behavior. A selected profile names its project and each exact AC ID; each rule
states verifier class, independence, prohibited actor/role and nonzero environment digest. It also
states recipe, approval requirement and integration-base applicability. Strict schema, duplicates,
missing fields and unsupported version reject startup before dispatch; no fallback on invalid input.

The semantic policy revision is derived from canonical complete policy content, including project,
all sorted rules and recipe/base/approval values. Persist canonical bytes/digest in append-only SQLite
rows before use. Restart must select the same policy identity to use existing current heads; editing a
file cannot rewrite accepted heads, old Runs, evidence or approvals. A different profile cannot become
active by restart alone. For this initial successor, a project with existing accepted heads bound to a
different revision is rejected with an explicit reconciliation requirement; changing an established
policy is deferred to the approved activation/reconciliation path. Existing local profile identity and
history retain exact digest compatibility; do not re-hash its legacy version label retroactively.

Proposed fixed resource limits: at most 256 exact rules/profile, the verified initial-acceptance and
current Run-input limit (not the import maximum);
profile JSON at most 256 KiB before parse. These are admission limits, not measured capacity claims.
Import itself allows 1024 ACs/node and 20000 aggregate; this proposed profile cannot activate such
larger imports through the bounded initial-acceptance path. No new policy_rejected mapping is
invented for that existing initial-acceptance invalid_request boundary. Explicit UTF-8 identity and
complete per-AC rules never imply Passing evidence. The production rule
classes remain those already supported; human report submission still requires an independent human
rule and the server actor. New profile support needs its own migration/API/doc/tests review and owner
acceptance. No such loader/table/configuration is introduced in this task.

Proposed acceptance: absent flag exact legacy compatibility; invalid/unknown/duplicate/oversize
profile fails before worker starts; 80/81/120-byte and Unicode exact rule lookup; accepted-input policy
binding; missing rule rejection; restart same bytes succeeds; same label/different semantics cannot
reuse history; wrong project and changed established policy reject; no automatic reaccept/redispatch.

## Pending coverage contract

A separately reviewed authenticated candidate-bound GET should use the same material snapshot,
outside-writer artifact verification, final revalidation and authoritative Done predicate as completion.
It returns every required AC in deterministic order with matching Evidence IDs or existing predicate
reason codes, plus subject/version and explicit observation-only status. Input assembly must be separated from
`completionInput` record-ID allocation: a GET must allocate no completion ID. Per-AC coverage is
separate from overall eligibility, actor-bound approval and historical Done applicability. It writes no result/audit/
projection/approval consumption and grants no completion authority. DescribeCompletion remains
input preparation. Missing policy vs stale vs corruption follows the accepted M1a matrix. Review,
phase, blocker, Run and approval failures remain visible rather than being hidden by per-AC coverage.
Exact route/response, bounds and race oracle must be fixed before implementation; do not claim this
paragraph is an accepted wire contract or treat metadata alone as verified coverage.

## Routing and verification

Root owns documentation, API contract edits, diff review and integration. One 10-minute native leaf
performs read-only T001 audit; an isolated bounded writer may implement only the explicit identity
assignment after Claude plan acceptance. No recursive delegation. Claude Code exact
`claude-opus-5-5`/high reviews a supplied public-source packet with no tools/MCP/hooks/session
persistence, 480 seconds per invocation, initial plus at most one revision follow-up per review.
Root 90–120 active-minute estimate with 20-minute progress checkpoints; CI each round 20 minutes.
Failure initial plus at most two new-hypothesis diagnoses. No retry/model fallback on CLI denial.
Source/gate hashes and observed durations are recorded; unmeasured provider/tool/billing totals null.

Required commands: unmodified `bash scripts/check-backend.sh` and `bash scripts/check-web.sh` in
pinned supported environments, pinned Redocly lint, `python3 scripts/check_project_success.py`,
repository index checks, document links/format, task/report validators and `git diff --check`.
Full M2, M3, UI, real providers, credentials, runtime dependencies, release and deploy remain outside
this identity implementation. The only subsequent decision is accepting/refining the concrete policy
successor; identity delivery does not authorize it automatically.
