# Status and evidence

Updated: 2026-10-08.

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

The authoring environment remains UID 0 with a mismatched readable PID
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

The authoring container is UID 0 and exposes a different PID namespace through
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
