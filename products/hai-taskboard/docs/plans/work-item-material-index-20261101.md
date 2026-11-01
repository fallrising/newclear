# Proposed WorkItem material index

Status: **Owner approved D1, 2026-11-01; implementation in progress**. T-0339 / HMDTL.
The owner explicitly replied “批准。” to the concrete material-index decision. IDX-01..05 and
IDX-AC-01..06 below are accepted; the [normative entry](../sdd/work-item-material-index.md)
records implementation seams. Original proposal/review chronology below is retained.
Source `9f3f72af3940a106877f86c4b43e39a3dfcd72c8`; HAI unchanged from delivered #902.
Owner requested continued development. This document makes the next contract reviewable; that request
is not treated as approval to replace the existing full WorkItemDetail contract. No production,
OpenAPI, migration or accepted SDD edits occur until the concrete scope is accepted.

## Goal and bounded scope

An authenticated operator can discover a WorkItem's persisted metadata, AC requirements, Runs and
Candidate identities, then use the existing Run-output, completion-preparation and verified-coverage
reads. The current browser has board identifiers, but the existing output listing does not supply
Candidate IDs. No client should infer a Candidate from a successful Run or guess its ID.

Propose one new GET `/api/v1/projects/{project_id}/work-items/{work_item_id}/material-index`. The versioned material-index shape is separate from the existing
unimplemented full-detail GET and WorkItemDetail schema; both remain unchanged and outstanding.
No new UI, commands, history writes, migration, dependencies, provider, release or deployment.
This is a detail prerequisite, not full M2/M3 acceptance.

## M2 obligation reconciliation

| Original M2 obligation | Existing source/evidence | Remaining status |
| --- | --- | --- |
| Exact accepted AC identity / old Draft compatibility / boundary workflow | [identity plan](m2-ac-identity-20261031.md), ID-AC-01..04, #854/#855; domain/ac_identity.go and service/ac_identity_test.go | Delivered bounded identity slice; do not rerun it as new work without a relevant change |
| Explicit policy source and immutable history binding | [policy contract](../sdd/local-project-policy.md), POL-AC-01..05, #868/#880 | Delivered bounded policy slice; no policy re-decision |
| Verified per-AC material and shared completion predicate | [coverage contract](../sdd/verified-coverage.md), COV-AC-01..06, #898/#902 | Delivered Review/QA observation API; no automatic Done |
| Missing-policy / stale / corruption classification | completion-preparation service and PREP matrix; identity and coverage negative tests | Implemented for their accepted reads; do not propagate that matrix blindly to metadata-only reads |
| Detail/coverage authoritative interpretation | Coverage uses authoritative evaluator; getWorkItem has no handler, and legacy full-detail shape lacks truthful storage mappings | Outstanding; material index discovers inputs but claims no coverage or completion validity |
| Whole M2 and connected completion acceptance | [remaining-work M2/M3](remaining-work-20261029.md#m2--ac-identitypolicy-與目前有效證據h02successac-02) | Still incomplete. Do not transfer full detail/history, effective Done, or browser obligations into a done claim |

Paths in the following inventory are relative to the product. Source inspection is not fresh test evidence.

## Full-detail gaps that cannot be fabricated

OpenAPI already declares GET work-items/{id} and required WorkItemDetail arrays (api/openapi.yaml:197,875),
but HTTP server.go registers no such read; the persisted projection port supports only board/replay.
The complete shape requires more than adding a SQL serializer:

| Existing field | Current storage / mismatch | Disposition |
| --- | --- | --- |
| Blocker kind/required input/resolver/created_at | 0001 work_item_blockers has ID, reason and resolved_at only | Do not synthesize missing fields |
| Review reviewer_class | generic reviews store reviewer + independence boolean; human provenance covers only a subset | Do not invent every historical class |
| Evidence observed_at/report/verdict | no generic observation timestamp; nullable artifact and seven stored verdicts versus narrower projection shape | Do not invent time/report or collapse Error/Inconclusive/NotRun into another verdict |
| Approval request_id/decision/decided_at | generic approvals store subject, command kind, actor and expiry | Do not infer a missing request/decision time |
| CompletionRecord historical graph/policy/effective_satisfied | row has subject digest and selected-material joins, not all historical subject fields | Current policy cannot stand in for historical identity; Done validity needs its own accepted projection contract |
| Audit subject_kind/subject_id | audit rows store subject digest; groups carry time | Do not fabricate subject IDs or expose another WorkItem's history |

Review/Evidence/Approval are project+subject scoped, not universally WorkItem-linked. Human-report and
completion associations cover subsets; absent association does not prove absent history. Returning
empty arrays as complete history would be false. Full detail needs a separate decision on unavailable
history and future immutable provenance; this slice neither decides nor implements that change.

## Concrete proposed contract (IDX-01..05)

### IDX-01 — scope and security

Fixed precedence for requests matching the raw endpoint structure (no trailing slash):
1. Existing canonicalPath rejects RawPath/escaped bytes, double slash, backslash/NUL →400.
2. Any method other than GET, explicitly including HEAD →405, literal Allow: GET.
3. Existing cookie/session authentication →401 if absent/revoked.
4. Validate project path and project.read authorization →masked404 if invalid/denied; no scoped
   storage reads before this. The runtime preserves existing Host/origin handling.
5. Validate WorkItem ID, including literal dot/dotdot segments →masked404.
6. Any RawQuery or ForceQuery, ContentLength !=0 (including -1), or nonempty TransferEncoding →400.
7. Read the scoped snapshot; missing project/WorkItem or cross-project item →masked404.
8. Classify storage/capability errors as IDX-04; recheck cancellation and session revocation before
   sending success (cancellation503 projection_unavailable; revoked401).

Intercept the exact raw route structure before ServeMux path cleaning for every method, so dot
segments never redirect and HEAD never invokes GET implicitly. Other route behavior is unchanged.
The syntactic query/body check can precede item existence lookup after authorization; it reveals no
existence. These body rules follow net/http request framing, not arbitrary body probing or IO.
All endpoint responses use no-store/nosniff. No private paths, storage keys, report/artifact bytes,
credentials, SQL errors or canonical request payloads. Permission name is the existing OpenAPI
x-hai-permission:project.read, enforced through the existing authenticate/authorizeProject path.

### IDX-02 — closed versioned response

Every field below is required, arrays are non-null, unknown fields reject at the HTTP boundary:

- api_version: v1; kind: work_item_material_index/v1; observation_only: true.
- project_id, work_item_id, title, goal, human_owner_id, phase, work_item_version.
- accepted_specification: null or an object containing accepted_revision_digest, binding_digest,
  graph_revision_digest, policy_revision_digest, project_head_version, work_item_head_version,
  acceptance_kind (Initial|Impact).
- required_ac_revisions: ordered exact ac_id/revision_digest pairs.
- runs: ordered objects with run_id, input_digest, created_at, desired_action, dispatch_state,
  observed_state, reconciliation_state, side_effect_outcome. These are persisted states; map
  Reconciled to existing public Resolved, never infer success/stop from lease expiry.
- candidates: ordered objects with candidate_id, run_id, candidate_digest, input_subject_digest,
  created_at. No artifact manifest, availability, verification flag, latest/current/default candidate,
  completion subject or eligibility is implied. Return every scoped admitted row within the bounds.
- cursor: stream_epoch/event_sequence; restore_generation from instance_state.restore_generation,
  from the same snapshot as all rows.

All phases, including Draft/Ready/Developing/Review/QA/Done/Canceled, are readable. No Runs or Candidates
is a valid empty array. Missing policy or missing artifact bytes does not erase metadata or reject this
read: neither policy eligibility nor artifact IO is evaluated. Existing downstream endpoints retain
all their authorization, phase, subject, policy, byte-verification and stale checks.

accepted_specification reports the stored head relation, not verified freshness of Git content or a
completion subject. A WorkItem without a head returns null, even if its project has an accepted head.
It returns its legacy work_item_ac_requirements, explicitly not accepted by that fact. With a WorkItem
head, use current_ac_requirements; require matching project/item head revision and binding, referenced
accepted revision/binding rows and exact accepted_work_item_requirements set. Orphaned/mismatched
relations fail503 storage_corruption rather than silently falling back. Do not parse/replay command
payloads, rehash Git content or reconstruct absent provenance. Initial and Impact heads both return their stored kind and graph/policy columns from
accepted_spec_revisions. Do not call LoadCurrentSpecification, whose command-oriented reader rejects
Impact. Reporting an Impact relation does not activate it or permit downstream completion.
The matching-head invariant is structural: migration0002 work_item_spec_heads FK(project_id,
accepted_revision_digest) references project_spec_heads and is deferred until commit; current_ac
requirements also reference the exact item head/binding. SQLite enables/checks foreign_keys on every
connection (store.go:1251–1262). A snapshot cannot observe an uncommitted partial activation. Test a
schema-valid injected Impact fixture separately from lawful command history: runtime Impact execution
is currently unsupported. The only current acceptance writer inserts both accepted and current
requirements from the identical m.Bindings/b.ACs loops (sqlite/initial_acceptance.go:140–171),
and validates current cardinality/membership at290–305. FKs alone prove only subset membership;
this writer establishes exact-set equality for supported command history. The injected Impact
fixture must explicitly supply the complete set; it is not evidence of an implemented Impact writer.
Consumers distinguish accepted versus legacy requirements solely by accepted_specification nullness.

Candidate rows join through their Run to the exact project and WorkItem. Both Candidate and Run input digests are returned as stored; no cross-digest semantic check is
added to discovery. The current SubmitCandidate writer checks equality, but this slice does not infer
that every historical port fixture had that invariant. Downstream authoritative reads reject any
invalid current relation. Other WorkItem/project histories never enter limits or output.
Run input envelopes, candidate artifact sets and historical evidence are not validated by discovery;
existing scoped output/preparation/coverage reads own those checks. IDs are returned byte-exact,
without normalization or guessing. Legacy Candidate IDs accepted by canonical SubmitCandidate but
not addressable by the narrower existing preparation route are still returned; discovery neither
widens that route nor guarantees its success. This compatibility limit is explicit, not a filter.

### IDX-03 — consistency and no authority

One SQLite deferred read transaction on one connection covers scope existence, metadata, accepted
head relations/requirements, Run/Candidate rows and instance cursor/generation. Establish one WAL
snapshot before reading its parts; never combine independently read board/list/service snapshots.
Use the existing readProjection pattern, not the command immediate writer transaction. Item phase/version
uses the same guarded store.loadWorkItem on this read connection, including Done completion/join
rehydration. This checks existing stored Done structure, never current effective satisfaction. Before
calling its blocker loader, preflight active blocker count<=1024 and combined ID/reason material<=2MiB
with SQL byte lengths/limit1025; excess is capacity503, not proof of corruption. Completion join checks
retain their existing count-based guards. This preserves board rehydration semantics without unbounded
blocker materialization. Relative to guarded board WorkItem rehydration, the added readability
restriction is blocker capacity; this index also has its separately declared collection/response limits. This request
must not allocate IDs/events/audit, write state, call executor, acquire an artifact reader or verify
external bytes. Reads can coexist with writer progress. A concurrent command yields one complete old
or new snapshot, never a mixture. event_sequence has exactly the existing board projectionPosition semantics from
instance_state.next_event_sequence, not an independently allocated sequence. Cursor advance after response is legal; consumers must independently
refresh material and use the existing exact command guards. No reservation, success promise or
shared-time atomicity across subsequent output/preparation/coverage calls.

No dynamic coverage or effective_satisfied/covered_ac_count fields are exposed. Any future detail
coverage display must call the accepted verified-coverage service, not count SQL Evidence rows or
infer from Run success. No full historical Done applicability claim is introduced.

### IDX-04 — deterministic bounds and failures

Bound each of required ACs, scoped Runs and scoped Candidates at1024 rows; query limit1025 detects
capacity, never silently truncates. Response maximum4MiB encoded JSON. Before materializing text,
check SQLite byte lengths; title1..240 bytes, goal1..8000, actor1..120, Candidate ID1..80 according
to its existing validText vocabulary. Project/WorkItem/Run patterns retain existing contracts.
When accepted_specification is non-null, AC IDs use InitialACRevisionRef/accepted UTF-8<=120-byte
rules. When null, MaterialIndexLegacyACRevisionRef preserves CanonicalCreateWorkItem's generic
validText<=80-byte vocabulary (including lawful Unicode/space/slash); do not reuse the narrower
HTTP-only ACRevisionRef or apply accepted-profile validation to legacy IDs. No normalization. Digests are nonzero
canonical lowercase sha256; versions/epoch/generation1..MaxInt64, sequence0..MaxInt64. UTC RFC3339Nano
timestamps are derived from positive signed-int64 created_at_ns and round-trip exactly. This implies
1970..2262, not a newly imposed historical timestamp policy; HTTP validates the same conversion.

Order ACs by exact ID then revision; Runs and Candidates by created_at ascending then exact ID using
binary byte ordering, never locale collation. Duplicate IDs, invalid enums, invalid scalar types,
malformed UTF-8/control strings, mismatched identities and inconsistent relations fail503
storage_corruption with no private cause. Closed public Run enums: desired_action None|Dispatch|CancelRequested; dispatch_state
Pending|Claimed|Sent|Acknowledged|FailedToDispatch; observed_state
Unknown|Starting|Running|Succeeded|Failed|Canceled; reconciliation_state None|NeedsReconcile|Resolved
(stored Reconciled maps to Resolved); side_effect_outcome NotApplicable|Confirmed|OutcomeUnknown.
All five stored vocabularies exactly match migration0001_v1.sql:86–90 CHECK constraints.
Observed/reconciliation states are a subset of public RunSummary; desired_action and
side_effect_outcome are new fields in this proposed API, not existing RunSummary fields.
No semantic reinterpretation or migration of legacy data.

A well-formed collection beyond a declared count/response bound returns503 projection_unavailable,
with details containing exactly reason=material_index_capacity_exceeded in the existing error envelope.
Test this bounded detail shape and reject unknown fields in its HTTP error-contract fixtures. Storage/unavailable capability/cancellation
returns503 projection_unavailable without success-shaped arrays. Malformed bounded row data returns
503 storage_corruption. Resource bounds limit response/materialization, not a claim of bounded whole
DB scan time or a benchmark. No new index/dependency/migration is authorized by this contract.

### Compatibility predicates and source basis

Sources below are current supported command/service writers, not a claim that arbitrary direct SQL
or low-level internal-port fixtures satisfy the public command contract. Existing original V1 migration
fixtures must remain readable under their supported semantics, with labels distinguishing raw test
injection from lawful command history. No writer/canonicalization behavior changes in this slice.

| Returned/guarded field | Existing basis and required regression |
| --- | --- |
| Title/goal/owner, WorkItem pattern | command/canonical.go:103–121 validText240/8000/120 and workItemIDPattern; normal legacy CreateWorkItem/reopen fixture |
| Legacy AC IDs | command/canonical.go:183–204 generic validText80/unique/nonzero digest, not HTTP acPattern; direct lawful service Draft with Unicode/space/slash must return byte-exact |
| Accepted AC IDs | domain/ac_identity.go and current_input accepted codec; accepted ASCII81/120 and Unicode120 fixture |
| Run ID pattern | service/service.go:139–193 constructs RunDispatched; execute calls CanonicalSuccess before commit (service.go:433), result.go:114/242 validates Run pattern; current and restored legacy RunDispatched fixtures |
| Candidate ID generic80 | command/vertical.go:98–104 validText80, no path-safe narrowing; non-path-addressable lawful Candidate fixture stays discoverable |
| Candidate/Run input equality | Current service/vertical.go:438–440 checks it, but discovery drops this semantic corruption predicate for historical safety; injected mismatch is returned as stored and downstream remains authoritative |
| Positive timestamp/ns | sqlite/store.go:712–717 CreateRun and1065–1070 StoreCandidate reject <=0; service uses now.UnixNano, not client display time; stored1/maxint64 ns and reopen fixtures |
| Done structure | sqlite/store.go:260–315 guarded loadWorkItem/loadDone/verifyCompletionJoins; valid Done roundtrip and broken completion association refusal |
| Head relation | migration0002:108–139 composite FKs, plus connection FK assertion; valid Initial/Impact fixtures, project-only head+unaccepted item, and deliberately broken relation refusal |
| Exact accepted/current requirement set | sqlite/initial_acceptance.go:140–171 writes both tables from identical binding/AC loops in one transaction;290–305 checks current cardinality/membership. Impact uses schema-valid injection, not supported command history |
| Five Run state vocabularies | migrations/0001_v1.sql:86–90 CHECK constraints exactly equal IDX-04 stored sets; Reconciled maps to Resolved. Test every stored enum and deliberately invalid injected value |

JSON Schema maxLength counts code points; byte limits live in descriptions and authoritative response
validation. The schema's required_ac_revisions branch follows accepted_specification nullness.
Do not turn valid legacy identifiers into corruption solely because a newer downstream URL rejects them.

### IDX-05 — bounded implementation and fixed acceptance

After owner acceptance, add a normative mini-SDD and OpenAPI schema, optional application projection
port/service, SQLite consistent read and authenticated HTTP handler; preserve existing route/command
bytes, behavior, imports and migrations. Root owns integration; any worker gets separate explicit
writable paths and budget. Before production edits add a compiling named404 Red for the new route,
and targeted storage/auth/capacity/concurrency tests. Existing-correct behavior gets regression coverage,
not a fabricated Red. Pin source/gate manifests and retain every original failure.

The table retains the proposal checkpoint. Current implementation results are recorded in
[implementation evidence](../evidence/work-item-material-index-20261101.md) and BOARD HMDTL;
the observable outcomes below remain fixed.

| Product AC | Fixed observable outcome / named oracle | Proposal checkpoint |
| --- | --- | --- |
| IDX-AC-01 | TestWorkItemMaterialIndexHTTP_AuthScopeAndClosedWire: session/project/item masking, no queries/body, method, no-store/nosniff, strict response identity/fields/bounds and safe errors | NotRun |
| IDX-AC-02 | TestWorkItemMaterialIndex_StoredIdentityAndHistory: actual accepted multi-AC/Unicode flow plus legacy Draft, no Runs/Candidates, all phases, multiple Runs/Candidates, Initial/Impact stored heads, project-only head, exact stored digests/order, Unicode/space/slash legacy ACs, no invented current/coverage and no hidden legacy Candidate IDs | NotRun |
| IDX-AC-03 | TestWorkItemMaterialIndex_SnapshotAndNoWrites: independent writer progress during pinned read, no torn version/head/AC/Run/Candidate/cursor/generation; all durable row/allocator counts and IDs unchanged; reopen same logical result | NotRun |
| IDX-AC-04 | TestWorkItemMaterialIndex_BoundsAndCorruption: each exact1024/count1025, encoded4MiB/+1, max valid scalar/UTF-8/numeric/time, auxiliary blocker preflight, HEAD/dot-segment precedence, duplicate/malformed/orphan rows, foreign histories excluded; absent head versus corrupt relation distinguished | NotRun |
| IDX-AC-05 | TestWorkItemMaterialIndex_DiscoverThenComplete: real SQLite/Fake/HTTP flow discovers candidate/run IDs without fixture-known lookup, consumes existing output/preparation/coverage, positive observation alone leaves phase unchanged, explicit completion remains guarded; later subject drift rejects stale intent | NotRun |
| IDX-AC-06 | Native backend/full/race/vet/build, web regression, pinned OpenAPI, docs/index; Claude plan/code findings disposed; exact-head CI/normal merge/readback/BOARD/desk/handoff | NotRun |

The4MiB wire-boundary test may use a synthetic port response to test the transport independently;
report real-store maximum fixtures separately and do not imply impossible4MiB valid metadata fixtures.
Snapshot corruption tests deliberately inject fixtures; they do not redefine lawful command inputs.

## Decision to request after Claude review

**D1 (recommended): approve IDX-01..05 and fixed IDX-AC-01..06 as the next backend-only material-index
slice, retaining the existing full WorkItemDetail/history contract and incomplete full M2 status.**
Alternative: defer this API and first design complete historical provenance/detail, which is a larger
contract and storage change. No answer is assumed. Historical representation is a later decision,
not a second question required to implement this isolated index. Existing policy/coverage decisions
and Git delivery authorization are already accepted and are not reopened.

## Review and execution limits

Plan root45–75active minutes with20minute checkpoints, one10minute read-only native audit, Claude
Code2.1.312 exact claude-opus-5-5/high no-tools480s initial plus at most one material-revision follow-up.
Implementation, if approved, expected90–150active minutes including integration and source-bound tests;
Claude code same480s+one actual-revision follow-up. CI each round20minutes. Same failure initial plus
at most two new-hypothesis diagnoses. No silent provider fallback or bypass. Raw events, failures,
source hashes and measured command durations retained; aggregate provider/tool/billing/active-wait unknown.
This planning delivery uses DTL-PLAN-01..03, not unrun IDX product acceptance or full-M2 closure.
