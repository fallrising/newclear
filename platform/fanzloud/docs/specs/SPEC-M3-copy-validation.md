---
id: SPEC-M3-COPY-VALIDATION
status: verified
contract_units: [CU-M3-U01, CU-M3-U02, CU-M3-U04]
---

# Isolated physical-copy diagnostic

Existing M3-U/FN04/FN07 continuation after PR1081/1083. Implement the concrete
launcher and comparisons required by [the recovery proposal](../acceptance/M3-owner-data-recovery.md).
Development uses synthetic data only. Original private-copy execution is NOT_RUN;
the separately reviewed execution decision remains pending. No product deployment,
original volume mount, original configuration/credential change, AP worker, provider,
VM, command replay, migration or reconstruction of missing application records.

## Contract and acceptance before implementation

| AC | Required behavior | Verification |
| --- | --- | --- |
| COPY01 | Exact-digest, bounded private staging; reject unsafe archives, recovery signals and reuse | Synthetic filesystem tests, inherited verifier tests; unchanged source hash |
| COPY02 | Fixed-image, unprivileged, network-none PostgreSQL copy with autonomous deadline and confirmed cleanup | Synthetic real PostgreSQL/container smoke, timeout/failure tests and inspected launch profile |
| COPY03 | Read-only schema/migrations, maintenance identity, quiescence, four command/request/receipt/task/run references and exact U07 archives/lineage | Synthetic valid/missing/mismatched cases; existing AP schema/quiescence validators reused unchanged |
| COPY04 | Independent document-driven review, required checks/CI, merge/readback and explicit runtime limits | Acceptance report and BOARD |

### Filesystem, compatibility and secrecy

Python host uses the existing AP dependency environment (psycopg and AP validation
modules), never installs a new product dependency. Existing stdlib verifier remains
unchanged. Copy the explicitly supplied regular no-follow archive to a newly created
0700 packet; verify its SHA and all original tar limits before manual extraction.
Never use extractall, preserve ownership/mode, follow links, or overwrite an existing
packet. Extract regular files0600/directories0700 only. Source is protected/quiescent;
this does not defend against a malicious same-UID writer. Reject standby.signal and
recovery.signal. Preserve original config bytes in staging; runtime ignores them.
Archive plus extracted data are bounded by twice512MiB; failed staging stays private
and cannot be reused. Check at least15GiB free before preparation.

Use only original pinned image
`postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873`,
pull-never at launch. Inspect image platform/version before execution. The locally
obtained linux/amd64 image declares PostgreSQL18.6 and /var/lib/postgresql volume;
this does not establish original cluster locale/extension compatibility. Server
startup and unchanged AP schema validator must succeed; incompatibility fails closed.

### Runtime boundary and lifecycle

One exact owned container, user current nonroot UID/GID, read-only root, network none,
no ports, cap-drop ALL/no-new-privileges, pids64/memory512MiB/CPU0.5. Staged source and
fixed tool files are read-only binds. Only a fresh0700 Unix socket directory is a
writable host bind; no original archive/config/SQLite/volume/socket is mounted.
The image's declared volume is replaced with a256MiB tmpfs for all PGDATA writes;
other runtime temporary storage is bounded. No anonymous/named volume creation.
Run a foreground server on a private Unix socket, with copied auto.conf emptied,
copied stale postmaster.pid removed and explicit controlled configuration. No TCP,
SSL/preload/archive/restore commands, logical replication or autovacuum workers.
Local trust applies ONLY to the private disposable socket; original auth is untouched.

PID1 remains a shell waiting for a BusyBox timeout child; it must not exec the timed
child. The child receives KILL at120s and PID1 exits, destroying remaining processes.
Thus host death does not leave a database indefinitely running. Host Docker calls
have bounded timeouts; DB statements10s/connect2s and whole probe bounded by container
lifetime. Record intent before create, created identity before start, started and
outcome. Never retry an ambiguous create/start. Inspect the exact launch boundary
before starting. On every outcome stop that exact owned container and confirm stopped
before remove. If inspection/stop is unknown, retain outcome_unknown and do not retry
or claim cleanup. A failed diagnostic/outcome write must never downgrade outcome_unknown;
report receipt_persisted=false. A verified result without its durable outcome becomes
not_ready. Runtime tmpfs is disposable; retain protected staged input/receipts
for diagnosis. Cleanup never removes original data or uses a global prune.

### Logical check and result

Reference SQLite is explicitly supplied, regular no-follow and bounded, with no
nonempty WAL; use an immutable private copy. Exactly four confirmed rows, canonical
IDs and supported create/review routes are required. Hash each canonical request as
AP does. Compare command operator/route/key/payload hash/run/status/202 receipt,
task ownership/identity/request fields and stable run identity/base/profile/goal.
Do not compare mutable live state to the historical queued receipt. Query only
specified records; limit command/result/archive sizes, and use parameterized SQL.

In a repeatable-read, read-only transaction invoke existing AP backup._schema and
backup._quiescent; never backup restore/finalize/migrate or write draining flags.
Require exactly one maintenance identity, major18, both U07 runs succeeded with
confirmed cleanup, exact candidate/review archive bytes through published SHA/size,
writer diff hash, reviewer candidate bytes, context and first-review lineage. Unknown,
missing, active or mismatched evidence means not_ready. A successful comparison is
only logical_candidate_verified, never original-runtime-ready or FN07 acceptance.

Public output contains fixed status/reason/check booleans/counts/hashes only. Raw
SQL rows, request/receipt/connection values and Docker logs stay private; exception
messages and user paths never reach public output. No passwords are accepted or
needed for the disposable socket. SQL errors are fixed typed diagnostic failures.

Test skeletons precede code: successful staging and source unchanged; unsafe/reused/
signal archive rejected; four references vs wrong count/state/route/receipt; valid
logical snapshot vs each binding/hash/state/lineage failure; launch mounts/security/
deadline; stop/inspect unknown fails closed. Real synthetic PostgreSQL smoke covers
actual binary, socket, read-only SQL, disk limit, parent-independent timeout and
stopped-state cleanup. No private candidate is used in development tests.

## Concrete private-copy execution proposal (not executed)

After review and owner approval, perform one invocation with the protected original
69,191,168-byte snapshot SHA256
`9b72f117cf9ded9d09b9632bb86975ac48027186a297dc9b2445b58050b845c6`,
the unchanged original four-confirmed-reference SQLite, and a new0700 private packet.
Use this reviewed tool revision, the pinned image above, the already installed AP
Python3.12.3 environment/psycopg3.3.6, and only the existing database/administrator role
names from the protected original configuration. Do not pass, restore or publish its
password. The expected two archives/diff hashes are fixed in the tool.

Maximum one container launch, autonomous120-second runtime,256MiB PGDATA tmpfs,
512MiB memory, no network/port/provider/worker. Preparation creates a private staged
copy only; every container data write goes into disposable tmpfs. Retain protected
receipts and original/staged evidence. Stop/remove only the exact confirmed owned
container. A mismatch, unknown state or unconfirmed cleanup stops the process;
no automatic new copy, older-dump substitution, service startup or mutation follows.
Even a logical match leaves actual owner operation/current UI/TLS and FN07 pending.
