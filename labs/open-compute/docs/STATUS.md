# Status and evidence

Updated: 2026-10-07.

## Design baseline

The [SDD](SDD.md) was committed before implementation as
[`474b7b1`](https://github.com/fallrising/newclear/commit/474b7b1db50cb9b1c9da155453566c15e84f41cc).
Independent review checked the public CLI/scope contract, acceptance boundaries
and public documentation scope. The implementation and real-runtime verification
are in progress; no runtime success is claimed by this baseline.

## Execution environment

The authoring container is Linux x64 but runs as UID 0, without setuid or user
namespace capability. It cannot run the original release's non-root server path.
Offline harness checks can run there; the real integration gate uses a fresh
non-root GitHub-hosted Linux runner and the original pinned artifact.

## Verification ledger

| Gate | Result |
| --- | --- |
| Source and release metadata inspection | `v0.2.4` / `73efa56a1b1ad51a4519b2253ffaa499cb29fb2d`; expected binary size and SHA256 checked against the GitHub release API |
| SDD independent review | Passed; no blocking findings |
| `make check` | 17 tests: 15 passed, 2 native process tests explicitly skipped because this container exposes a different `/proc` PID namespace; both must execute on the real CI runner |
| Root integration preflight | Correctly refused UID 0 before artifact download or runtime creation; this is a negative guard test, not runtime success |
| Real Worker, D1, duplicate submission and Workflow restart | Pending non-root CI execution |

## Unverified beyond M1

No hosted Cloudflare comparison, general API parity, arbitrary-code isolation,
resource-limit stress, performance claim, multi-node/HA behavior, unclean crash,
full cold backup/restore, upgrade/rollback, production deployment, or host adapter
is established by this milestone. In particular, a committed Workflow step
surviving normal restart does not imply exactly-once external side effects.
