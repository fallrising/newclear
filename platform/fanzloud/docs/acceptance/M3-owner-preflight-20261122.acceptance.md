---
id: ACCEPT-M3-OWNER-PREFLIGHT-20261122
decision: accepted
---

# M3-U offline owner-operation preflight

[Scope and PRE01–03](M3-owner-operation.md#m3-u-離線重新核對--2026-11-22).
Owner authorized offline recheck and a refreshed concrete operation plan before a live window.
Pinned source: `e2479f4dc0e8596f59dfc34fc124726cee57b389`.
Historical actual source: `86350871766bbfbe9d29325b49aae659c2d74c92`.
No production/launcher code, dependency, store, credential or execution-policy change.

## Evidence and limitations

[Sanitized receipt](evidence/M3-owner-preflight-20261122/preflight.json) contains current
observations. The lead's retained local audit reads files and does not import/invoke
window.py. It verifies SHA256 against the original226-entry manifest,118 runtime entries,
fixed binary and six original/template/inverse-substitution digests. All match.
Original SQLite queried with `mode=ro&immutable=1` only after confirming no nonempty WAL:
4confirmed/0unknown. Config/SQLite mode0600; config/SQLite/WAL/SHM/certificate presence,
content hashes and mtime unchanged across audit. No secret fields, raw DB rows, private
paths, account names, host addresses or dump content are published.

Certificate metadata: expired2026-11-02T19:16:18Z;600-second validity **failed**.
Existing saved Python/Node paths exist; no runtime probe is claimed. Free space exceeds
15GiB. Current network namespace `/proc/net/tcp` and `tcp6` show zero listeners on the
four original ports; this is not a remote resources or arbitrary process inspection.

Original exact DB inspection first failed under the sandbox with permission denied.
Authorized read-only host inspection then returned **no such object**, exit1. Exact-name
container listing returned exit0/no match; context is default with a local Unix endpoint.
There are no Fanz-named volumes, but the original anonymous/other-named volume was not
identified; **data loss is not established**. Do not report this as DB stopped or ready.
A retained pre-U07 maintenance dump exists and matches its manifest length/hash; no
restore was attempted, and equivalence to final original runs/archives is unproven.

Source comparison command:

```sh
git diff --name-only 86350871766bbfbe9d29325b49aae659c2d74c92 e2479f4dc0e8596f59dfc34fc124726cee57b389 -- platform/fanzloud/apps platform/fanzloud/crates platform/agent-platform/src
```

Only isolated.html, isolated.js and p0.css differ in this product scope. The Rust route
embeds assets with `include_bytes!`, so unchanged Rust source does not make the old binary
serve the updated UI. Its original hash remains valid only for its historical source.
The saved gate allows existing-result reads and session actions, rejects execution
mutations, and cannot implement full FN07. The operation document now orders recovery:
original data → reviewed source → full-operation gate → TLS/trust → owner window.

Owner connection/trust and remote VM/claims/cgroups/reservations are **not reverified**.
Original services/CLI/VM starts, intent consumption and credential changes: zero.
No browser, full Rust/AP, live provider, restore or original service test was performed;
none is required to accept this documentation-only audit, and none is claimed as passed.
The readiness result is **not_ready**, distinct from acceptance of the audit document.

## Acceptance gates

| AC | Evidence | Status |
| --- | --- | --- |
| PRE01 | Current sanitized file/DB/TLS/listener observations, failures and unknowns preserved | Observations complete; readiness not_ready |
| PRE02 | Fixed-source diff and actual gate/policy inspection; concrete recovery order with unchanged FN07 | Accepted as document; no live readiness claim |
| PRE03 | Root indexes, links/privacy/scope and independent fresh-context review passed; final-head CI/merge/readback remain | Source accepted; delivery pending |

Required local commands after staging new files:

```sh
python3 scripts/check_indexes.py
git diff --cached --check
git diff --exit-code
```

Required source review and final-head CI remain gates. BOARD will record actual merge
and remote readback; only PRE01–03 may close. Original M3-U/FN07/fullM3/mainline/usable tag
status is unchanged. Earlier historical evidence remains intact.

## Independent document decision

Fresh-context reviewer: **ACCEPT**, no blocking findings across the exact six staged
files. Independently ran55 project contracts/9 llms indexes, staged whitespace and
index/worktree alignment; parsed receipt JSON, checked156 relative link targets and
all six public template SHA256 hashes. Reproduced the fixed-SHA three-file product
diff and verified Rust asset embedding; original FN07 contract/status and historical
records preserved. Lead reviewed actual output and accepts this offline document set.
Lead separately checked six-file scope/privacy patterns and unchanged production,
SDD and gate. No raw private paths, accounts, DB rows, dump or key material included.

Reviewer did not independently reproduce private hash/SQLite/Docker/host observations;
those remain lead observations, not an independent runtime pass. No source code or
fixture behavior changed, so prior browser/Rust/AP/provider/launcher suites were not
rerun. Current not_ready is a measured outcome, not a failed documentation acceptance.
Required hosted CI/merge/readback and board closure are still pending at this source
checkpoint; final BOARD record supersedes these pre-merge delivery notes only.
