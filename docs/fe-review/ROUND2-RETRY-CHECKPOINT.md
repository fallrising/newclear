# T-0380 remaining Round2 checkpoint — 2026-10-24

The owner explicitly approved all three previously pending proposals. This change
ships only the approved Tokio security prerequisite and records the two bounded
browser attempts. Delivery remains 17 of 19 units; PR598 and PR604 remain Draft and
incomplete. No full Round3, release, deploy or mainline acceptance is claimed.

## Tokio prerequisite

Only `platform/fanzloud/Cargo.lock` Tokio version/checksum changes from 1.53.1 to
1.53.3. The exact approved resolution changes no other package, Cargo.toml, Rust,
controller or API source. This resolves the observed RUSTSEC-2026-0386 cargo-deny
failure without ignoring the advisory. Original failed evidence remains retained.

| Exact command | Observed result | Elapsed seconds |
| --- | --- | --- |
| `cargo update -p tokio --precise 1.53.3 --offline` | exit0; only version/checksum | 0.214 |
| `cargo deny check` | exit0; all four categories ok | 0.816 |
| `cargo test --locked --workspace --all-targets --all-features` | exit0; 306 passed, 0 failed/ignored | 47.698 |
| `cargo clippy --locked --workspace --all-targets --all-features -- -D warnings` | exit0 | 7.084 |
| `cargo build --locked --workspace --bins --all-features` | exit0 | 9.953 |

Locked source SHA256 before: `8f5e41364656f9ddcfccdcd7037583a39b8fd9cda11b5f2b791f5146232f2390`.
After: `a6a7907306b026b31f94a413d38f1e4c482c29ebff1cdde871abb234cb8b5797`.
The patch candidate and checked original worktree have byte-identical production
source/build inputs and patched lock. Earlier unchanged Node10/fmt evidence is
retained; no unnecessary local repeat. Required current-head CI remains mandatory.
Independent T024 review accepted the bounded patch/source/native evidence; this is
not acceptance of the unfinished Fanzloud FE unit.

## Loom single additional attempt

`loom-005 --journey-only` failed after 3.376 seconds. All owned browser/context/server
cleanup and outer-container removal passed. The previous 12-key matrix and network
canary were hash-qualified and not repeated. Result receipt SHA256: `e4eeabbbbd52ea64fe47bb6c93e8a38223702f47d1bc72fc48d9e1b9b133463a`.

The actual CanvasSurface sets `nodeDragThreshold={4}`. Author and independent source
review incorrectly relied on library default1; 2px activation did not cross the actual
threshold. The pure model also used1, so its7 passing tests did not establish configured
runtime behavior. The real result still has about9.899px overlap, source handle
occluded and zero edges. Original failure history and this review omission remain.

That extra attempt is consumed. Proposed next action, requiring new explicit approval:
derive the configured threshold from source, test the real4px setting, activate with5px,
verify movement with a further1px real pointer step, then recompute remaining movement.
No implementation or further attempt is authorized by this checkpoint. PR598 Flowshot
CI separately has three manifest-drift failures: the task-board entry was not regenerated.
The final PR must regenerate only derived integrity files and pass required CI; no
product/native gate is waived. Flowshot's19-capture evidence remains retained.

## Fanzloud single additional attempt

`baseline.mjs desktop canceled-once` failed after 4.396 seconds at
REVIEW_BASELINE_HEALTH. All owned resource cleanup, listener absence and container
removal passed. Result receipt SHA256: `c954319ef9534d46bf8392bee6ce15a40126d99d8f40ba81bfd4b32a05f768d2`.

The targeted POST202 was observed complete: exact schema/body matches fixture,
server finished, requestfinished true, no requestfailed, clean idle UI and no automatic
refresh. This is evidence for that request only. An earlier bootstrap POST201 had
ERR_ABORTED and failed the unchanged health gate. Its legacy `responseBodyRead:false`
means NOT_ATTEMPTED, because the observer did not read201; it is not proof of unreadable
body or a harmless abort. Original202 failures remain unexplained historical results.

Exactly six earlier desktop states remain accepted. Canceled-local remains failed;
disconnected/recovery-required were not entered, tablet/mobile/full conformance and
presentation acceptance remain pending. The one extra attempt is consumed; changing
route/status does not reset the same abort issue's retry allowance. Any further
observer or network-boundary experiment requires a concrete new approved proposal.
No generic abort exemption or security/interception/product change has been made.

A concrete optional next proposal is one bootstrap-only observer: at most15minutes
active implementation/pure checks and5minutes runtime, exactly one authentication
and stop before any turn. Bootstrap has no idempotency key, so correlation must use
one RAM-only method/route/count ordinal; record201 server finish, exact response body,
terminal event and settled UI before another action. It does not authorize canceled
flow continuation or any no-Fetch/security-boundary comparison. This remains unapproved.

## Evidence and next step

Original dirty worktrees, raw failures and private screenshots/state remain preserved.
Only safe facts and digests are published here. Detailed command receipts and T022–T025
reports are retained with the existing private FE Round2 evidence; local presence does
not imply remote artifact availability. Journal synchronization uses the existing run; publication is pending at this snapshot.
Unknown aggregate active time, provider requests, tokens and cost stay unknown/null.
The next dependent action is owner decision on further bounded work; the original
20-minute progress checkpoint is not a hard deadline and does not renew retry limits.
