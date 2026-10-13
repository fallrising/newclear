# Status and evidence

Updated: 2026-10-13.

## M4 result

**Passed on the original open-compute v0.2.4 release.** A fresh non-root Linux
runner took three complete cold scope metadata snapshots under the existing
runtime locks. Between snapshots it restarted with the same authority,
confirmed sixteen fixed job IDs absent, submitted each twice with an identical
128-byte ASCII payload, read all sixteen original rows after the second restart,
and completed the original Workflow. Counter stayed 1 and nonce/Workflow ID
were unchanged. All three daemon sessions exited normally with SIGTERM;
observed owned generations exited and final owned scope removal succeeded.

The [M4 contract](SDD-M4.md) defines this fixed experiment. Its original
[sanitized report](evidence/2026-10-13-m4-ci.json) is preserved byte-for-byte;
SHA256 `b0e68342bf8b0ed17103c26dbef8be85a594aabeb1b240a243cfe80b35b13966`.
Historical M1/M2/M3 reports below remain unchanged. All three previous real
scenarios passed in the same workflow, alongside 153 offline tests with no skips.

### M4 design and execution provenance

| Item | Exact reference |
| --- | --- |
| Reviewed SDD committed before implementation | [`525d053`](https://github.com/fallrising/newclear/commit/525d05301befcb87510ba71c91ff124379fe042d) |
| Independently reviewed implementation | [`c76a422`](https://github.com/fallrising/newclear/commit/c76a422902a40a1bfd324daa5d4c4e713a980a25) |
| Actual CI checkout | [`58ed591`](https://github.com/fallrising/newclear/commit/58ed5911b8a24ef57ccaceb44e9d0dec90f4307f) |
| Tested Git tree | `be603af09a7c3810e0f758ef274dc7a8fcd6a51d` |
| Real-runtime CI | [Run 38397480850](https://github.com/fallrising/newclear/actions/runs/38397480850), [M4 job 115296297028](https://github.com/fallrising/newclear/actions/runs/38397480850/job/115296297028) |
| Harness run ID | `20261013T122806Z-3eb90b73` |
| Runner | Ubuntu 24.04, Linux x86_64, EUID 1001, Python 3.11.17 |
| Upstream identity | Original v0.2.4 / source `73efa56a1b1ad51a4519b2253ffaa499cb29fb2d`; unchanged 195537392-byte asset and SHA256 in [the lock](../upstream.lock.json) |

The checkout is GitHub's synthetic merge of main `7e854f26` and the reviewed
implementation `c76a4229`. Its parents and complete tree were read back and
fetched; the tested tree is identical to the reviewed head. Later documentation
commits do not become the original source of these measurements.

### M4 verification ledger

| Gate | Observed result |
| --- | --- |
| Independent review | Revised SDD accepted before code; scanner interruption findings reproduced/fixed/re-reviewed; fresh integrated source/CI/operator review accepted exact final hashes |
| Offline contracts | **153 tests passed, no skips** locally and on the Python 3.11 CI runner; real alarm/threaded signal, FD/lock, metadata/limit, sparse/hardlink and strict evidence failures covered |
| Existing real-runtime gates | M1 AC-01 through AC-08, M2-01 throughM2-09 and M3-01 throughM3-05 all passed in the same workflow |
| M4-01: original runtime and trusted controls | Exact original artifact, fresh non-root scope, actual Worker/D1 deployment, original duplicate row and committed waiting Workflow established |
| M4-02: complete bounded cold snapshots | Three complete locked snapshots, numeric units/groups/inode accounting and owned metadata checks passed; no partial scan became zero-valued success |
| M4-03: fixed batch and retained state | 16 absence checks,32 completed submissions,16 original retained reads after the second same-data restart; all exact counts and signed deltas validated |
| M4-04: completion and cleanup | Original Workflow completed with counter 1 and unchanged nonce; three distinct daemon generations, all SIGTERM exit 0 without force or observation error; owned scope removed |
| M4-05: sanitized evidence | Strict full extension/group sums/deltas and bounded whole report passed; original artifact bytes/hash, source/tree/workload/environment and measurement limits retained |

### Observed cold regular-file footprint

| Cold checkpoint | Logical bytes | Reported allocated bytes | Regular paths / unique inodes | Observed hardlink aliases |
| --- | ---: | ---: | ---: | ---: |
| Original Workflow waiting | 227765344 | 228343808 | 245 /243 | 2 |
| Fixed writes after first restart | 229213018 | 229797888 | 247 /245 | 2 |
| Original completion after second restart | 230447700 | 231038976 | 249 /247 | 2 |

The batch-stage endpoint difference was +1447674 logical bytes and+1454080
reported allocated bytes. The restart/read/completion endpoint difference
was +1234682 logical bytes and+1241088 reported allocated bytes. These differences
include platform/background/restart effects; **they are not exclusively D1
payload costs, a per-job ratio, a growth rate or capacity evidence**. The
synthetic unique payload total was 2048 bytes; no scaling threshold was imposed.

Each snapshot reported two hardlink aliases in the derived OCR group. In this
run, that group's reported allocation stayed 8953856 bytes and scope-transient
allocation stayed 204910592 bytes across all checkpoints. Those fixed group
enums are path partitions, not inferred internal products. The observer did
not inspect payloads or attribute transient files to a particular component.
The three snapshots took about 0.0111–0.0115 seconds, each under its ten-second
application budget; 552/563/574 entries were observed, including 307/316/325
directories and zero sockets. Directory/socket blocks are excluded from byte
figures. The 512-byte allocation unit means st_blocks, not a filesystem page size.

Unlike M2 backup payload counts, M4 includes OCR and transient regular files;
only the harness marker is excluded. It deduplicates observed `(device, inode)`
aliases. Scans are sequential and require cooperating cold runtime locks;
physical extents, reflinks/compression, same-device bind mounts, between-checkpoint
peaks, free capacity, whole-host storage, retention/reclamation and long-term
growth remain unknown. No host adapter or production adoption follows.

### Reproduce M4 and authoring limitations

Follow the [quickstart](quickstart.md) on a fresh disposable non-root Linux x64
account, then run:

```sh
make -C labs/open-compute check
make -C labs/open-compute preflight
make -C labs/open-compute integration-storage
```

The authoring account used Python 3.13.5 and the shared disk-backed launcher.
Root's final actual socket-enabled rerun passed 153 tests/no skips. Earlier
sandbox socket denials and a test socket's inherited unsafe mode were retained;
its fixture alone received explicit 0600 mode, without relaxing the scanner.
Descriptor leaks under actual alarms/threaded signals were reproduced and fixed
before acceptance. No runtime was started in the persistent authoring home;
original runtime and Python 3.11 evidence come from the fresh CI runner.
Application deadlines/narrow signal deferral do not promise interruption of
uninterruptible kernel filesystem I/O.

## M3 result

**Passed on the original open-compute v0.2.4 release.** A fresh non-root
Linux runner observed the lifecycle-authorized runtime process generations in
four fixed windows around a normal daemon restart. Both four-second read
windows completed exactly eight validated GET requests. The original D1 row,
waiting Workflow and persistent state survived; the same Workflow completed
with callback counter 1 and an unchanged nonce. Both daemon shutdowns exited
normally without forced termination, and the owned scope was removed.

The [M3 contract](SDD-M3.md) defines these bounded observations. The original
[sanitized report](evidence/2026-10-13-m3-ci.json) is preserved byte-for-byte;
its SHA256 is
`4dce0d7b24b31f99d6f1038dbed719393ef3b9fa745d14342a6dc62aff3eb3e0`.
Historical M1/M2 evidence below remains unchanged. All three real experiments
passed again in the same job, using Python 3.11 and the unchanged upstream pin.

### M3 design and execution provenance

| Item | Exact reference |
| --- | --- |
| Reviewed SDD committed before implementation | [`0cea629`](https://github.com/fallrising/newclear/commit/0cea629aaebd36f6ec3dfda75fc3b3f6fee57e4e) |
| Lifecycle generation fix and nested deadline clarification | [`fb80148`](https://github.com/fallrising/newclear/commit/fb8014855f61c2cd7740b3df057dce3f98f0aeb5) |
| Sampler dependency baseline | [`cd52145`](https://github.com/fallrising/newclear/commit/cd521452749638702d298eee69bcf650cba0a40a) |
| Independently reviewed implementation including sampler rework | [`dc9e5ec`](https://github.com/fallrising/newclear/commit/dc9e5ecdabb690a2c1f9b9922d189cad7c0a61ce) |
| CI checkout recorded by the harness | [`0855e2b`](https://github.com/fallrising/newclear/commit/0855e2b63329f0a78911e0f5bf2d3e9f03d956f8) |
| Tested Git tree | `ac10829a1dc54d7e91c4b2397334847704dcd00e` |
| Real-runtime CI | [Run 38377772191](https://github.com/fallrising/newclear/actions/runs/38377772191), [job 115230354252](https://github.com/fallrising/newclear/actions/runs/38377772191/job/115230354252) |
| Harness run ID | `20261013T094036Z-e5d357ea` |
| Runner | Ubuntu 24.04, Linux x86_64, EUID 1001, Python 3.11.17 |
| Upstream identity | `v0.2.4` / source `73efa56a1b1ad51a4519b2253ffaa499cb29fb2d`; unchanged 195537392-byte asset and SHA256 in [the lock](../upstream.lock.json) |

The recorded checkout is GitHub's synthetic merge of main `c0e2bf9` and the
reviewed revision `dc9e5ec`. Its parents and complete tree were read back from
GitHub and fetched locally; the tree is identical to `dc9e5ec`. Later evidence
and documentation commits do not rewrite the report's tested source identity.

### M3 verification ledger

| Gate | Observed result |
| --- | --- |
| Independent review | Reviewed SDD, fresh lifecycle and sampler reviews, then a fresh final integration/CI review; all concrete blockers resolved before acceptance |
| Offline contracts | **115 tests passed, no skips** in the root rerun and on the Python 3.11 CI runner |
| Existing real-runtime gates | M1 AC-01 through AC-08 and M2-01 through M2-09 all passed in the same CI job |
| M3-01: original runtime and trusted application | Exact original artifact verified on the fresh non-root runner; real Worker deployment, D1/Workflow and two submissions yielding one persisted row passed |
| M3-02: owned identities, units and bounded acquisition | Lifecycle retains PID/start-time generations and revalidates parent edges; recorded page/tick units and bounded helper protocol passed, with meaningful negative tests in the 115-test suite |
| M3-03: all four observation windows | Both idle windows had twelve valid scans; both read windows had sixteen valid scans and eight validated serial GETs; all attempted acquisitions succeeded |
| M3-04: normal restart, completion and cleanup | Daemon identities changed from `3138/30276` to `3271/33157`; state and Workflow ID survived, counter remained 1 and nonce unchanged; both shutdowns exited gracefully with all observed owned processes gone and scope removed |
| M3-05: bounded sanitized evidence and provenance | Strictly projected separate report written with exact source/artifact identity, workload, units, metrics, coverage and fixed limits; original report hash and historical evidence preserved |

### Observed resources for this run

| Window | Valid scans | Validated GETs | Peak sampled aggregate RSS (bytes) | Paired own CPU (seconds) |
| --- | ---: | ---: | ---: | ---: |
| Source idle, 3 seconds | 12 | 0 | 278769664 | 0.04 |
| Source read probe, 4 seconds | 16 | 8 | 281382912 | 0.12 |
| Restarted idle, 3 seconds | 12 | 0 | 145620992 | 0.05 |
| Restarted read probe, 4 seconds | 16 | 8 | 149368832 | 0.15 |

The runner reported 4096-byte pages and 100 clock ticks per second. All 56
attempted scans were valid, with zero skipped scheduling slots. The largest
observed acquisition gap was about 0.25005 seconds and the longest scan about
0.03938 seconds. Each phase observed at most two live authorized processes.
The report also records 12 or 16 missing observations per phase: lifecycle
history retains an already-exited process generation, whose absence does not
become an invented zero CPU contribution. CPU unpaired observations remain
explicit (14 in each idle window and 18 in each read window).

RSS can count shared pages repeatedly. Scans are sequential and can miss peaks
or short-lived descendants; CPU includes only paired observations of the same
generation within a phase and excludes unobserved intervals. Full-tree and
between-sample coverage remain unknown. The harness and observer helpers,
startup, shutdown, resume and cold backup are excluded. These single-run
observations do not establish capacity, memory savings after restart, latency,
saturation, full-lifetime CPU or tenant isolation.

### Reproduce M3 and authoring limitations

Follow the [quickstart](quickstart.md) on a fresh disposable non-root Linux x64
account, then run:

```sh
make -C labs/open-compute check
make -C labs/open-compute preflight
make -C labs/open-compute integration-resources
```

The M3 authoring account was non-root Linux x64 with Python 3.13.5. Its runtime
preflight passed without starting a daemon, but its persistent home was not used
for the experiment. Local `make` was unavailable, so the exact Python unittest
equivalent ran through the shared task launcher. Initial socket tests were
denied by the authoring sandbox; the authorized loopback rerun passed all 115
tests with no skips. Actual Python 3.11 execution and original-runtime results
come from the fresh CI runner. No upstream guard was bypassed.

## M2 result

**Passed on the original open-compute v0.2.4 release.** The real non-root CI
runner stopped the source daemon, verified a complete persistent-state backup,
actually removed the original scope, restored into a fresh directory tree, and
started a new daemon using only that backup. The original deployment/version,
bindings, D1 row and R2 object identity survived. The same waiting Workflow then
completed with callback counter 1 and an unchanged nonce.

The [M2 contract](SDD-M2.md) and [sanitized report](evidence/2026-10-08-m2-ci.json)
define and preserve this result. The report SHA256 is
`2783d20c636ebfbcae39dcd08fbf4771230bf4e52a446c2e55bff9e62fd12722`.
Backup payloads, inventories, configuration and keys were private temporary
data, removed during verified cleanup, and were not uploaded.

### M2 design and execution provenance

| Item | Exact reference |
| --- | --- |
| SDD committed before implementation | [`7cfa106`](https://github.com/fallrising/newclear/commit/7cfa106d89f59333f18d0fbda9876af3001360d6) |
| Source-preservation clarification | [`d2a1209`](https://github.com/fallrising/newclear/commit/d2a12099f70a2733db5ad2110ddd5434531bc947) |
| Initial implementation | [`bc61141`](https://github.com/fallrising/newclear/commit/bc6114140de7d76abe55654f7e679621f7ae6090) |
| OCR exclusion contract, committed before its code change | [`eb43f08`](https://github.com/fallrising/newclear/commit/eb43f0894173df0515c0a85a6fd832de451d69b7) |
| Reviewed implementation including the focused fix | [`e8c60d7`](https://github.com/fallrising/newclear/commit/e8c60d71154e99ce766d6a1ffe81cc0dbf311700) |
| CI checkout recorded by the harness | [`cee5753`](https://github.com/fallrising/newclear/commit/cee57533b12d7c63491f548d0ad0049b851af004) |
| Tested Git tree | `ef1e34f91654d027fe431698613f66f069889719` |
| Real-runtime CI | [Run 37727686546](https://github.com/fallrising/newclear/actions/runs/37727686546), [job 113149484970](https://github.com/fallrising/newclear/actions/runs/37727686546/job/113149484970) |
| Harness run ID | `20261008T042948Z-19a4afd7` |
| Runner | Ubuntu 24.04, Linux x86_64, EUID 1001, Python 3.12.3 |
| Upstream identity | `v0.2.4` / source `73efa56a1b1ad51a4519b2253ffaa499cb29fb2d`; unchanged exact artifact pin in [the lock](../upstream.lock.json) |

The CI checkout is GitHub's synthetic merge of main `216643e` and the reviewed
PR revision `e8c60d7`. Its two parent SHAs and complete tree were read back from
GitHub; the tree is identical to `e8c60d7`. The checked-in report preserves this
tested revision. Later documentation/evidence commits do not rewrite that
provenance or become the original source of the observations.

### M2 verification ledger

| Gate | Observed result |
| --- | --- |
| Independent review | Recovery/lifecycle and fixture/API/evidence reviews passed after resolving concrete findings; the precise OCR exclusion and two regression tests also received a focused independent review |
| Offline contracts on the real CI runner | **59 tests passed, no skips**; the existing M1 integration also passed AC-01 through AC-08 in the same job |
| M2-01: original artifact and environment | Exact 195537392-byte asset and pinned SHA256 verified; runtime reported `ocd 0.2.4`; real EUID 1001 and fresh owned source |
| M2-02: source application | Real Worker deployment, D1 write/read, duplicate submissions yielding one row, committed waiting Workflow, 64-byte binary R2 sentinel and immutable deployment/binding observations |
| M2-03: cold source | SIGTERM exit 0, no force or observation error, all observed owned children exited, all three exclusive source locks acquired |
| M2-04: complete backup | Source and saved package independently verified; **410 inventory entries, 134 regular files, 13,215,704 payload bytes**, including persistent configuration, keys, DB state and Local object authority |
| M2-05: actual source removal | Both original scope and data paths observed absent; source root `66305/2431129` replaced by pre-created staging root `66305/2431288` (device/inode) |
| M2-06: restore before spawn | Complete restored inventory verified against backup before starting the runtime; staging identity became restored scope identity; fresh regular files, modes and current UID checked |
| M2-07: original application recovered | Six GET-only readbacks confirmed original identities, deployment/version/runtime/bindings, D1 row and original waiting Workflow; R2 bytes, metadata, etag, version and uploaded timestamp unchanged |
| M2-08: original execution completes | Workflow `flow-20261008t042948z-19a4afd7` reached `complete`; same ID, callback counter 1, unchanged nonce and matching output |
| M2-09: final containment | Restored daemon SIGTERM exit 0, no force or observation error, all observed owned children exited; restored scope, staging and private backup removed; sanitized report written |

Daemon identities changed from PID/start-ticks `2453/6665` to `2528/8700`.
The recovered instance/account remained `01a119c655477605b3335c3697625f4b`.
Recovery did not run setup, redeploy, recreate resources or reseed data. The
original Workflow's persisted deadline continued to apply throughout recovery.

### Failure that refined the contract

The [first implementation run](https://github.com/fallrising/newclear/actions/runs/37725768008)
passed its 57 offline tests and M1, but M2 stopped at `cold_locked` with
`hard-linked file is refused`. It had not verified a backup or deleted the
source; the sanitized report recorded `source_preserved: true`. This was a
failed M2 run, and its result is not substituted for the successful run above.

Inspection of the fixed upstream source showed that every startup materializes
embedded OCR models with hard-linked language aliases under the exact
`instances/lab/data/tessdata` subtree. Those bytes can be regenerated by the
same binary. The [revised SDD](SDD-M2.md#5-quiescence-and-complete-backup) records
the source chain and narrowly excludes this binary-derived subtree. The failed
CI did not publish individual paths, so the attribution is source-derived.
Persistent hard links remain refused. Two new regressions exercise an actual
source-removal round trip and confirm that same-named business paths elsewhere
remain persistent, including refusal when those paths contain hard links.

### Reproduce M2 and interpret its limits

Follow the [quickstart](quickstart.md) on a fresh disposable non-root Linux x64
account with no existing runtime scope:

```sh
make -C labs/open-compute check
make -C labs/open-compute preflight
make -C labs/open-compute integration-restore
```

The experiment uses the **same runner, absolute scope path and UID**, with a
new directory tree and daemon. It establishes the recovery unit for this pinned
synthetic fixture after graceful shutdown and actual source removal. A different
physical host, OS/UID/path relocation, power loss, encrypted offsite retention,
version migration, HA, capacity, general API parity and a host adapter remain
unverified. The small backup size and successful Workflow completion are not
performance measurements or exactly-once guarantees for external effects.

The historical M2 authoring environment was UID 0 with a mismatched readable PID
namespace. It ran helper/contract tests only; it did not run the upstream daemon
or bypass its non-root guard. The runtime result above comes from the real CI
runner. The original M1 evidence below remains unchanged.

## M1 result

**Passed on the original open-compute v0.2.4 release.** A fresh non-root Linux
runner deployed the trusted Worker, wrote and read D1, reached a durable
Workflow event wait, stopped the actual daemon with SIGTERM, and completed the
same Workflow after restarting with the same data. The committed callback
counter stayed at 1 and its nonce did not change.

This is evidence for the bounded M1 contract in [SDD.md](SDD.md). The
[checked-in sanitized report](evidence/2026-10-07-m1-ci.json) preserves the
result independently of the CI artifact's seven-day retention.

## Design and execution provenance

| Item | Exact reference |
| --- | --- |
| SDD committed before implementation | [`474b7b1`](https://github.com/fallrising/newclear/commit/474b7b1db50cb9b1c9da155453566c15e84f41cc) |
| Reviewed implementation revision | [`bfaf410`](https://github.com/fallrising/newclear/commit/bfaf410ed1741bb763a42b2cd1106578b7deda0f) |
| CI checkout recorded by the harness | [`92816c4`](https://github.com/fallrising/newclear/commit/92816c4457e0691cdc29434b0c1716865f2af279) |
| Tested Git tree | `48fb4131787a9015cf3d6873a91692884f4bf9b4` |
| Real-runtime CI | [Run 37649927495](https://github.com/fallrising/newclear/actions/runs/37649927495), [job 112890282037](https://github.com/fallrising/newclear/actions/runs/37649927495/job/112890282037) |
| Harness run ID | `20261007T161024Z-b71e0e43` |
| Runner | Ubuntu 24.04, Linux x86_64, EUID 1001, Python 3.12.3 |
| Upstream identity | `v0.2.4` / source `73efa56a1b1ad51a4519b2253ffaa499cb29fb2d`; exact size and SHA256 in [the lock](../upstream.lock.json) and report |

Pull-request CI checks out a GitHub-generated merge commit. The recorded
`92816c4` has parents `92cc9a8` (main at execution) and `bfaf410` (the PR
revision). Its tree was checked against `bfaf410` and is identical. Later
evidence-only commits do not retroactively change the report's tested identity.

## Verification ledger

| Gate | Observed result |
| --- | --- |
| Independent review | SDD, fixture/API semantics, CI scope and lifecycle reviewed; all blocking findings resolved before this run |
| Offline contracts on the real CI runner | `make -C labs/open-compute check`: **29 tests passed, no skips** |
| AC-01: original artifact | 195537392 bytes; pinned SHA256 verified before execution; runtime reported `ocd 0.2.4` |
| AC-02: owned environment | Fresh scope, EUID 1001, loopback listener; refusal/no-clobber cases covered by contract tests |
| AC-03: real deployment | Worker deployed through v4, actual Worker response and D1 binding write/read succeeded |
| AC-04: duplicate submission | Two requests for the same synthetic ID yielded one persisted row |
| AC-05: durable wait | Original Workflow reached `waiting`; callback counter was 1 and nonce was captured |
| AC-06: actual daemon restart | Daemon PID/start-ticks changed from `2500/10715` to `2567/12774`; scope, instance, config and data identities stayed consistent |
| AC-07: resume | Workflow `flow-20261007t161024z-b71e0e43` reached `complete`; same ID, counter 1, unchanged nonce and matching completion output |
| AC-08: bounded cleanup and evidence | Both daemon shutdowns used SIGTERM, exited 0 without forced termination or observation error, and all observed owned children exited; scope removed and sanitized report written |

The first implementation also passed a real run with its original 17 tests:
[run 37647386810](https://github.com/fallrising/newclear/actions/runs/37647386810).
Independent review then found concrete failure-path gaps. The final revision
adds regression coverage for existing partial-file preservation, unknown
process/reader observations, total HTTP/download deadlines, and artifact/output
paths that overlap the runtime scope. The 29-test run above validates those
fixes together with the original runtime path.

## Reproduction and authoring environment

Follow [the quickstart](quickstart.md). From the repository root:

```sh
make -C labs/open-compute check
make -C labs/open-compute preflight
make -C labs/open-compute integration
```

Integration requires a real non-root Linux x64 account with a fresh disposable
passwd home and no existing `.open-compute` scope. The download requires access
to GitHub release assets. All workload inputs are synthetic.

The historical M1 authoring container was UID 0 and exposed a different PID namespace through
`/proc`. Its offline result was 29 tests: 27 passed and 2 native process tests
explicitly skipped. The original runtime correctly refuses that environment;
no upstream guard was changed. Both native tests executed and passed on the
real CI runner. The reported runtime success is from that runner, not a local
mock or a deployment on an operator's physical server.

## What M1 did not establish

No hosted Cloudflare comparison, general API parity, arbitrary-code isolation,
resource-limit stress, performance claim, multi-node/HA behavior, unclean crash,
full cold backup/restore, upgrade/rollback, production deployment, or host adapter
is established by this milestone. A committed Workflow step surviving normal
restart does not imply exactly-once external side effects.

M2 takes up the complete cold-backup question through its separately committed
SDD and evidence gate above. It does not retroactively change the scope of this
completed M1 run or establish a host adapter.
