# M3-U original-data recovery investigation

Owner continued after offline preflight PR1077/1078. Existing M3-U/FN04/FN07 only.
This task locates the original AP data or an evidence-backed recovery candidate before
any service window. Container absence is not proof of volume/data deletion.

## Scope and acceptance before implementation

| AC | Requirement | Verification |
| --- | --- | --- |
| DATA01 | Read-only current local Docker metadata and PostgreSQL directory inventory; preserve uncertainty and private identifiers | Structured local receipt; no service, volume creation/removal or credential changes |
| DATA02 | Bounded offline identity evidence tied to original writer/reviewer and candidate/review references; distinguish candidate from logical restore/acceptance | Inspect only explicitly selected PostgreSQL data paths; no SQL or live server; if a helper is needed, tests cover bounds, no-follow reads and ambiguity |
| DATA03 | Concrete recovery decision, independent review, required checks/CI and normal delivery | Acceptance/BOARD records; original FN07 remains incomplete |

Allowed writes: this component's acceptance/helper/test documentation and local private
receipts. Source PostgreSQL volumes, original dumps/config/SQLite and old intents remain
unchanged. No original-service start, credential repair, restore, new store, provider/VM,
new paid tools or full owner-operation gate. Do not execute a dump as SQL or manufacture
AP rows from browser artifacts. Public receipts contain only counts/hashes/alias results;
volume paths, DB contents, credentials and raw service data remain local.

A physical byte match can nominate a candidate, not prove current committed rows,
consistent database state, complete archives, application identity or safe startup.
Any required privilege denial or missing data remains explicit. Do not bypass a denied
read by mounting an original volume writable or booting a database.

Results and recovery action will be added from actual evidence. Prior preflight and
historical evidence remain intact; no present readiness is assumed.

## Bounded metadata probe profile

Host direct reads of112 Docker volume directories are permission denied; sudo without
password is unavailable. Retain both failures. One local diagnostic image may package
only the already installed BusyBox executable and its required system libraries; no
registry download or PostgreSQL server. The generated artifact is a disposable tool,
not a product dependency. Before starting, inspect the exact container configuration:
network none, read-only root and bind mounts to existing enumerated Docker data paths,
cap-drop ALL, no-new-privileges, fixed unprivileged postgres UID999/GID999, pids16,
memory64MiB and CPU0.25. No privileged mode, host network/socket or broad host mount.
Only metadata/content explicitly allowed by this investigation may be read; no recursive
shell dump or arbitrary source execution. Missing/unreadable versions stay unknown;
no UID guessing or permission change. Retain launch/exit, limits and original-data
nonmutation evidence; cleanup only this task's exact owned stopped container/image.
This is a bounded read-only diagnostic process, not an AP/PostgreSQL service window.

The first UID999 pass found no readable root/nested version file and28 inaccessible
roots. A same-profile metadata-only stat pass measured28 roots owned by UID70/GID70
with mode0700, plus35 UID70 roots with mode1777. A bounded UID70/GID70 pass may inspect
those observed PostgreSQL-layout candidates with all other restrictions unchanged.
This selects a measured numeric owner, not UID guessing or a permission change;
unreadable/missing paths remain explicit. No root, DAC capability or chmod is added.

The measured-owner pass found30 PostgreSQL directories:2major18 and28major16.
Both retained AP native backup manifests require major18. Restrict identity scanning
to those two major18 aliases. Inspect regular, non-symlink physical relation files
under base/<database oid>/<relation> only; maximum4096files and128MiB per candidate,
maximum8MiB per file, host deadline60s. Match only the two known U07 run UUIDs and
published candidate/review SHA256 text; retain file identity/hashes privately, publish
only alias/count/match booleans. No raw tuple/string output. Matching dead tuples may
exist: results nominate a recovery candidate and never prove live committed state.

## Offline snapshot verifier contract (before code)

One major18 candidate contains both required U07 run UUID strings; the other does not
within the bounded relation scan. Preserve one private uncompressed tar snapshot from
the matching candidate's PGDATA through the same read-only diagnostic profile. No
private archive enters Git. No symlink dereferencing; copy stdout directly to a0600
operator-owned file, cap transfer512MiB/60s. Compare snapshot member hashes to a second
read-only source pass; mismatch/timeout means incomplete evidence, not a usable backup.

A small Python-standard-library verifier under acceptance/owner-data-recovery/ reads
an explicitly supplied uncompressed tar and required SHA256 digest. It never extracts,
executes a member, launches Docker/SQL or opens a database. CLI output is bounded JSON:
archive hash/counts/bytes, major18 check, two fixed run-marker booleans and the status
candidate_only / no_matching_identity; no paths, raw values, errors or credentials.
Reject wrong digest, invalid/truncated tar, duplicate/path-traversal/absolute/backslash
member names, special/link members, missing/wrong PG_VERSION, >10000members, >512MiB
archive/member-total or >64MiB member. Scan identity text only in regular numeric base/
DB-OID/relation files, at most8MiB/file and128MiB total; missing markers never prove data
loss. Root directory '.' and one canonical './' prefix are accepted. SHA and structural
validation precede a successful result. Unknown errors fail closed with fixed reasons.
The verifier may read dead/stale tuples; it does not verify transactions, PostgreSQL
control/WAL compatibility, logical AP identity, archives or safe startup.

Test skeletons: genuine two-marker candidate; one/no markers; wrong SHA; wrong/missing
version; duplicate/path traversal/absolute/backslash; links/special; archive/member/count/
relation budget; malformed/truncated tar; boundary-split marker and nonrelation-only marker;
no extraction / no secret/path leakage. Existing product APIs and runtime contracts stay
unchanged. DATA02 acceptance uses this offline evidence plus clearly limited recovery plan.

The only CI change adds the diagnostic unittest command to the existing Fanzloud
workflow. All existing jobs, permissions, triggers and required checks remain intact.

## Observed result and concrete recovery proposal

[Evidence and acceptance](M3-owner-data-recovery.acceptance.md):112 retained volumes,
30 PostgreSQL directories, two major18 candidates. Exactly one contains both published
U07 run UUID texts within the bounded numeric-relation scan. Neither published artifact
SHA text was found; this cannot distinguish missing data from binary/TOAST/compressed
storage. The major18 backup manifests match the physical candidate's version.

The selected physical snapshot is69,191,168bytes, two source captures byte-identical,
SHA256 `9b72f117cf9ded9d09b9632bb86975ac48027186a297dc9b2445b58050b845c6`.
The offline verifier accepted structural/hash limits,1488members and1074numeric relation
files/28,696,576bytes; both run markers matched. Result is **candidate_only**. Original
volume identifiers, mount paths and archive contents are kept only in the protected
operator packet. No evidence that the original data was deleted; no claim it is already
logically restored or safe to start. All previous historical/readiness limits remain.

Next execution should be a separately reviewed **isolated-copy validation**, not a start
of the original volume. Use a fresh disposable private directory populated from this
exact verified snapshot. Establish its PostgreSQL18 build/extension/locale compatibility
before startup; prefer the original pinned image digest from the protected setup record,
whose local image is currently absent. Obtaining the exact image is a prerequisite, not
a claim that one is installed. Bind no original source writable, expose no TCP port,
use network none/no worker/connector/provider, and authenticate locally via existing
trusted administrator procedure without publishing or replacing original credentials.

Before that run, prepare a concrete launcher and independent checks for safe extraction,
symlink/special rejection, exact input hash, bounded disk/time, private socket-only service,
owned process cleanup and stopped-state evidence. Restored PostgreSQL may write WAL/control
state only inside the disposable copy. Do not replay unknown AP commands, restore a seed
credential or reconstruct rows from browser receipts. Original store/config/intents are
never targets of this proposed run.

The minimum logical query set compares the existing four confirmed SQLite references to
AP tasks/runs/commands and exact command-route/request/receipt lineage, then both U07
writer/reviewer states, immutable candidate/archive bytes and hashes against the retained
accepted downloads. Inspect maintenance identity, migrations, schema compatibility and
quiescence, preserving any unexpected active/unknown state. Physical UUID matches are
insufficient. If records are absent/inconsistent or shutdown unconfirmed, retain not_ready
and the copy; do not start a new task or silently substitute the older maintenance dump.

Only after that concrete offline-copy plan and controls are reviewed can its execution
be separately authorized. A successful logical comparison would resolve the data-location
and recovery-candidate question; current-source UI/binary selection, full operation gate,
TLS/trust, owner presence and actual FN07 still remain distinct requirements.
