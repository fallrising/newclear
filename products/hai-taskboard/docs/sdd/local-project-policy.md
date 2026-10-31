# Immutable local project policy

Status: owner approved the concrete direction on 2026-10-31; Claude plan revision ACCEPT. Implementation and acceptance evidence pending.
Task: T-0339 / HMPOL. This realizes the policy proposal in [M2 identity plan](../plans/m2-ac-identity-20261031.md).
The existing Fake-only boundary, Done predicate and full product ACs do not change.

## Authority and scope

An operator-selected local file supplies trusted completion policy, separate from repository/import
content. Runtime remains environment-only: optional `HAI_TASKBOARD_COMPLETION_POLICIES_FILE` is an
absolute clean path, never discovered in a repository. It is read once before service/worker/listener
startup. No CLI argument, HTTP policy write, hot reload, wildcard, policy activation, reconciliation,
provider, dependency, UI or verified-coverage endpoint is added. Existing accepted policy cannot be
replaced through a restart. Owner approval covers this direction and its bounded implementation.

The operator first creates the project using the existing runtime/API, then stops it and selects a
profile before initial specification acceptance. Unknown project IDs fail startup; loading a file
never creates projects, accepts specifications, dispatches Runs or grants Passing evidence.

## File contract

The UTF-8 JSON document is at most 262144 bytes and has exactly `schema_version:1` and `profiles`.
The profiles array has 1..32 entries, each for a unique exact project ID. Each profile has:

[Example document](../examples/project-policies.json) is synthetic; replace its project/AC IDs with
the explicitly created project and intended specification IDs before registration. Its digests are
the existing local recipe/Fake environment, not a real-world verification claim.

| Field | Required value |
| --- | --- |
| schema_version | JSON integer spelling 1 |
| project_id | Existing project; exact nonempty 1..120 UTF-8 bytes, no Unicode control/space or slash/backslash |
| recipe_digest | Nonzero lowercase 64-hex SHA-256, no prefix |
| approval_required | Explicit JSON boolean |
| integration_base | Exactly {"applicability":"absent","digest":null} or {"applicability":"present","digest":"<nonzero lowercase 64-hex>"}; both members required |
| verification_rules | Array of 1..256 complete exact-AC rule objects |

Each rule explicitly supplies `ac_id`, `verifier_class`, `independent`,
`prohibited_verifier_actor`, `prohibited_verifier_run_role`, and `environment_digest`.
AC IDs use the accepted strict 1..120-byte domain predicate with no normalization. Verifier class is
exactly human for this v1 runtime profile. Although fixture command canonicalization also knows
producer/independent, this loader does not enable either class; both and unknown classes are rejected. Prohibited role is optional-empty, at most 128 UTF-8 bytes with no controls.
Prohibited actor is explicit empty or uses the Unicode validInputID predicate from port/current_input.go
(nonempty 1..120 UTF-8 bytes, no control/space/separators), not runtime ASCII validActor.
Environment digest is a nonzero lowercase 64-hex SHA-256. For v1 human profiles, independence must
be explicit true; false, absent or null reject admission. This preserves the compiled human rule.
These are the existing trusted rule vocabulary and downstream semantics, not new verifier execution.
Human reports still require an independent human rule and current server actor; mismatches never pass.
Explicit authenticated human fixture Evidence remains supported under the selected human policy;
Fake/producer output alone does not become independent proof. No fixture path is silently disabled.

Unknown members at every level, duplicate JSON keys, missing members, null required values,
wrong types, duplicate projects/AC IDs, invalid UTF-8, unsupported version, trailing JSON and
oversize input all fail before dispatch. Booleans cannot default silently from missing/null.
The integration-base spellings are identical to RunInputIntegrationBase. Its digest member must
exist even when null; other applicability values reject.
No caller-supplied policy revision digest or fallback after invalid input is accepted.
An empty selector retains the exact compiled local-policy-v2 / local-recipe-v1 profile for projects
that have never registered a custom policy. Within a selected project, a missing AC rule never
falls back to the legacy local rule. Unconfigured projects continue to use the compiled local policy.

Use the established repository-config file trust model: same-user regular 0600 file, one hard link,
no special mode bits, no symlink components, descriptor-relative no-follow/nonblocking open, bounded
read and identity/metadata recheck. A file path does not expand trusted repository access. Errors
name the configuration category without dumping path/content/session credentials.

## Canonical identity and persistence

A profile owns immutable canonical bytes and a digest; outward bytes/material/maps are copies.
Canonical JSON includes its schema, exact project, recipe, approval, integration base and every rule
field. Rules are sorted by exact AC bytes; object field order is fixed by the versioned codec.
Whitespace, input key order and rule order do not affect identity; Unicode normalization is never
performed. Any semantic field change changes the hash. The policy revision equals SHA-256 of the
canonical profile bytes. File path and order of other profiles are not policy identity.

Migration 0006 adds immutable project completion-policy registration rows (exact project primary key,
codec version 1, revision digest, canonical bytes, registration timestamp, project foreign key).
Use a STRICT table; project nonempty and consistent with projects, codec CHECK=1, lowercase 64-hex
digest, canonical BLOB length 1..262144 and positive integer timestamp. A duplicate-insert trigger
rejects REPLACE/IGNORE/UPSERT as in prior immutable tables. Unknown-future-schema tests move 6→7.
Update/delete/duplicate-replacement attempts fail; restart reuses an exact verified row without
an INSERT. Migrations 0001..0005 and their checksums stay byte-identical. No accepted head/Run/report/
evidence/approval/completion content is rewritten or backfilled.

Registration and all compatibility checks use one startup writer transaction before Compose/listener/
worker. Every stored profile must be present in the selected document and decode/re-hash/re-canonicalize
exactly; omitted profiles, unset selector with registered profiles, or changed semantic content fail.
First registration freezes a project even before its first accepted head. A new registration requires
an existing project and zero rows for that project in accepted_spec_revisions, project_spec_heads,
work_item_spec_heads, current_ac_requirements and runs. Dangling head/current rows are corruption;
any accepted/Run history otherwise means ineligible and requires the future explicit reconciliation
path. This includes pre-head legacy Runs; tests name that rejection. Ordinary Draft/project creation
and legacy draft requirement rows do not grant acceptance and are allowed. Further eligible projects
may be added; restart never replaces an existing registration. With no removal/reset mechanism,
32 registered projects is a permanent v1 ceiling until a separately accepted successor.
A failure in any profile rolls back the entire registration batch. Startup migrations may already have
run; rejection promises no profile/accepted/runtime command writes, not that schema files never change.
If registration succeeds and a later Compose/listen step fails, the registration remains committed;
restart must retain it. Atomic batch tests inject a later INSERT failure and prove zero batch rows.

Check the relevant accepted head through existing verified accepted-material loaders, not a raw policy
digest alone. A missing head target or orphan current/work-item head for a selected custom project
is corruption, never absence of history. A selected custom profile cannot replace an existing accepted policy/recipe. Registered
project heads must remain compatible with the frozen profile: support only Initial, require exact
policy revision, every bound node recipe equal to the profile recipe, and a rule for every accepted AC.
A registered headless project must have no accepted revision/head/current requirement rows.
For a present registered head, require exactly one project accepted_spec_revisions row equal to
that head, and total project work_item_spec_heads/current_ac_requirements counts equal to the
verified record expectations regardless of revision digest; the existing loader alone does not
detect extra rows attached to a different revision. Run eligibility uses its persisted project key
and existing FK scope, never caller text. The outbox has a composite Run FK and cannot lawfully
outlive that Run; an offline orphan is not a valid headless-history input.
Historical accepted bodies and Run inputs
remain immutable. Corrupt stored registration bytes/digest/scope must fail closed, not be repaired from
the current file. Database hostile-operator tampering is not a new security boundary.

No selector and no custom registrations preserve the legacy startup/command behavior, including old
history that the existing current-input checks may reject. Do not re-hash local-policy-v2 or retroactively
accept old local-policy-v1 histories. No new global accepted-history rewrite or policy migration occurs.

## Application selection and compatibility

Service configuration keeps its existing default Completion policy plus an immutable exact-project
map. One helper selects the complete policy for a project, with default only when the project is absent.
The configured override entries carry their project identity; validate map-key equality, nonzero
revision/recipe, nonempty checks and nonzero rule environments. Prefer owned profile values to
mutable duplicate semantic state. Clone the entire map and each rule map on service construction.

Every current production consumer uses the project selected by authoritative scope: initial description/
acceptance; Ready/Run input and dispatch; completion preparation/description; human report preflight and
commit; fixture evidence; QA/approval; current subject and Done requirement assembly. Avoid selecting
from unverified caller data where an authoritative WorkItem/material project is already available.
Recorded command replay still returns the original result before new policy/material decisions.
All existing missing-rule/stale/corruption classifications and source-precedence checks remain intact.
The [T-001 consumer inventory](../../../../.team/hai-policy-20261031/reports/T-001.md) is the normative
implementation checklist. Each grouped matrix row needs an assertion for every operation listed,
not just one assertion per row. Static invariant: no production config.Completion reference remains outside
construction/validation/cloning and the single resolver. Verify this with source inventory, not a
new source-string unit test. POL-AC-03 records assertions for every category in the following matrix:

| Consumer category | Policy selection source / required assertion |
| --- | --- |
| Initial describe/accept | Authenticated query/command project; selected digest, recipe and rule |
| Ready/Dispatch | Verified WorkItem project; captured policy/rules match exact project |
| ClaimDispatch | Persisted Run/outbox project through current input; selected drift marks stale without lease/execution |
| Preparation/description | Scoped query plus verified WorkItem; selected snapshot/approval/base |
| Human preflight/commit | Authorized scoped intent plus verified material project; same policy at both stages |
| Fixture evidence | Verified Run/WorkItem project; other-project rule cannot authorize evidence |
| Approval/QA/Complete | Verified material project; differing approval requirements and exact subjects respected |
| Integrity/requirements | Verified material project; selected recipe/environment controls artifact checks and Done requirements |

Two projects share an AC ID but differ in at least environment/approval, plus long/Unicode AC
coverage. Assert selected integration_base=present in preparation/subject; it conveys no integration
proof. The runtime flow uses normal short ASCII project/WorkItem IDs; only AC IDs exercise 81/120
UTF-8 bytes and Unicode 120. Human report project/WorkItem constraints are not broadened.

New policy startup rejection is a configuration error before serving, not a new HTTP command code.
No HTTP route/schema change is needed. Existing initial-acceptance/preparation responses expose the
selected policy digest. No policy metadata is Passing evidence, completion permission or a backup proof.

## Fixed acceptance and named oracles

| AC | Given / When / Then | Planned oracle |
| --- | --- | --- |
| POL-AC-01 | Strict input and exact fields; malformed or unsafe file rejected; equivalent layout preserves digest and every semantic change differs | TestPolicyProfile_StrictCanonicalIdentity; TestRuntimePolicyFile_Admission |
| POL-AC-02 | Migration and immutable profile registration; omissions/changes/wrong project/corruption reject atomically; prior schema bytes stay frozen | TestPolicyProfiles_ImmutableRegistration; TestPolicyProfiles_StartupCompatibility |
| POL-AC-03 | Two projects with different exact rules; every accepted/completion operation selects its project with no cross-project fallback; original legacy/replay behavior unchanged | TestProjectPolicies_SelectionAndIsolation |
| POL-AC-04 | Real runtime/SQLite/Fake and HTTP proposal→acceptance→Run→human reports→QA→Done under long/Unicode IDs; restart same profile replays; changed/omitted profile fails before worker/listener | TestRuntimePolicyProfiles_CompletionAndRestart |
| POL-AC-05 | Required full backend/race/vet/build, web/API/docs checks and Claude plan/code reviews pass, followed by CI/merge/readback/ledger | Evidence report and BOARD |

Additional named cases: missing/null/false booleans are distinct; absent base digest must be explicit
null; every admitted profile can form a valid Run input; no selector with registered profiles rejects;
legacy v1/v2 without profiles starts/replays unchanged; selecting new project B does not affect legacy
project A; concurrent identical startup registers once; missing/corrupt selected-project projections
and changed canonical policy bytes/digest reject. Canonical struct field order follows the field table
then each rule's listed order; json/v2 encoding uses explicit empty strings and never omits fields.
Golden bytes pin escaping. Input key order/rule order remain layout-only.

Write meaningful compiling Red before production changes where possible; new codec/DDL APIs require
minimal test skeletons to compile and this exception must be recorded. Use deterministic isolated real
SQLite for atomicity and corruption; ensure no test label manufactures coverage by counting only a
convenient subset. Runtime reopen is not crash/backup/restore proof. Full M2 coverage, UI and product
AC-02..04 remain incomplete.

## Implementation sequence and review boundary

1. Review this contract and the source inventory with Claude; resolve blockers before writing Go.
2. Add the strict owned-byte profile codec and focused boundary/canonical tests; new APIs may need
   a minimal compiling skeleton before Red. Freeze literal golden bytes/digest.
3. Add migration0006 and the optional startup registration port/SQLite transaction implementation,
   with atomicity, immutable SQL and existing-head integrity tests. Do not change old migration SQL.
4. Add exact-project policy selection and route every audited current policy consumer through it;
   preserve global default tests and the existing command replay ordering.
5. Wire safe file loading and registration before Compose/listener/worker. Cover actual public HTTP
   initial acceptance through completion under a registered profile plus restart/rejection/isolation.
6. Root integrates frozen source, runs pinned gates, obtains independent Claude code review, then
   performs required PR CI/merge/readback, BOARD closure and desk synchronization.

One native leaf first supplies a 10-minute audit and may receive a separate isolated 60-minute Go
assignment after review; no children or Git authority. Root owns shared docs/plan and acceptance.
Claude Code exact claude-opus-5-5/high uses no tools/MCP/customizations/session persistence, 480s
host process-group timeout per call; plan/code each one initial plus at most one actual-revision
follow-up. Root active estimate 120–150 minutes, 20-minute checkpoints; CI each round 20 minutes.
Same failure: initial plus at most two new-hypothesis diagnoses. Actual usage/unknown totals remain
separate; no unrelated maintenance or model fallback. Evidence retains all failed and superseded runs.
