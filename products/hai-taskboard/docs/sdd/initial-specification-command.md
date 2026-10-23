# Mini-SDD: Explicit first specification acceptance

Status: HAI-FIRST001..006 accepted locally, 2026-10-23, after T-986 implementation,
T-989 independent REWORK/closure, T-999 correction and root pinned full/race/vet/build.
Historical failure evidence remains; broader runtime/product acceptance is not implied.
Parents: accepted-spec-admission HAI-ADMISSION-002/004, acceptance-persistence-schema,
durable-proposal-command. This child installs first heads only. It does not enable runtime
readiness, dispatch, completion, impact activation or infer acceptance from legacy rows.

## Bootstrap and exact intent

**HAI-FIRST-001**: `CreateWorkItem` may carry an explicit empty `required_ac_revisions` array
to create a Draft without accepted requirements. Preserve canonical bytes and behavior for
existing nonempty requests. This exception belongs only to CreateWorkItem: completion subjects
and all existing nonempty revision validation remain unchanged. An empty Draft cannot become
Ready through this change. No acceptance, AC content or Run is inferred at creation.

**HAI-FIRST-002**: Add `AcceptInitialSpecification` with ordinary command Metadata,
ProjectID, ProposalDigest, PolicyRevisionDigest, AcceptanceSubjectDigest,
WorkItems `{work_item_id,expected_version}` and ACContents `{ac_id,content}`.
`content` is raw bytes in the application DTO (canonical JSON base64). Hash those exact bytes;
their SHA-256 must equal that AC's revision in the immutable authenticated proposal.
The manifest's digest reference is content-addressed provenance; AC bytes need not equal an
entire node blob. No repository instructions or AC contents are executed.
The supplied content set must equal the union of declared proposal ACs, without omissions,
extras, duplicate IDs or conflicting revisions. Each mapped WorkItem's required set is the
sorted union of AC bindings on its mapped nodes, including optional nodes when explicitly mapped.
Each mapped WorkItem must have at least one required AC. Every mapped recipe must equal trusted
CompletionPolicy.RecipeDigest; every AC must have an explicit trusted verification policy rule.

The WorkItems read-set must equal the sorted distinct union of proposal WorkItem mappings.
All mapped WorkItems exist in this project, are Draft, have no accepted head and no Run history.
Existing unrelated headless Drafts may remain outside this proposal; they gain no authority.
The project must have no accepted head. A later acceptance uses impact activation, never this
command. Reject unsupported size without truncation: 256 WorkItems, 256 ACs, 64 KiB per AC,
512 KiB total raw AC content, and 16 MiB canonical accepted material. All versions fit positive
signed SQLite integers and must have room for one increment.

**HAI-FIRST-003**: Define a canonical schema-1 acceptance subject containing operation,
project ID/expected aggregate version, explicit `base_accepted_revision_digest:null`, proposal
digest, graph revision, repository binding identity/version/digest, policy revision and sorted
complete WorkItem read-set. A public pure canonical helper computes its SHA-256; the command
must supply exactly that digest. An absent base is distinct from an accepted empty graph.
Subject construction excludes command IDs, clocks and AC raw bytes (their exact digests are
already committed by the proposal). Canonical command identity includes the subject and full
content payload so idempotency conflicts cannot hide changed input.

## Immutable accepted material and transaction

**HAI-FIRST-004**: Use application-owned optional `InitialAcceptanceTransaction` extending
AdmissionTransaction, with bounded initial-state read and installation methods; do not expand
the mandatory base Transaction or expose SQL to service/domain. Accepted schema-1 canonical
content binds project, proposal, normative graph digest and canonical normative graph, policy,
acceptance subject (including complete read-set), accepted actor, full sorted AC digest set,
and every sorted WorkItem binding. Each binding contains project/WorkItem identity, sorted
mapped node IDs and exact AC/recipe bindings. Its digest hashes its canonical bytes; a normative
binding digest hashes the sorted semantic bindings, excluding path/provenance and aggregate
versions. Accepted revision digest hashes the full accepted canonical record. Time is stored
separately and cannot silently change identities. Return defensive copies from public values.

Store all declared V2 normalized rows: accepted revision, revision ACs, WorkItem bindings and
requirements, project/WorkItem heads and current requirements. Initial optional impact columns
are NULL; acceptance_kind is Initial. Store verified AC content in existing immutable ac_revisions
using deterministic identity from project/AC/revision; exact preexisting content may deduplicate
only after checking hash, scope and bytes. Never REPLACE/IGNORE immutable conflicts. Legacy
work_item_ac_requirements remain historical and are not authoritative current requirements.
Validate both the scoped AC/revision tuple and deterministic ID before deduplication. An exact
legacy tuple does not excuse a different row occupying the deterministic ID; reject that conflict
without any acceptance writes. T-989 supplies the independent regression for this requirement.

**HAI-FIRST-005**: Authenticate before reads. Exact committed replay precedes current authority
checks and returns original bytes even after restart, head installation or repository revocation.
For new requests, validate proposal/content/subject/policy before mutation. Recheck trusted
repository binding (identity/version/digest/operator approval; no Git I/O), current policy,
project aggregate version, absence of project head and every mapped WorkItem version/state/head
in the command transaction. The accepted proposal remains immutable and must be read through
the verified LoadProposal path. Approved registry changes fail closed. An existing head rejects
without changing it even when its proposal matches. Two concurrent first acceptances produce
exactly one winner; same-key identical concurrency may replay that winner.

Installation uses CAS to increment project and each mapped WorkItem aggregate version once,
sets initial head_version=1, preserves Draft phase, blockers and all history, and commits all
immutable rows, heads, current requirements, result, idempotency, audit and projection together.
Any error after the first mutation uses rollback-only semantics; no recordable rejection may
commit partial AC/history/head writes. Emit the existing project.changed invalidation event
with new project aggregate version. Result `InitialSpecificationAccepted` binds project/version,
proposal digest, graph digest, accepted revision digest and acceptance subject digest using
sha256-prefixed wire digests. Preserve prior result encodings and strictly reject new fields
on unrelated operations. Successful acceptance creates no Run and does not make Draft Ready.
A narrowly named domain operation may advance a Draft's specification version after checking
its expected version, while copying blockers unchanged. Do not reconstruct aggregates to drop
blockers or simulate a phase transition. The adapter's aggregate CAS remains mandatory.

## Required bounded evidence

**HAI-FIRST-006**: Before production, preserve compiling positive Red
`TestAdmission_FirstAcceptAtomicAndSingleWinner`: create project and empty Draft through service,
persist approved proposal through service, explicitly accept exact AC bytes/read-set/subject,
then verify exact heads/requirements/version increments and immutable material after reopen.
Cover exact response replay after source/authority loss, duplicate same-key concurrency,
distinct-key single winner, stale project/WorkItem/policy/subject, missing/extra/mismatched AC,
partial/wrong-project mappings, preexisting head, non-Draft/Run history and repository revocation.
Inject each AC/accepted row/head/aggregate/result/audit/event write failure and cancellation;
assert no partial heads/content/version/command rows, with clean FK state. Corrupt canonical
content or normalized identity must fail closed on bounded reads. Preserve old canonical result
and nonempty CreateWorkItem controls. This oracle does not prove current-head readiness,
dispatch-envelope binding, process-kill/COMMIT-I/O or the complete product Done gate.

## Connected initial-admission boundary

HAI-FIRST007..009 accepted locally after T007, independent T010 ACCEPT, root pinned
API lint/full backend gate and actual two-process HTTP acceptance/Ready/Fake/replay.
The separate V4 output-storage candidate in that backend gate remains REWORK, not accepted.

**HAI-FIRST-007**: Add authenticated, project-authorized GET
`/api/v1/projects/{project_id}/proposals/{proposal_digest}/initial-acceptance` as a read-only
preparation projection. The path digest uses the existing canonical `sha256:` wire format.
Derive the complete sorted mapped WorkItem set from a verified stored proposal, load project
and every item's current versions in one transaction, and verify the same initial-only
headless Draft/no Run prerequisites, approved repository binding, trusted recipe, policy and
AC verification rules as acceptance. No Git I/O, AC content inference, state writes, command
results, audit or events occur. Authenticate before reads; missing, revoked, unavailable or
ineligible material fails closed without leaking private repository paths.

Return proposal/policy/acceptance-subject digests, project expected version, complete WorkItem
read-set and declared AC IDs/revision digests. Include the exact canonical subject object
(schema1 raw internal digest strings as defined in HAI-FIRST003) if exposing it; all separate
public digest fields use `sha256:`. The authoritative service computes the subject digest.
The projection is a snapshot, never a reservation or approval: the subsequent command still
revalidates all identities and CAS versions. Operator supplies exact AC bytes explicitly.
Use optional transport capability and a new service query rather than broadening the base
Transaction or exposing SQL. Existing immutable proposal/acceptance codecs remain unchanged.

**HAI-FIRST-008**: Wire `AcceptInitialSpecification` through the existing project command
endpoint, authentication, exact Origin, strict JSON, 1MiB request cap, ordinary metadata and
result/replay path. Payload: proposal_digest, policy_revision_digest,
acceptance_subject_digest, work_items and ac_contents with existing DTO semantics; content
is strict standard padded base64, maximum64KiB decoded each/512KiB total, at most256 entries.
Reject missing/null fields, unknown/duplicate fields, invalid digests/IDs/versions, duplicate
AC/WorkItem IDs, extra content or alternate base64 spellings before invocation as appropriate.
A legitimate empty AC byte string remains valid when its digest matches the proposal.
Transport does not compute or alter the requested acceptance subject, invent content, accept
on read, or transition to Ready. Exact replay after acceptance/revocation remains service-owned.

Permit an explicit empty required_ac_revisions array only in CreateWorkItem HTTP payload and
its OpenAPI schema, matching HAI-FIRST001. Omitted/null arrays remain invalid; other subject
revision arrays remain nonempty. Preserve existing nonempty encodings and negative tests.
Schema/result validation describes the new operation without accepting its fields on unrelated
results. Old command-only adapters fail closed when optional acceptance capability is absent.

**HAI-FIRST-009**: Preserve compiling named Red `TestAdmission_InitialAcceptanceHTTP` before
production. Exercise authenticated real-Store proposal -> preparation -> explicit exact-content
acceptance -> result lookup/replay, current-head installation and no Run; prepare is read-only.
Cover empty Draft bootstrap, unauthenticated/wrong-project/Origin, unknown/revoked proposal,
stale prepared read-set, already accepted project, malformed/duplicate/oversized/base64 payload,
changed content under the same key and exact replay after revocation. Existing stored result
strictness and full service first-acceptance guards must remain. Run targeted/full HTTP+service
checks and pinned OpenAPI lint; root independent review and integrated gates are separate.
