# Durable proposal command

Status: root accepted implementation contract, 2026-10-23; execution pending.
Parents: accepted-spec-admission HAI-ADMISSION-001/003/008, ADR-001/005,
proposal-import-core HAI-IMPORT-001..007. This is a bounded predecessor to full admission.

## Trusted binding and command

HAI-PROPOSE-001: `ProposeSpecification` carries ordinary command metadata, project,
expected project version, repository binding ID/version/digest, exact ref and manifest
path. The request cannot supply a filesystem path, executable, approval or Reader.
The service receives an optional trusted `RepositoryAuthority` dependency. Its bounded,
in-memory lookup returns the currently approved binding, approving operator, opaque
local configuration identity, allowed refs/manifest paths and immutable Reader. Missing
authority fails closed. Legacy Project.Repository/Ref never supplies approval.

The authority is a trusted application configuration boundary, not an HTTP endpoint or
generic plugin registry. Lookup must perform no filesystem/network/database I/O and return
copies. A change/revocation must be visible to the final transactional recheck. The current
approved configuration, not latest database version or timestamps, selects the active binding.
The canonical binding record binds schema=1, project/id/version, object format, opaque
configuration identity, sorted exact refs, sorted manifest paths and approving operator.
Its SHA-256 is the binding digest. Private local paths are excluded. Reject duplicate/empty
lists, invalid identities, zero version, wrong approver or a claimed digest differing from
canonical bytes. This child does not expose a runtime configuration or approval UI.

HAI-PROPOSE-002: Authenticate before authority or Git reads. Check exact recorded replay
before resolving a ref. Read project version and capture approved configuration; import
through the existing specification.Import outside the writer transaction. Recheck current
authority, project version and canonical binding bytes inside the command transaction.
Reject revoked/changed binding or project before writes. An uncommitted retry can capture a
new ref value; a committed retry always returns the original exact result without reading Git.

## Atomic persistence and results

HAI-PROPOSE-003: Extend the existing optional transaction-capability pattern with scoped
project/binding/proposal reads and inserts; do not enlarge every Transaction implementation.
Record trusted binding provenance, normative dependency revision and proposal in the same
transaction as canonical result, idempotency, audit and projection. Preserve immutable rows:
deduplication requires verified exact canonical bytes and normalized fields, never REPLACE
or unchecked conflict-ignore. On read, bound byte lengths, decode canonical proposal,
recompute digests and compare all SQL provenance columns. A matching normative graph may
be reused across different proposal provenance. Store no accepted head, current requirement,
phase change, Run, dispatch intent or fabricated evidence.

HAI-PROPOSE-004: Result `SpecificationProposed` carries project/version, proposal SHA-256,
graph SHA-256 and format-tagged captured commit OID; strict canonical codec validates the
operation/result combination. Existing results keep identical encoding. Existing execute/
replay/audit/event allocation must be reused. Perform recordable rejection checks before
any insert; all errors after inserts must roll back, including later result/audit/event faults.
Concurrent same-key commands produce one result/event group. Different keys may share
one immutable proposal while recording each command separately.

The projection event reuses `project.changed` with the Project ID and current project
version to invalidate that project's derived view. It must remain readable by the existing
SSE codec; no new unregistered resource kind is emitted. It does not claim a head or phase
change. New digest result fields use the existing `sha256:` wire spelling.

## Named verification

`TestAdmission_ProposalProvenanceAndCrashIsolation` is the service/real-SQLite oracle:
positive import/store/reopen; response loss replay after source loss/ref move; same-key
concurrency/conflict; different-key dedup and identical normative graph with different
provenance; auth and scope denial before Reader; binding revocation/change and project
version change during import; canonical/normalized corruption; cancellation and injected
postwrite failures leave no partial proposal/binding/graph/result/audit/event mutation.
Every case confirms accepted heads, requirements, phases and Runs remain unchanged.
Returned-error rollback does not claim process-kill or COMMIT-I/O evidence.

Add compilable stubs and a lawful positive failing assertion before production behavior,
then preserve that assertion through Green. Focused tests, full/race/vet/build and independent
review are required. HTTP/runtime/UI wiring and first acceptance are later dependencies;
this slice cannot claim full AC-02/03/04 or HAI-ADMISSION-007.

Dirty working-tree *input* is unsupported. Import reads only immutable Git objects and ignores
unrelated dirty files, as already required by HAI-IMPORT-005; no worktree cleanliness check or
working-tree fallback is added.

## HTTP/runtime continuation contract

HAI-PROPOSE-005: Add ProposeSpecification to the existing authenticated project command
ingress, with strict closed payload (repository_binding_id, binding_version, binding_digest,
ref, manifest_path), ordinary metadata, exact Origin and project authorization before reads.
The payload cannot supply executable/path/approval/Reader fields. Canonical result lookup and
SSE replay retain their existing guarantees. Keep support optional at the transport service
interface so unrelated command-only test doubles need not pretend to implement admission.
Update OpenAPI operation/payload/result definitions without loosening unrelated variants.

HAI-PROPOSE-006: Add authenticated, project-scoped
GET /api/v1/projects/{project_id}/repository-bindings/{binding_id}. The service verifies
operator, project existence and currently approved binding. Return only canonical public binding
configuration and its sha256:-prefixed digest; never Reader, local roots, executable or scratch
locations. This lets an operator construct the exact expected-binding proposal command.
Revoked/absent authority is unavailable; no Git I/O or persistence mutation occurs.

HAI-PROPOSE-007: Optional runtime environment variable
HAI_TASKBOARD_APPROVED_REPOSITORIES_FILE explicitly selects operator-approved local configuration.
Unset keeps proposal admission unavailable. The file is absolute, clean, regular, effective-UID
owned, mode 0600, without symlink components, and at most 64 KiB. Open safely, verify same-file
identity and bound reads; reject nonregular files without blocking. Strict JSON V1 contains
schema_version and repositories, maximum 32 unique (project_id,id) entries. Each entry has
project_id, id, version, object_format, configuration_id, approved_by_actor, refs, manifest_paths,
git_executable and git_dir. Operator must explicitly author approval; approved_by_actor must match
the configured local session actor. This is not approval inferred from a legacy Project path.

Private paths configure existing gitobject.New only; canonical public binding content/digest
uses HAI-PROPOSE-001. Reader scratch is under the private data root. Retain no secret values or
private paths in errors/results/audit. Runtime builds an immutable registry returning copied
allowlists. Changes/revocation require a full graceful process restart; old handlers/workers
join before storage/resources close. No hot reload, network, Git fetch, shell or provider code.
The trusted Git reader continues to require a normal/bare Git directory and same-filesystem
scratch; unsupported worktree/cross-filesystem configurations fail closed.

HAI-PROPOSE-008: `TestAdmission_HTTPReplayAndRestart` exercises the real runtime, HTTP,
SQLite and existing gitobject adapter against a newly created local Git fixture: create Project,
read approved public binding, submit proposal, inspect stored proposal provenance, replay exact
result after source ref move/loss and process restart, and consume valid existing SSE event
shape. Verify unauthenticated/wrong Origin/cross-project/unknown-field/mismatched binding denial
without import or state change. `TestRepositoryConfiguration_RejectsUnsafeInput` covers absent,
private valid file, permissions/owner where feasible, symlink/FIFO/oversize/unknown/duplicate/
wrong-version/mismatched-approver and malformed allowlists. Preserve lawful semantic Red before
wiring, then run focused/native and final pinned full/race/build plus independent review.
No first acceptance, Ready, browser workflow, restore or full AC is claimed by this continuation.
