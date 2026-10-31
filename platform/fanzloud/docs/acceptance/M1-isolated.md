# M1: one real isolated browser coding task

2026-10-31; T-0442 with approved T-0447 dependency; [PR885](https://github.com/fallrising/newclear/pull/885).
Live success accepted independently; FN-06 completion and final CI/merge tracked below.

## Observed result

On source `33e1eb70d66eb74644e8ad81e64e8bdc69c9fe07`, actual Chromium submitted one
coding task through HTTPS → Rust control-plane → Agent Platform HTTP API/PostgreSQL
worker → authenticated Connector → Cocoon VM. The pinned official Claude Code CLI
used the existing personal subscription and only run-bound MCP read/write/exec tools.
Node performed TLS termination only; there was no Node API fixture in this journey.

Run `98ce2ce1-6b9f-46b7-9dd4-83e659ebe4b7` moved through queued, provisioning, running,
finalizing and succeeded, visible in the page from19:23:26Z to19:23:40Z. One POST created
one coding run. The CLI invocation took6720ms, exited0 and its owned process group stopped.
Its actual init exposed exactly the three approved MCP tools; actual calls were read,
read, write, exec. Model was `claude-opus-5-5`; permission denials were empty.

The only change was `totals.py`: `range(start, end)` became `range(start, end + 1)`.
All three fixed unit tests passed inside the actual guest. The page, downloaded patch,
AP result and verification each identify the same285-byte diff:
`c5134c8015bad2104fceb70e5c4c79086d6ec9bd85a0b4fa0f833b4ed3ef6fdb`.
The downloaded patch was independently applied to base
`55bd36a47d3ca619b0a10bcad427b9fb9b8c99c5`; the same three tests passed.

AP confirmed cleanup. Independent host observation then found0 claims,0 VM scopes,
0 VM directories and0 owned hypervisor processes. The previous VM's marker was absent
from this new workspace and the fixed source still contained the original bug before
CLI execution. This proves sequential isolation, not two simultaneously running tasks.

## Exact route and evidence binding

- Claude Code `2.1.312`; executable SHA256
  `4f4178ce41d83e23341ebfbaecdbcf8ea6bf7baea0690025abe49eeec3a5d01d`.
  First-party `claude.ai` subscription; API-key/cloud-provider overrides refused.
- Cocoon0.6.7, sandboxd0.1.12, Cloud Hypervisor54 fixed binary; immutable guest
  `sha256:6f6324eea806d16a5fd9befb703b966aa584a1796abd0e0dd5ee74036ad4323c`.
  One4CPU/4GiB VM, max600seconds, no network destination allowed.
- Frozen474 source-file manifest, exact Rust binary hash and11 remote Connector/guest
  helper hashes were checked. Mainline integration only changed unrelated projects and
  appended both plans; it did not change the live execution bytes.
- Private receipts: `source-manifest.json`, `live-summary.json`, `cross-workspace.json`,
  `remote-cleanup.json`, `browser/browser-evidence.json`, `browser/browser-final.png`,
  `browser/browser-final.diff`, `patch-apply.log`, and the hashed private CLI stream.
  Durable backup: owner workspace evidence archive `fanz-executor-20261031-t0447`.
  No credentials, full environment or raw model stream are committed here.
- Real coding invocations:1. Actual provider requests, total tokens and billed cost
  are unknown; invocation count is not a billing/request ceiling. No API billing route.

## Gates and failure evidence

| Gate | Evidence and scope |
| --- | --- |
| EX-01 | Native external-workspace admission/fence/journal/bounds tests; real PostgreSQL subscription lifecycle; lost MCP reply/restart never retries; actual fake-process deadline guard |
| EX-02 | Real guest UID2000/NNP, canary/control/host denial, direct public/private/metadata and HTTP/CONNECT egress denial, fixed-base failed baseline checks/diff, cleanup; second workspace marker absence |
| EX-03 | Actual pinned subscription CLI four workspace tools, minimal repair, real checks/diff and process/VM removal |
| M1-WEB01–05 / FN-01 | Real Chromium/Rust/AP live journey and exact downloaded patch; no browser errors or teardown errors |
| FN-03 | Single/sequential portion only; concurrent two-workspace portion belongs to M2 |
| FN-06 | Independent review found missing reason display; bounded deterministic completion below, separately labelled from live coding |

Native commands: `cargo +1.97.1 test --locked --workspace --all-targets --all-features`,
scoped gateway tests/Clippy/format, AP `make test platform-test`, Ruff and
`python3 scripts/check_project_success.py`. Original AP native run retained13failures/
16errors across25 backup cases because migration019 changed two constraints. A fresh
PostgreSQL18 catalog reproduced the old018 hash, measured the exact two-constraint
019 delta, and27 affected/negative cases passed with the deliberately updated fixed
hash. Validation was not disabled. Hosted final CI is the complete final-source gate.

Earlier real VM checkout failures remain recorded and were formally cancelled with
confirmed cleanup. Read-only guest stat showed `/tmp/source.bundle` absent; the fixed
trusted path moved to `/opt/agent-platform/source.bundle`, with a focused RED/GREEN.
A connector startup race failed before allocation and was cancelled as not admitted.
None of these runs called a provider. A post-release diagnostic GET requiring an active
lease was refused; final cleanup evidence uses AP receipts and read-only host observation.

Local Chromium lacked host libraries; the existing fixed review image supplied them.
No host browser packages were installed. Preflight used actual login/catalog/logout,
and one explicitly intercepted502 to prove reload retains uncertain-submit refusal.
Chromium's completed204 logout reports ERR_ABORTED; response204 plus a fresh
unauthenticated session read prove logout. Expected denial diagnostics and teardown
are separate from errors. Superseded preflight/lifecycle setup failures are retained.

## Operator entry and limits

Use the [isolated-mode runbook](../isolated-operator.md). The tested instance is private
qualification infrastructure, not a public or continuously operated deployment. It
contains one registered fixed-base fixture and one verified Claude route. Arbitrary
repositories, a second vendor, concurrent jobs and cross-device/restart recovery are
not accepted. Browser certificate trust was scoped to the exact test certificate SPKI;
this does not establish public HTTPS deployment or owner FN-07 acceptance.

Old Cloud AC-04 remains NOT_RUN. M2 adds a second actual vendor and two isolated tasks.
AC-05's minimum integration is M3: persist Fanzloud submission intent and the sole AP
run/result reference, then verify restart/replay and lost-submit reconciliation with
zero automatic resend. No new VM manager or native agent loop is required.
