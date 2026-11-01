# Mini-SDD: Acceptance persistence schema

Status: **Bounded storage/migration implementation accepted by root after T-142 PASS and local gates (2026-10-05)**.
Parent: `accepted-spec-admission.md` HAI-ADMISSION-001..008; ADR-001/004/005;
`ordered-migrations.md` HAI-MIGRATION-001..006.
Baseline: `b2ccf47066a3729d37d053271db16fb566c9b1ed`.
This is a schema-only V2 implementation. All seven named storage/migration oracles below passed;
PLAN and T-0189-gate bind the reviewed candidate. Admission commands remain Specified/NotRun.

## Storage boundary

**HAI-V2-001**: Add `migrations/0002_acceptance.sql` as trusted compiled migration 2 after
frozen V1. The new file contains only CREATE TABLE/INDEX/TRIGGER statements, with no backfill,
seed proposals or heads, ALTER of V1, PRAGMA changes or application-row UPDATE. The ordered
runner owns migration history insertion and instance schema-version advancement. Freeze the
exact V2 byte checksum after review; never supply SQL or registries from requests or the database.
V1 remains SHA-256 `57d96955d3351de47b1a81696398cf9ddb843394eb5c004c6f79841117c7745c`.

All eleven new tables begin empty on fresh creation and populated V1 upgrade. Existing
`ac_revisions`, `dependency_revisions`, `dependency_edges` and
`work_item_ac_requirements` remain immutable historical fixtures/data. Neither latest rows nor
`projects.repository`/`repository_ref` imply approved repository provenance or acceptance.
No migration changes aggregate versions, phase, Runs, input digests, artifacts, completions,
results, audit, projections, restore generation, stream epoch or event sequence.

Runtime `unavailableSpecification` stays false. Existing completion-history reads are not
changed here. New head tables are storage capability only; they do not implement authentication,
authorization, CAS, accepted-input read ports, graph validation, readiness, dispatch or activation.

## Exact relational definition

**HAI-V2-002**: The following definition is normative for the implementation child. Each table
is `STRICT`. Every listed column is `NOT NULL` unless marked `?`; there are no column defaults.
`P` abbreviates `project_id`, not a different SQL column name. PK and UQ identify complete ordered
PRIMARY KEY and UNIQUE column lists; every FK below references an explicitly listed PK/UQ or a
V1 key. No FK uses CASCADE, SET NULL or RESTRICT: use SQLite default NO ACTION, including the
deferred constraints described below. Ordinary FKs are immediate.

Column notation expands exactly as follows:

| Notation | SQLite type and CHECK |
| --- | --- |
| `id` | TEXT, `length(column)>0`; all project, WorkItem, binding and actor IDs use this |
| `sha` | TEXT, `length(column)=64 AND column NOT GLOB '*[^0-9a-f]*'` |
| `bytes` | BLOB, `length(column)>0` |
| `version` | INTEGER, `column>0` |
| `time` | INTEGER, no positive-time restriction |
| `format` | TEXT, `column IN ('sha1','sha256')` |
| `oid` | TEXT, lowercase hex; length 40 for sha1 or 64 for sha256, using the same row's object_format |

Nullable sha columns use `column IS NULL OR (sha CHECK)`; nullable IDs use the analogous
nonempty CHECK. No scope discriminator in a nonoptional relationship may be nullable.

| Table | Exact columns | PK and extra UQ |
| --- | --- | --- |
| `repository_binding_versions` | P:id, repository_binding_id:id, binding_version:version, binding_digest:sha, object_format:format, binding_content:bytes, approved_by_actor:id, created_at_ns:time | PK(P,repository_binding_id,binding_version); UQ(P,repository_binding_id,binding_version,object_format) |
| `specification_proposals` | P:id, proposal_digest:sha, schema_version:INTEGER CHECK(schema_version=1), repository_binding_id:id, binding_version:version, object_format:format, commit_oid:oid, manifest_path:id, manifest_blob_oid:oid, manifest_digest:sha, graph_revision_digest:sha, canonical_content:bytes, created_at_ns:time | PK(P,proposal_digest); UQ(P,proposal_digest,repository_binding_id,binding_version); UQ(P,proposal_digest,graph_revision_digest) |
| `accepted_spec_revisions` | P:id, accepted_revision_digest:sha, proposal_digest:sha, graph_revision_digest:sha, normative_binding_digest:sha, policy_revision_digest:sha, acceptance_subject_digest:sha, canonical_content:bytes, acceptance_kind:TEXT CHECK IN('Initial','Impact'), base_accepted_revision_digest:sha?, impact_plan_digest:sha?, activation_decision_digest:sha?, decision_value:TEXT?, accepted_by_actor:id, created_at_ns:time | PK(P,accepted_revision_digest); UQ(P,accepted_revision_digest,graph_revision_digest) |
| `accepted_revision_acs` | P:id, accepted_revision_digest:sha, ac_id:id, ac_revision_digest:sha | PK(P,accepted_revision_digest,ac_id); UQ(P,accepted_revision_digest,ac_id,ac_revision_digest) |
| `accepted_work_item_bindings` | P:id, accepted_revision_digest:sha, work_item_id:id, binding_digest:sha, canonical_content:bytes | PK(P,accepted_revision_digest,work_item_id); UQ(P,accepted_revision_digest,work_item_id,binding_digest) |
| `accepted_work_item_requirements` | P:id, accepted_revision_digest:sha, work_item_id:id, binding_digest:sha, ac_id:id, ac_revision_digest:sha | PK(P,accepted_revision_digest,work_item_id,ac_id); UQ(P,accepted_revision_digest,work_item_id,binding_digest,ac_id,ac_revision_digest) |
| `project_spec_heads` | P:id, accepted_revision_digest:sha, head_version:version | PK(P); UQ(P,accepted_revision_digest) |
| `work_item_spec_heads` | P:id, work_item_id:id, accepted_revision_digest:sha, binding_digest:sha, head_version:version | PK(P,work_item_id); UQ(P,work_item_id,accepted_revision_digest,binding_digest) |
| `current_ac_requirements` | P:id, work_item_id:id, accepted_revision_digest:sha, binding_digest:sha, ac_id:id, ac_revision_digest:sha | PK(P,work_item_id,ac_id) |
| `specification_impact_plans` | P:id, plan_digest:sha, kernel_plan_digest:sha, proposal_digest:sha, repository_binding_id:id, binding_version:version, base_accepted_revision_digest:sha, base_graph_revision_digest:sha, proposed_graph_revision_digest:sha, policy_revision_digest:sha, read_set_digest:sha, algorithm_version:id, canonical_content:bytes, created_at_ns:time | PK(P,plan_digest); UQ(P,plan_digest,proposal_digest,base_accepted_revision_digest); UQ(P,plan_digest,proposal_digest,base_accepted_revision_digest,read_set_digest) |
| `specification_activation_decisions` | P:id, decision_digest:sha, plan_digest:sha, proposal_digest:sha, base_accepted_revision_digest:sha, read_set_digest:sha, operation:TEXT CHECK(operation='ActivateSpecificationImpact'), decision_value:TEXT CHECK IN('Approve','Reject'), actor_id:id, subject_digest:sha, canonical_content:bytes, created_at_ns:time | PK(P,decision_digest); UQ(P,decision_digest,plan_digest,proposal_digest,base_accepted_revision_digest,decision_value) |

In `accepted_spec_revisions`, add one whole-row CHECK with exactly these alternatives:
Initial => all four optional columns NULL; Impact => base/plan/decision digest all NOT NULL
and decision_value='Approve'. The SQL expression must explicitly test decision_value IS NOT NULL
in the Impact branch, because SQLite CHECK accepts NULL. Initial is an explicit absent base;
it is not a fake empty accepted graph. Multiple historical rows are not evidence of multiple
lawful commands; future command transactions enforce single-winner first acceptance.

**HAI-V2-003**: Exact FK list (column orders below matter):

| Child | FK columns => parent columns |
| --- | --- |
| repository_binding_versions | (P) => projects(project_id) |
| specification_proposals | (P,repository_binding_id,binding_version,object_format) => repository_binding_versions(same); (P,graph_revision_digest) => dependency_revisions(P,graph_revision_digest) |
| accepted_spec_revisions | (P,proposal_digest,graph_revision_digest) => specification_proposals(same); (P,base_accepted_revision_digest) => accepted_spec_revisions(P,accepted_revision_digest); (P,impact_plan_digest,proposal_digest,base_accepted_revision_digest) => specification_impact_plans(P,plan_digest,proposal_digest,base_accepted_revision_digest); (P,activation_decision_digest,impact_plan_digest,proposal_digest,base_accepted_revision_digest,decision_value) => specification_activation_decisions(P,decision_digest,plan_digest,proposal_digest,base_accepted_revision_digest,decision_value) |
| accepted_revision_acs | (P,accepted_revision_digest) => accepted_spec_revisions(same); (P,ac_id,ac_revision_digest) => ac_revisions(P,ac_id,revision_digest) |
| accepted_work_item_bindings | (P,accepted_revision_digest) => accepted_spec_revisions(same); (P,work_item_id) => work_items(same) |
| accepted_work_item_requirements | (P,accepted_revision_digest,work_item_id,binding_digest) => accepted_work_item_bindings(same); (P,accepted_revision_digest,ac_id,ac_revision_digest) => accepted_revision_acs(same) |
| project_spec_heads | (P,accepted_revision_digest) => accepted_spec_revisions(same) |
| work_item_spec_heads | (P,work_item_id) => work_items(same); (P,accepted_revision_digest,work_item_id,binding_digest) => accepted_work_item_bindings(same); **deferred** (P,accepted_revision_digest) => project_spec_heads(same) |
| current_ac_requirements | (P,accepted_revision_digest,work_item_id,binding_digest,ac_id,ac_revision_digest) => accepted_work_item_requirements(same); **deferred** (P,work_item_id,accepted_revision_digest,binding_digest) => work_item_spec_heads(same) |
| specification_impact_plans | (P,proposal_digest,repository_binding_id,binding_version) => specification_proposals(same); (P,proposal_digest,proposed_graph_revision_digest) => specification_proposals(P,proposal_digest,graph_revision_digest); (P,base_accepted_revision_digest,base_graph_revision_digest) => accepted_spec_revisions(P,accepted_revision_digest,graph_revision_digest) |
| specification_activation_decisions | (P,plan_digest,proposal_digest,base_accepted_revision_digest,read_set_digest) => specification_impact_plans(same) |

The two deferred FKs use `DEFERRABLE INITIALLY DEFERRED`. All other references to already
inserted immutable history may remain immediate. SQLite allows forward table references in
DDL; create all tables before triggers and before inserting fixture history.
No FK references `projects.version` or `work_items.version`: those versions legitimately change
for unrelated commands. No new trigger couples ordinary phase/version updates to accepted heads.

Every WorkItem head must name an immutable binding in the current project revision. Every current
requirement must name an exact immutable requirement in that binding and the same committed head.
Moving a project head requires future transactions to carry forward or replace every retained
WorkItem head into that project revision, including unchanged semantic subsets. Delete/reinsert
current requirement rows or update them to the new immutable rows within that transaction.
Do not add immediate parent-change triggers that prevent this lawful transition.
SQL permits a subset or even no current requirements; full required-set equality is future trusted
command/read validation, not something the FKs falsely promise.

## Immutability, canonical bytes and authority

**HAI-V2-004**: The immutable tables are repository_binding_versions, specification_proposals,
accepted_spec_revisions, accepted_revision_acs, accepted_work_item_bindings,
accepted_work_item_requirements, specification_impact_plans and specification_activation_decisions.
Each gets unconditional BEFORE UPDATE and BEFORE DELETE triggers that RAISE(ABORT,'immutable').
Each also gets BEFORE INSERT duplicate-identity protection: abort when an existing row matches
**any** declared PK or UQ tuple. Generate each predicate from the exact ordered key list above,
joined with OR; compare each key column using `IS` to avoid NULL surprises. All immutable UQ
columns are nonnullable. This covers replacement through primary and alternate keys with
recursive_triggers off; no global PRAGMA or V1 trigger change is allowed.
Every alternate UQ in this definition is a superset of its table's PK. Consequently an
independently distinct alternate-key collision with a different PK is impossible in this V2;
tests must exercise every declared conflict target using lawful coincident-key fixtures and must
not fabricate independence. The guard still covers every declared key so subsequent reviewed
key changes cannot silently leave a replacement path unprotected.
Normal duplicate INSERT, INSERT OR REPLACE, REPLACE INTO, INSERT OR IGNORE and UPSERT cannot
rewrite or silently disregard historical identities. Future replay selects and verifies an existing
row before deciding no new insert is necessary; raw conflict-resolution SQL is not replay authority.
Distinct new historical identities remain insertable.

Project heads, WorkItem heads and current requirements are mutable normalized state, protected
by their FKs/shape constraints. Head-version positivity is storage shape, not an implementation of
monotonic advancement or compare-and-swap. Actor fields similarly store assertions, not SQL
authentication. Human activation decisions are separate from V1 completion approvals; a stored
Approve row alone never authorizes a command or proves activation occurred.

**HAI-V2-005**: SQL validates digest spelling, object-format/OID shape and relational scope only.
It performs no SHA-256 hashing, Git-object import, path confinement or canonical parsing. The
future trusted writer/reader must bound canonical encodings, verify their identities on write/read,
and verify every normalized field against the captured canonical content. Proposal canonical bytes
contain manifest/node provenance, source blob digests, typed edges and required AC/recipe bindings
from HAI-ADMISSION-001. Accepted canonical bytes contain the complete normative node/AC/graph
set and acceptance subject. WorkItem binding bytes contain exact spec/AC subsets plus recipe
bindings. These fields preserve content without claiming a new canonical codec is implemented.
Repository binding bytes contain approved identity/version/configuration, never merely a project's
legacy repository string. The content digest columns are not Git OIDs.
Future trusted activation validation also owns equality of accepted-revision and plan policy,
the complete read-set and human decision subject, and cross-record canonical-content agreement;
the exact scope FKs do not prove these semantic equalities.

An ImpactPlan's existing kernel digest binds its canonical identity, including old/new graph,
changes, cause paths, algorithm/policy, ReadVersion and relevant-Run fingerprint inputs. Preserve
that identity separately as `kernel_plan_digest`. `plan_digest` is the SHA-256 identity of the future
canonical durable envelope containing that kernel encoding plus proposal/base/repository/read-set
bindings; canonical_content stores that envelope. This avoids collisions between distinct provenance
captures with identical normative kernel plans. Future activation verifies the outer plan identity,
reconstructs the kernel plan and supplies kernel_plan_digest to existing ValidateActivation; it
must not pass the outer digest as though it were the kernel digest. The future envelope codec and
Run state/lease fingerprint/read-set mapping remain unimplemented, separately reviewed children.
A bare Run input digest cannot supply that mapping. This explicit two-digest choice requires root
ACK with the schema definition; no hashing or codec implementation is claimed here.

## Implementation and oracle envelope

**HAI-V2-006**: Add a new named public-startup Red before production changes:
`TestAcceptanceSchema_V1UpgradePreservesHistoryAndLeavesHeadsEmpty`. Build a lawful V1 database
with the frozen private V1 registry, populate actual Project/WorkItem/AC/graph/Run/history fixtures,
then public reopen expects schema 2 and all eleven empty new tables. Baseline fails specifically
because it remains schema 1 and lacks those tables. Never fabricate the Red by updating immutable
V1 rows or removing triggers. Compare all populated V1 logical rows and immutable schema objects,
allowing only the new V2 schema/history row and instance schema_version to differ.

| Passing named oracle | Required durable positive/negative assertions |
| --- | --- |
| `TestAcceptanceSchema_FreshUpgradeAndReopen` | Fresh public open applies literal V1 and actual V2 exactly once; schema=2; heads/requirements empty; changed-clock reopen preserves both history rows/timestamps, all state and checksums |
| `TestAcceptanceSchema_V1UpgradePreservesHistoryAndLeavesHeadsEmpty` | Empty and populated lawful V1 both upgrade; all V1 fixture/history/input bytes and versions preserved; no inferred repository bindings, proposals, revisions, heads or requirements; FK check clean |
| `TestAcceptanceSchema_RejectsUnknownAndOldBinary` | V1+V2+appended version3/state3 rejected unchanged by production; standalone malformed gap/checksum/type fixtures rejected; frozen V1-only runner rejects a real V2 DB unchanged |
| `TestAcceptanceSchema_ActualV2RollbackRestart` | Private trusted test registry uses **actual V2 SQL** followed by deliberate SQL failure within that pending step, with a matching test-only checksum; empty and populated V1 roll back every V2 object/history/state change. Separate fresh failure removes V1/ledger too. Then real public registry upgrades successfully; no testing triggers are dropped |
| `TestAcceptanceSchema_ActualV2CancelAndConcurrent` | Test-only cancellation callback after actual V2 DDL rolls back new schema/history/state; separate Store proves writer release. Independent public Stores converge to one V1+V2 ledger, or bounded typed Busy, with successful reopen |
| `TestAcceptanceSchema_ScopedRelationsAndHeadSwap` | Two-project/two-WorkItem/two-revision fixture; reject every cross-project/WorkItem/revision/AC/proposal/plan binding, mismatched OID format and NULL discriminator. Lawful full project+WorkItem+current-requirement swap commits; partial mismatched swap fails COMMIT and rolls back all heads/requirements. Ordinary project/WorkItem version updates still work |
| `TestAcceptanceSchema_ImmutableHistoryAndReplacement` | Each of eight new immutable tables rejects UPDATE, DELETE, PK-conflict REPLACE and every alternate-UQ-conflict REPLACE using unreferenced history where possible, with recursive_triggers off and unchanged rows; distinct-history inserts succeed |

Direct SQL in these fixtures proves storage constraints, not operator acceptance. SQL-positive
fixtures may use digest-shaped identities and small captured bytes; they cannot claim SHA validation,
complete canonical meaning, authorization, replay, readiness or future command transaction behavior.
No proposed oracle is executed in this design task. Commit I/O/process-kill testing remains separate.

**HAI-V2-007**: Preserve and narrowly adapt predecessor oracles; do not delete or weaken them.
`migrationChecksum()` and `SQLiteIdentity.MigrationSum` remain the frozen **V1** compatibility
identifier. `migrationVersion=1` is currently not a live latest-schema selector; preserve it or
rename it explicitly to V1-only if separately scoped, never silently make Identity return V2's sum.
Production `migrate` appends literal step 2 to V1; a private registry helper may avoid divergence
between production and tests, but no exported configurable registry is introduced.

Exact `migration_test.go` adaptations require the implementation child's explicit scope:

- Existing public reopen unknown-newer fixture appends 3 and sets state 3, because public open
  now already applied 2. State-mismatch sets 3 without its history. Valid reopen and missing-state
  assertions remain. Add actual V1-upgrade oracle above; do not relabel V2 reopen as V1 migration.
- Keep frozen V1-only fixture registry for real preupgrade DB and old-binary checks. Existing
  malformed-registry/standalone malformed-history cases remain intact. Ledger-only and signed
  timestamp controls may explicitly exercise V1-only mechanics without public latest-schema claims.
- Synthetic whole-batch rollback/restart extends **real production V1+V2** with synthetic 3/4.
  The earlier probe becomes 3; the later SQL/history-conflict/state failure becomes 4; successful
  history count/state assertions become 4. Restart after failure goes through real public V2 and
  afterward the private future registry; production still rejects successful synthetic future state.
  Indexes, conflict version literals and same-registry reopen assertions must change consistently.
- Cancellation appends synthetic step 3 to the real V1+V2 registry, retaining fresh and existing
  prefix rollback/snapshot/separate-Store assertions; add actual-V2 cancellation above rather than
  claiming synthetic cancellation alone tests actual V2.
- Public concurrent startup count/schema expectations become 2 with one exact row each for 1/2;
  preserve success-or-typed-Busy handling, fresh/existing cases and successful final reopen.
- Existing V1 pragma/checksum/immutable-history/Done tests in store_test.go should need no edits:
  they explicitly select version 1 and compare Identity to migrationChecksum. New tests separately
  assert latest schema 2. Extend logical snapshots to all new tables for V2 rollback/head controls,
  retaining complete V1 preservation assertions rather than filtering out unexpected changes.

Root ACKed this definition before issuing production/test scope; T-142 independently reviewed the frozen contract and implementation. Future canonical
codecs, import ports, admission auth/CAS commands, audit/result binding, current-head consumers,
runtime wiring, restore and UI remain separately assigned children.
