# M1b — scoped Run outputs and artifact reads

Status: implementation plan accepted after Claude REWORK and one revision review (2026-10-30). Implementation and local verification now pass; delivery status is in BOARD.
Desk T-0339; supports H02 / SUCCESS AC-02 without accepting the full product.
Source: `e00866434e856d164a59516bc9c7de2f4770020b`; latest HAI change is M1a closure PR814.
Authority: accepted HAI-OUTPUT-001..003, HAI-AUTH-004, HAI-SEC-003, existing OpenAPI
project artifact endpoint and remaining-work M1b. This plan refines the authorized read slice;
no existing state transition, Done predicate, accepted AC, publication or restore rule changes.

## Scope and decisions

1. Add authenticated `GET /api/v1/projects/{project_id}/work-items/{work_item_id}/runs/{run_id}/outputs`.
   Reply is a closed JSON object with `project_id`, `work_item_id`, `run_id`, and `outputs` (0..1024).
   Every entry has `input_digest`, positive historical `lease_epoch` and `restore_generation`,
   and `artifact` (sha256, media_type, byte_length, availability=Present, href, disposition=attachment).
   Digests use sha256: plus64 lowercase hex; outputs strictly digest-sorted and complete.
   Empty/legacy/non-success Runs with no published association return an empty list.
   List validates persisted metadata, not object availability at a later instant or Done eligibility.
2. Implement existing `GET /api/v1/projects/{project_id}/artifacts/{sha256}` using only an
   immutable Run output association in that project. A global hash alone grants nothing.
   Wrong-project/unbound hashes and wrong WorkItem/Run list scope are indistinguishable404.
   A digest bound in two projects is independently accessible after each project's authorization.
   Candidate/evidence-only artifacts without Run provenance remain unsupported until their own slice.
3. Reuse optional output persistence capabilities and existing SQL associations. Add narrow
   scope/project-output read methods, with parameterized bounded SQL and existing metadata validation.
   No migration, global artifact enumeration or current lease/head requirement for historical reads.
   The service checks the configured operator before persistence; HTTP authenticates and authorizes
   project before a material lookup. Retain runtime Host and existing GET Origin semantics.
4. Download copies at most10MiB+1 into a bounded buffer outside the SQLite transaction, verifies
   exact byte length and digest, checks close/read/cancellation errors, then rereads the same immutable
   binding/metadata before returning any bytes. Use existing confined symlink-safe ArtifactStore.
   Historical lease/restore/head changes do not invalidate immutable published output.
   Any ArtifactStore.Open failure503 projection_unavailable (the existing port deliberately has no
   missing/integrity taxonomy); service-detected corrupt metadata/digest/length or changed binding503 storage_corruption;
   dependency missing/failure503 projection_unavailable; unsupported active media422 lifecycle_rejected.
   No availability, command, audit, outbox, projection or domain writes on these reads.
5. Download allowed canonical MIME bases: text/plain, text/markdown, application/json,
   application/octet-stream. Only optional case-insensitive charset=utf-8 on textual/JSON types; no parameters on
   octet-stream. Other types (including HTML/SVG/script/XML) fail closed before opening bytes.
   Bytes are never interpreted/rendered: HTTP always sends application/octet-stream, attachment
   with a digest-only filename, nosniff, no-store and a quoted digest ETag. Range and conditional
   headers do not bypass verification; return complete200 after validation, never partial/304.
6. Validate all identifiers and canonical paths; invalid IDs404, noncanonical path400. Intercept
   dot resource segments before ServeMux redirects for these two reads. Errors have fixed messages,
   no filesystem paths, artifact text, storage keys or internal causes. Validate service output at
   the HTTP boundary (strict closed JSON/required fields, counts, byte limits, scope and identities).

## Exact read protocol and review dispositions

The following resolves Claude plan review B1..B11; original REWORK is retained.

- Scope proof: `runs.project_id`, `runs.run_id`, `runs.work_item_id` must match the requested
  triple before invoking LoadRunOutputs, in the same UnitOfWork callback. Missing/wrong scope
  returns port.ErrNotFound directly, avoiding LoadRunOutputs' historical no-row corruption wrapper.
- Project artifact selection: parameterized query on run_output_artifacts `(project_id,artifact_digest)`
  selects `ORDER BY run_id LIMIT 1`. Verify that selected association's Run/project/input, positive
  historical fences and immutable artifact metadata using the existing LoadRunOutputs rules.
  A corrupt selected binding rejects; do not fall back to another binding or scan all project outputs.
  Capture the entire selected RunOutput tuple (project,Run,input,digest,epoch,generation,Artifact);
  reread that same Run+digest association after bytes, not a newly selected association. A newly
  appended lexically earlier Run does not invalidate the chosen binding. Missing or changed selected
  association on the final read is503 storage_corruption, including replacement with older DB state.
- Exact precedence: canonical path400; session401; project authorization404; ID/scope/binding404;
  corrupt metadata503; allowed MIME policy422; Open failure503 projection_unavailable; bytes
  verification/read/close failure503 storage_corruption; canceled context503 projection_unavailable.
  Thus an unsupported-type object bound only in projectB still returns404 when requested in A.
  All404 bodies/headers use the same fixed `resource is unavailable` response.
- Metadata range is0..10485760 bytes for both list and download, checked before allocation/Open;
  >limit corrupt503. Zero remains allowed by accepted HAI-INTEGRITY-003 and ArtifactLocator.
  Existing localArtifactStore refuses empty files; its refusal becomes503 projection_unavailable
  and is tested/documented, not changed to a min1 acceptance rule. Non-Present/invalid metadata
  fails the complete list503; never omit rows. Existing immutable availability rules remain.
- Historical integer fences are1..9223372036854775807; OpenAPI declares these bounds. No JS
  consumer is added here; future UI must preserve integers above2^53 losslessly. Max1024 outputs,
  byte-bounded closed response <=1MiB; count1025 yields503 storage_corruption with no truncation.
- The local single human operator has both artifact.read and project.read. AuthorizeProject then
  service operator check and DB project binding jointly enforce the existing permission label;
  no new role is granted. Cross-project association tests use real SQLite. Explicit project-denial
  tests use SessionAuthority doubles because local runtime authorizes its operator for nonempty IDs.
- href is exactly `/api/v1/projects/{project_id}/artifacts/sha256:{64lowerhex}`. Existing
  canonicalPath checks RawPath and EscapedPath before mux; percent-encoding, doubled slash,
  backslash/NUL are400. Uppercase/bad hash or missing prefix are404. Trailing slash is404,
  dot IDs404 without redirect. Query strings are ignored (no scope/range/selection parameters).
  Both list and artifact paths intercept dot segments before mux after canonicalPath validation.
- HEAD on these GET patterns is explicitly405, Allow: GET, with zero material reads; identity
  checks still precede method rejection. HEAD cannot enter byte verification or return artifact
  headers. GET Range/If-None-Match do not alter the complete verified200 result.
- Service uses current UnitOfWork.Within: bounded BEGIN IMMEDIATE metadata-only SELECT and
  empty COMMIT, or rollback on error. This briefly takes the writer lock; it is not a deferred
  transaction promise. All file I/O is outside it, matching accepted preflight architecture. A new
  read-only transaction abstraction is excluded. Tests instrument I/O outside callback and compare
  every persisted table on success/rejected reads; filesystem directory contents stay unchanged.
- Deterministic fault seams: supplied ArtifactStore readers yield wrong bytes/limit+1, error on
  read/Close or cancel context; wrapper UnitOfWork changes the selected immutable tuple only on
  final snapshot to exercise impossible-through-SQL corruption without disabling real triggers.
  Real SQLite tests separately prove append-only metadata protections and historical survival.
- Optional interfaces on existing *Service are automatically used by current NewServer wiring;
  no composition-root change is needed. Add real-service HTTP and local confined-store chain
  evidence. Error responses retain no-store/nosniff and never attachment/ETag. Exact success
  disposition is `attachment; filename="{64lowerhex}.bin"`; additionally CSP sandbox/default-src
  none, CORP same-origin, Accept-Ranges none. Check cancellation and session revocation immediately
  before response publication. No atomic external host-writer guarantee is implied.
- Root updates OpenAPI with list/schema maxItems and integer bounds plus artifact responses
 400/404/422/503, no-store/nosniff, attachment and quoted `"sha256:{64lowerhex}"` ETag.

## Implementation confirmations from accepted plan review

C1: existing OpenAPI SHA256 already requires `^sha256:[0-9a-f]{64}$`; listed hrefs follow that
unchanged contract and are followed in the integration test. C2: download intentionally invokes
the complete selected Run output loader; a corrupt sibling or1025 rows rejects503, with no fallback.
C3/C4: context cancellation takes precedence over read/close errors (projection_unavailable);
Open failures, including runtime-detected tamper, are projection_unavailable; bytes detected after
Open are storage_corruption. Tests assert each exact code, not merely503.
C5: successful application publication already caps bytes at maxRunArtifactBytes=10MiB in
service/vertical.go. The lower-level SQL port admits int64 metadata; a directly injected larger
row is explicitly unsupported by these HTTP reads and fails503, not truncated.
C6: cmd/taskboard/output_access_test.go owns real Service/SQLite/localArtifactStore HTTP wiring
evidence; no composition production change. C7: HEAD order is canonical path, session, project
authorization, syntactic IDs, then405 without a material query. C8: fault UnitOfWork wrappers keep
the optional read interfaces and assert storage_corruption to avoid a false capability-missing pass.
The existing store may hash then the service buffers at most10MiB again; no concurrency framework
is added for the current single-operator slice.

## Fixed acceptance cases

- ACCESS-AC-01: no session401; project denial404; invalid project/item/run/digest and dot/encoded
  paths refuse with no sensitive read. Capability absent503 and sanitized no-store errors.
- ACCESS-AC-02: real SQLite successful Fake output is listed with exact historical input/fences,
  deterministic order and authenticated href; wrong item/run/project rejects, legacy empty succeeds,
  1024 accepted/1025 rejected, malformed metadata rejected. No inferred associations.
- ACCESS-AC-03: exact bound bytes downloaded with safe headers, no global-hash/cross-project leak;
  missing, tampered, truncated/oversized, symlink, active media, changed binding and canceled reads
  return no object bytes. No range/conditional bypass.
- ACCESS-AC-04: repeated GET and Store close/reopen return the same immutable output; historical
  reads survive later current-head/lease/restore changes; compare all persisted tables before/after
  read scenarios to prove no commands/audit/outbox/projections or acceptance changes.

## Implementation and checks

Root owns this plan, OpenAPI, SUCCESS/BOARD/traceability/HANDOFF and acceptance. One bounded Go leaf
may own port, sqlite read adapter, application read service, HTTP handlers and focused tests only;
no recursive delegation. Claude Code independently reviews this plan and the final code packet.

Start with compiling failing HTTP route tests, then implement minimal read capabilities and real SQLite
regressions; retained failures stay evidence. Run focused service/sqlite/http/runtime tests, then original
pinned backend full/race/vet/build, web30/type/lint/format/build, fixed Redocly lint, project-success,
indexes, local document links, report validators and required PR CI. Existing filesystem confinement
tests are supplemented only if the new call chain is not established. No new browser acceptance.

Root active estimate60–90minutes,20minute checkpoints; one Go leaf30minutes if used. Claude Opus5.5
high, fresh no-tools source packets,8minutes each plan/code review, at most one changed-input follow-up
per phase. Existing installed CLI/profile only; no auth/config install or fallback. CI20minutes per round,
same-failure initial plus at most two reasoned corrections. Provider telemetry only from actual receipts;
aggregate unknown remains null. No M1c, M2, UI, real provider, dependencies, migration, release or deploy.

Deliver via normal PR/checks/merge/readback, then BOARD-only closure and desk sync. Full product
AC02/03/04 remain pending; next planned slice M1c remains unstarted.
