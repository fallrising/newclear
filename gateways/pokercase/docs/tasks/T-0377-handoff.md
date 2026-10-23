# T-0377 Cursor isolation verification — 2026-10-23

The retained Cursor provider now runs only in a configured Docker container. PR #566 follows specification PR #563. Local checks, independent review and required CI passed; PR #566 merged as `cbf1021f4d67ff60683dbfdb47e7bd75101e07bd` at2026-10-23T18:01:20Z. Fetch/readback found no component differences from reviewed head8eac133f. The overall product remains incomplete in SUCCESS.md.

## Historical failures and corrections

The first delivery was retained as a draft: full Rust tests passed, but clippy reported `large_enum_variant` and the actual gateway Docker canary returned HTTP502. The startup cleanup ordering finding was fixed by killing/reaping the Docker client before bounded removal retries; delayed daemon creation beyond the retry window remains a limitation.

The follow-up diagnosed HTTP502 using a credential-free fake CLI: Docker's working-directory setup left the workspace tmpfs unwritable by UID1000. An explicit `mode=1777` fixes the ephemeral per-request workspace. The `Serve` command now holds boxed `ServeArgs`, preserving CLI flags while avoiding an oversized enum without suppressing lint. A transient canary expected-value typo (`NameError`) was corrected before the final pass; earlier failures are not relabeled as passes.

## Observed verification

Commands run from the repository root with the existing shared Cargo target directory:

| Check | Outcome |
| --- | --- |
| `cargo +1.99.0 build --locked --manifest-path gateways/pokercase/Cargo.toml` | PASS |
| `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml` | PASS, all unit/integration suites |
| `cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings` | PASS |
| `cargo +1.99.0 fmt --manifest-path gateways/pokercase/Cargo.toml --check` | PASS |
| `python3 scripts/check_project_success.py` | PASS,42 contracts |
| `python3 scripts/check_indexes.py` | PASS |
| `git diff --check` | PASS |
| `python3 gateways/pokercase/scripts/verify_cursor_container.py --binary <built-thinrouter> --base-image python:3.14-alpine` | PASS through the actual Docker runner and gateway; no provider/account credentials |

CI-1: missing opt-in/image/profile returns503 before starting a process. CI-2/CI-3: parameter validation and fake-runtime tests verify fixed image/profile arguments and the absence of host mounts/privileges. CI-4: protocol/usage, error redaction and cleanup are covered by fake-runtime regression and actual Docker success/error/after-first-record cancellation. The late-create test covers the cleanup helper, not a complete startup cancellation race. CI-5: actual Docker canary denied host read/write, host environment and Docker socket access; rootfs was read-only, root write failed, UID was1000, workspace writable, and request containers disappeared.

## Limits and continuation

These results establish the scoped filesystem/process runner boundary, not real Cursor login, real model behavior or network/account-plugin isolation. The unchanged image recipe subsequently built and passed network-disabled version/help startup for official bundle2026.10.22-27dcf5f; the live account journey remains unverified. Bridge networking permits host/LAN/external access; plugins and profile credentials remain available inside the container. Gateway hard kill, daemon failure or creation delayed beyond reconciliation may leave containers.

Delivery gates for PR #566 passed (component CI1m27s, contracts7s). The task board and desk/journal record this bounded delivery. Next is the remaining real-account/core-journey acceptance in SUCCESS.md, starting with dedicated Cursor profile provisioning and a scoped live roundtrip; credential use requires its own explicit authorization. Do not claim a usable release. No real credential reads, model calls, deploys or usable tags occurred.

## Execution boundaries

First round16:57:52Z–17:17:52Z; follow-up starts17:53:34Z, deadline18:13:34Z, final3minutes reserved for closeout. Tokens, provider requests and cost are unknown; no paid provider probe was initiated. Detailed local logs and reviews are retained privately; this document contains only reviewed summaries.

## Subsequent authorized live attempt

Owner separately authorized dedicated-profile login and one text request. Login succeeded; the single gateway request returned502 and cleanup passed. No retry was made. See [the live result and diagnostic continuation](../cursor-live-smoke.md); the one-request allowance is consumed, and the root cause remains unconfirmed.
