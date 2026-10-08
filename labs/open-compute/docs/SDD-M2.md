# SDD: complete Local cold backup and clean-state restore

Status: implementation contract; execution results belong in [STATUS.md](STATUS.md).
Created: 2026-10-08. Scope: `labs/open-compute` and its existing root CI workflow.
This document extends [M1](SDD.md); the M1 contract and evidence remain intact.

## 1. Outcome and boundary

M1 proved normal daemon restart with the original files still in place. M2 asks
whether a complete cold backup contains enough authority to restore the same
deployed application after the source scope has actually been removed.

The outcome is a reproducible, synthetic **Worker + D1 + R2 + waiting Workflow
→ graceful shutdown → verified full backup → source removal → empty-scope
restore → original Workflow completion** experiment. Upstream remains the
original open-compute `v0.2.4` release. [upstream.lock.json](../upstream.lock.json)
continues to pin source commit `73efa56a1b1ad51a4519b2253ffaa499cb29fb2d` and Linux
x64 artifact SHA256 `8829a5bcb334dd3bbd8dc949ad9a2afdfe0e1fef44035c041556cd12087c586f`.
There is no runtime fork, new storage service, or adapter in this milestone.

The test uses **the same disposable non-root Linux runner, passwd scope path,
and UID**. It restores into a newly created directory tree and starts a new
daemon process, using only the verified backup for persistent state. This is a
clean-state cold restore. It does not establish a different physical host, OS,
UID, arbitrary path relocation, HA, power-loss recovery, or version migration.
Keeping the same path and UID follows the pinned Local operator restore
runbook; a later cross-host test remains a separate gate.

## 2. Why a full directory backup

For the Local object backend, the pinned `ocd backup restore` implementation
refuses restore. Its platform snapshot deliberately excludes the `objects`
tree, so snapshot references cannot replace an independent copy of object
bytes. The supported operator procedure is to stop the daemon and preserve the
complete data and configuration authority. See the [Local backup guide][backup],
[restore implementation][restore], [snapshot exclusions][snapshot], and
[fresh-host runbook][fresh-host].

This experiment enables one instance, one Worker deployment, one D1 database,
one Workflow, and one R2 bucket. It does not enable gateway or external storage.
The backup must preserve all persistent files in this owned instance, including
products not individually asserted by the fixture; it must not cherry-pick SQL
rows or reconstruct state from successful HTTP observations.

| Authority | Required preservation |
| --- | --- |
| Scope registry and authentication | Actual `ocd.toml`, its instance declarations and server configuration, and referenced scope keys |
| Instance configuration and identity | Actual `instances/lab/compute.toml`, absolute data/key references, existing instance identity and tokens |
| Complete instance data | `control.sqlite`, `scheduler.sqlite`, D1 files, keys, and any SQLite sidecars still present after shutdown |
| Local object authority and payloads | Complete `objects` tree, including `format.json`, Worker bundle bytes and R2 object envelopes, metadata and bytes |
| File contract | Relative paths, file/directory types, modes, sizes, hashes and current UID; new regular files have link count 1 |

The same-path restore leaves the actual config bytes unchanged. No configuration
rewrite, new master key, resource recreation or database export/import substitutes
for recovering the saved authority. Local storage validates ownership and
private file permissions; hard-link copies are not valid restored objects.
Relevant sources are [instance setup][setup], [data directories][data], and
[Local filesystem checks][local-fs].

## 3. Interfaces and implementation shape

- `make check` runs the existing offline contracts plus focused M2 failure tests.
- `make integration` keeps the existing M1 normal-restart scenario.
- `make integration-restore` runs M2 end to end with the same `LAB_ARGS` cache,
  output and port options. Its CLI counterpart is `python3 lab.py integration-restore`.
- A small standard-library archive helper handles inventory, integrity checks,
  private backup storage, staged extraction and ownership transfer. The existing
  harness retains artifact, process, HTTP, timeout, credential and report policy.

CI runs both runtime scenarios sequentially on a fresh non-root Linux runner.
Each invocation creates its own scope and must remove it before the next starts.
The pinned binary cache can be reused after re-verifying size and SHA256. Separate
sanitized report files are the only uploaded outputs. Backup files, manifests,
configs, keys, raw database files and runtime logs are never uploaded.

## 4. Source workload and observations

The M1 job submission and instrumented Workflow remain the stateful probe. M2
adds a small fixed-key R2 sentinel through the same trusted Worker, with bounded
input validation and no arbitrary code, path or outbound URL interface.

Before shutdown, the harness must establish all of the following:

1. The real instance is running; a Worker deployed through v4 answers requests.
   Two identical job submissions retain one D1 row.
2. The original Workflow ID is publicly `waiting`; its instrumented callback is
   publicly committed, the D1 counter is 1, and its nonce is captured.
3. R2 accepts a small binary payload containing zero, high-byte and newline
   values plus per-run random data. A read returns exactly the original bytes.
   The harness validates content SHA256, size, HTTP metadata, custom metadata,
   `writeHttpMetadata()` headers, and nonempty etag/version/uploaded identity.
4. Read-only deployment APIs return the existing deployment ID, version ID,
   script etag, compatibility settings, and D1/R2/Workflow bindings. These are
   captured for equality checks after restore. The D1 database ID, account ID,
   instance ID, Workflow ID and R2 key also remain fixed.

Only the source phase may run instance setup, create the database or bucket,
deploy the Worker, seed the R2 object, submit the job or create the Workflow.
After backup, the harness cannot use these operations to repair missing state.
The saved HTTP observations are assertion inputs, never a restore data source.

The Workflow's existing five-minute event timeout remains unchanged. Restore
does not reset or edit persisted deadlines. A single 120-second monotonic budget
begins before source shutdown and covers cold backup, source removal, staged
restore, daemon readiness and read-only recovery checks. Deadline exhaustion
fails M2; cleanup retains its own finite bounds. The approval and terminal poll
must also complete within the original Workflow's wall-clock deadline.

## 5. Quiescence and complete backup

The harness records the original daemon identity and its observed supervised
children. It requests SIGTERM, requires exit code 0 without forced termination,
and proves all observed owned process identities have exited. Any unknown
process observation or log-reader failure fails this gate. It then validates
the owned source scope marker and root identity.

Before reading state, it acquires nonblocking exclusive `flock` locks on the
exact source scope `ocd.lock`, instance data `platform.lock`, and Local object
`objects/backend.lock`. Existing unsafe lock paths or a held lock fail before
backup or deletion. Lock descriptors remain held through source removal. This
is an additional quiescence check; it does not authorize adopting another scope
or claim protection against a malicious process with the same UID.

The backup package is created exclusively in a private, run-owned temporary
directory outside the source, restore staging, output and artifact cache. It
contains the complete payload and a machine-readable inventory. Paths in the
inventory are canonical, relative to the scope root, with unique entries and
explicit file/directory types. Files record byte length and SHA256; directories
record modes. Runtime-only exclusions must be an explicit path table, rooted at
the scope or the one known instance data directory. Matching arbitrary basename,
suffix or recursive glob is prohibited: an R2 payload may have such a name.
The harness's own source ownership marker is excluded from runtime authority.

The fixed exclusion table for this instance is:

| Root | Exact relative paths | Exclusion |
| --- | --- | --- |
| Scope | `cache`, `tmp`, `run` | Those subtrees only |
| Scope | `ocd.lock`, `.open-compute-lab-owner` | Those files only |
| `instances/lab/data` | `cache`, `tmp`, `runtime` | Those subtrees only |
| `instances/lab/data` | `platform.lock`, `objects/backend.lock` | Those files only |

No other path is excluded. In particular, preserve object marker/payload/multipart
trees and any SQLite sidecars. This table is for the fixed fixture without native
extensions; it is not a generic production backup policy. Upstream also uses
`runtime/extensions` for extension provider working directories, which this lab
does not create. See [restored layout construction][layout] and [lock behavior][locks].

Only regular files and directories are accepted outside the listed transient
paths. Symlinks, hard links, sockets, devices, FIFOs, path traversal, duplicate
entries, unexpected UID/modes and unbounded inventory/payloads fail closed.
Archive entries cannot nominate new exclusions or filesystem destinations.
The fixed small-fixture bounds are 4,096 entries, 64 MiB per file, 256 MiB total
regular-file bytes, 4 MiB manifest bytes, 512 UTF-8 bytes per relative path and
288 MiB payload archive bytes. Exceeding any bound fails before source removal.

The writer compares the saved inventory and all copied bytes against the
quiescent source and verifies the completed backup package independently.
Source removal is forbidden until the complete package passes this verification.
That gate also applies to failure cleanup: if verification has not succeeded,
stop owned processes but preserve the original source scope and report the
failed experiment. A generic `finally` cleanup must not delete that source.
Private backup/staging temporaries can still be cleaned by their own ownership
checks. Once the verified restore has transferred ownership, its fresh scope
is eligible for normal final cleanup.
Checksums detect corruption in this owned local backup; they are not a signature
or an authenticity claim about arbitrary third-party archives.

Mode validation follows the actual file contract: newly owned scope, staging
and package roots are 0700; keys and Local authority retain their required
private modes. Other persistent files/directories must belong to the current
UID, have no special permission bits or group/other write access, and retain
their validated source modes. Do not assume every upstream config or parent
directory is 0600/0700, or chmod the source to manufacture that assumption.

## 6. Source removal and clean restore

The recovery sequence is deliberately stricter than copying over an old scope:

1. While the original scope still exists, exclusively create an empty restore
   staging directory under the same passwd-home parent, with mode 0700 and a
   fresh ownership marker. Record its device/inode, require it differs from the
   live source root, and keep its marker out of backup payload authority.
2. After complete backup verification and quiescence, recheck source ownership
   and remove only this invocation's original scope. Prove the original scope
   path and data path no longer exist. Retaining or renaming the old source as a
   fallback cannot satisfy this gate.
3. Reverify the backup before extraction. Validate every archive member and the
   entire inventory before writing payload into staging; reject malformed,
   missing, extra, corrupt, escaping or unsupported entries. An existing or
   changed destination must be refused without overwriting it.
4. Extract with exclusive creation of fresh regular files and directories. Never
   follow archive links, use hard links or invoke a permissive `extractall`.
   Preserve the validated modes and current UID. Use only the backup package.
5. Independently compare the complete restored persistent tree with the saved
   inventory before any runtime spawn, including required DB/config/key/object
   marker files. Confirm restored regular files have link count 1.
6. Validate the staging root identity/marker and install it at the original,
   still-absent scope path without clobbering an existing destination. Transfer
   harness ownership to this known staging identity. The restored scope root
   must differ from the original; individual file inode equality is not a gate,
   because filesystems can reuse freed inodes.
7. Start the original pinned binary, with the restored scope, same path and UID,
   in a new owned process group. No setup, deployment or reseeding is allowed.

The path-absence check is evidence at the source-removal boundary, not a claim
that deleted disk blocks were securely erased. A failed restore exits nonzero;
it does not fall back to a live source tree or silently recreate a working app.
Cleanup affects only roots whose current identity and marker match this run,
after process exit is known. Ownership mismatch means preserve and fail. Private
backup/staging cleanup is verified; no secret-bearing recovery artifact is
reported as safe for upload merely because the experiment failed.

## 7. Recovery assertions and evidence

Before sending an event or doing any other state-changing workload operation,
the recovered instance/account/database identities, deployment/version/script
etag/runtime settings/bindings, D1 row and R2 observation must equal their
pre-backup observations. The same original Workflow must still be `waiting`.
The original R2 content, metadata, version, uploaded timestamp and etag must be
retained. A newly written equivalent object is insufficient.

The harness sends approval to the original Workflow ID, requires the event
response to name that ID, waits for `complete`, and checks the same completion
output, counter 1 and unchanged step nonce. The restored daemon then shuts down
gracefully, all owned children exit, and owned scope/staging/backup cleanup
completes before the final success report is emitted.

| ID | Gate | Required observable result |
| --- | --- | --- |
| M2-01 | Original artifact and owned environment | Existing pin/preflight gates pass; same real non-root UID/path, fresh source scope |
| M2-02 | Real source workload | Worker/D1/duplicate input, committed waiting Workflow, binary R2 sentinel and immutable deployment/binding observations established |
| M2-03 | Cold source | SIGTERM exit 0, no force or observation error, all observed children exited, exclusive source locks acquired |
| M2-04 | Complete independent backup | Full persistent inventory/type/mode/size/hash checks pass against source and saved package before deletion |
| M2-05 | Source removed | Original owned scope/data are absent; distinct pre-created staging root; no source fallback |
| M2-06 | Restore before spawn | Backup-only extraction, exact restored inventory and private modes/UID/link count, required authority present, existing/unsafe destinations refused |
| M2-07 | Recovered original application | New daemon, original identities/deployment/bindings, unchanged D1 and R2, original Workflow still waiting; no setup/redeploy/reseed |
| M2-08 | Original execution completes | Original Workflow receives approval and reaches `complete`, callback counter remains 1 and nonce/output match |
| M2-09 | Containment and final evidence | Finite operations, graceful final shutdown, all owned cleanup, bounded secret-free report; private backup never uploaded |

M2 emits its own report, distinguished from M1 by scenario/command and M2
acceptance IDs. It records source/artifact and harness revision, environment,
phase and result, process identities, source/staging/restored root identities,
source absence, backup/restore inventory equality and aggregate counts/digests,
readback comparisons, original Workflow ID and counter/nonce hashes, cleanup
results, and explicit same-runner/same-path/same-UID limitations. Do not emit raw
inventory paths, config or key bytes, tokens, secret hashes, R2 payload bytes,
backup locations, Authorization headers or raw runtime output. Synthetic object
content hashes and aggregate inventory digests can be reported; secrets cannot.

Every gate starts as `not_run`. A failed phase exits nonzero with bounded,
sanitized diagnostics; offline success or an unavailable runtime cannot pass
the integration. [STATUS.md](STATUS.md) will link the exact SDD baseline, reviewed
implementation, tested commit/tree, actual CI run and preserved sanitized report.
The original M1 report remains unchanged.

## 8. Meaningful negative tests

Offline tests must establish that corrupt or incomplete packages, unsupported
member types, hard links/symlinks/traversal/duplicates, over-limit input, altered
ownership, held source locks, and an already occupied restore path cannot cause
source removal, destination overwrite or runtime spawn. Test the relevant
boundary observable, including preservation of pre-existing files. Interrupt or
partial-write tests must prove cleanup cannot remove a foreign partial/staging
path. At least one valid round trip must demonstrate actual source removal,
fresh regular files, complete metadata/byte verification and no external source
dependency. These tests validate the helper and harness, not upstream recovery.

The real non-root CI path must exercise the complete sequence and all M2 gates.
Both M1 and M2 run against the original binary. Review focuses on archive
completeness, delete/restore ordering, no-clobber and ownership, process cleanup,
the absence of restorative API writes, and whether the report supports its
claims. A source inspection is not a substitute for the real runtime result.

## 9. Decisions and later work

| Decision | Reason | Consequence |
| --- | --- | --- |
| Full cold directory backup for Local | Official CLI restore is unavailable; snapshots omit object bytes | Preserve config, keys, DB state and Local payloads as one recovery unit |
| Same disposable runner, path and UID | Test the complete recovery unit with the documented path/identity contract | Cross-host, OS and path portability remain unverified |
| Destroy source only after verified backup | Distinguishes recovery from normal same-data restart | A failed recovery is visible; no silent source fallback |
| Add one binary R2 sentinel | Detects payload or object-metadata omission | Other API products and full compatibility remain separate gates |
| Fresh staging identity and exclusive files | Avoids source reuse, inode-reuse false failures and clobber | Owned partial failure paths need explicit handling |
| No new infrastructure service | The uncertainty is the upstream recovery boundary | No Docker, new machine user, gateway, cloud resource or adapter required |

A successful M2 would justify specifying a recovery unit for a future typed
runtime adapter. It would not establish production retention, encrypted offsite
backups, recovery time objectives, crash consistency, egress isolation, capacity,
upgrades or exactly-once external effects. Those remain separate decisions and
evidence gates.

## 10. Fixed primary sources

Inspected at v0.2.4 source commit `73efa56a1b1ad51a4519b2253ffaa499cb29fb2d`.
These are implementation/design inputs, not test results.

- [Local operator backup guide][backup]
- [Backup/retention runbook][retention] and [fresh-host runbook][fresh-host]
- [Local CLI restore refusal][restore] and [snapshot object exclusion][snapshot]
- [Instance registry and scope][registry], [instance setup][setup], [data directories][data]
- [Local filesystem validation][local-fs]
- [R2 API][r2-api] and [portable R2 fixture][r2-fixture]

[backup]: https://github.com/elliothux/open-compute/blob/73efa56a1b1ad51a4519b2253ffaa499cb29fb2d/apps/website/src/content/docs/docs/ocd/backup.md
[retention]: https://github.com/elliothux/open-compute/blob/73efa56a1b1ad51a4519b2253ffaa499cb29fb2d/docs/references/runbooks/backup-and-retention.md
[fresh-host]: https://github.com/elliothux/open-compute/blob/73efa56a1b1ad51a4519b2253ffaa499cb29fb2d/docs/references/runbooks/fresh-host-restore.md
[restore]: https://github.com/elliothux/open-compute/blob/73efa56a1b1ad51a4519b2253ffaa499cb29fb2d/crates/service/src/backup_cli/restore.rs
[snapshot]: https://github.com/elliothux/open-compute/blob/73efa56a1b1ad51a4519b2253ffaa499cb29fb2d/crates/storage/src/platform_snapshot.rs
[registry]: https://github.com/elliothux/open-compute/blob/73efa56a1b1ad51a4519b2253ffaa499cb29fb2d/crates/service/src/instance_registry.rs
[setup]: https://github.com/elliothux/open-compute/blob/73efa56a1b1ad51a4519b2253ffaa499cb29fb2d/crates/service/src/setup/instance.rs
[data]: https://github.com/elliothux/open-compute/blob/73efa56a1b1ad51a4519b2253ffaa499cb29fb2d/crates/storage/src/data_dir.rs
[layout]: https://github.com/elliothux/open-compute/blob/73efa56a1b1ad51a4519b2253ffaa499cb29fb2d/crates/storage/src/data_dir.rs#L761
[locks]: https://github.com/elliothux/open-compute/blob/73efa56a1b1ad51a4519b2253ffaa499cb29fb2d/crates/storage/src/lock.rs#L112
[local-fs]: https://github.com/elliothux/open-compute/blob/73efa56a1b1ad51a4519b2253ffaa499cb29fb2d/crates/artifacts/src/local/fs_ops.rs
[r2-api]: https://github.com/elliothux/open-compute/blob/73efa56a1b1ad51a4519b2253ffaa499cb29fb2d/crates/service/src/cloudflare_v4/r2.rs
[r2-fixture]: https://github.com/elliothux/open-compute/blob/73efa56a1b1ad51a4519b2253ffaa499cb29fb2d/test/conformance/fixtures/r2/portable-bucket/src/index.ts
