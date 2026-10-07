# Status and evidence

Updated: 2026-10-07.

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

## Unverified beyond M1

No hosted Cloudflare comparison, general API parity, arbitrary-code isolation,
resource-limit stress, performance claim, multi-node/HA behavior, unclean crash,
full cold backup/restore, upgrade/rollback, production deployment, or host adapter
is established by this milestone. A committed Workflow step surviving normal
restart does not imply exactly-once external side effects.

The next useful evidence gate is a full cold backup and restore in a fresh
environment, including configuration, required keys and object payloads. That
would establish a stronger portability boundary before designing a host adapter;
it is a proposed follow-up, not part of the completed M1.
