# Mini-SDD: Durable Fake Run output provenance

Status: OUTPUT001/storage part of003 accepted locally after T009 correction, T013 independent
ACCEPT and root current-output-directory-integrated-20261023 full/race/vet/build. Original
T011 NUL/text-byte-bound REWORK is retained. OUTPUT002/consumer003 accepted locally after T012,
T027 independent ACCEPT and root completion-integrated-20261023 full/race/vet/build.
This does not accept connected candidate/evidence/Done UI.
Parents: domain-and-gates, persistent-fake-runtime, current-specification-inputs,
executor-and-security, ordered-migrations. HAI-local T990 identified the existing global
artifact registry as insufficient authority to select a Run's produced candidate.

## Immutable association

**HAI-OUTPUT-001**: Append compiled migration `0004_run_outputs.sql`; V1/V2/V3 bytes and
checksums stay frozen. Add one STRICT append-only `run_output_artifacts` table:
project_id TEXT, run_id TEXT, artifact_digest TEXT, input_digest TEXT, lease_epoch INTEGER,
restore_generation INTEGER. All fields nonnull; IDs nonempty, both digests64 lowercase hex,
epoch/generation positive signed integers. Exact digest checks and bounded metadata reads
measure bytes with CAST AS BLOB and reject embedded NUL; SQLite TEXT length alone is
not a byte bound. Preserve ordinary UTF-8 multibyte and NUL regression cases. Primary key(project_id,run_id,artifact_digest),
immediate NO ACTION FKs to runs(project_id,run_id) and artifacts(digest). Unconditional
UPDATE/DELETE abort and BEFORE INSERT duplicate-key abort cover replacement, ignore and
upsert. No backfill or inferred association from candidate/bytes/deterministic Fake hashes.
Old Runs and artifacts remain available as historical records.

Application-owned optional `RunOutputTransaction` provides `StoreRunOutput(ctx, RunOutputWrite)`
and `LoadRunOutputs(ctx, projectID, runID) ([]RunOutput, error)`. RunOutputWrite carries the
existing complete RunFence, artifact digest and PublishedAtNS; RunOutput returns immutable
project/Run/input/artifact/fence numbers plus verified Artifact metadata. The store checks
exact current holder and unexpired lease at PublishedAtNS in addition to epoch/generation.
It stores one verified association and loads
a complete digest-sorted output set for a scoped Run, bounded1024 records; one extra row
causes a capacity error, never silent truncation. New writes verify actual Run/project/input,
current held publication lease epoch/generation, Succeeded/Confirmed/None terminal facts and
Present immutable artifact metadata. They occur only inside the successful fenced publication
transaction. Exact existing association may replay only after comparing all immutable fields;
conflicts reject. Reads verify each association's Run/input, valid historical positive fence
identity and full immutable artifact metadata/storage key/digest shape. A historical output
can remain readable after lease/restore generation changes; do not require current lease on
history reads. No envelope/current-head inference is permitted for old history.

**HAI-OUTPUT-002**: After successful Run publication verifies outside-lock artifact bytes,
store artifact metadata and output association atomically with the fenced terminal facts,
audit/projection. Any error rolls back all database writes; staged orphan immutable bytes
remain nonauthoritative and are not automatically deleted. Failed/stale/unknown publication
creates no new output association. Exact valid repeated publication retains the same binding.
This records what the producer produced; it does not create Review, Evidence, Candidate or Done.

SubmitCandidate requires its exact manifest to equal the complete verified Run output set,
with matching digest/media type/byte length/Present state, candidate digest included, correct
Run input and all current-input gates. A global artifact from another Run/project cannot become
this Run's candidate. Preserve exact committed command replay and historical records; legacy
Runs without output associations cannot create a new candidate by inference. Recheck output
identities with the existing metadata snapshot/final-transaction pattern after external byte
reads. Project-authorized artifact download later uses a scoped output/candidate/evidence
association and verified bytes; it cannot enumerate or grant access through global hashes.

## Evidence

**HAI-OUTPUT-003**: Preserve compiling Red `TestRunOutput_V3UpgradePreservesHistory` for the
storage prerequisite and `TestRunOutput_FencedPublicationAndCandidateBinding` for its service
consumer. Cover fresh/populatedV3 upgrade without backfill, V1..3 unchanged, exact dedup,
all immutable replacement routes, cross-project/input/fence/artifact mismatch, corruption,
bounded complete reads, rollback/cancellation and reopen. Consumer tests cover actual successful
Fake publication, unrelated/global artifact rejection, stale fence, unknown result, full manifest
mismatch, postwrite failure and replay after authority loss. Existing negative predicates remain.
Storage-only passing tests do not accept service consumers or connected UI.
