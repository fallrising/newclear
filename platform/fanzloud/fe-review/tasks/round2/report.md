# T-0380 / T-0433 — Fanzloud original Round2 M1–M3 (R2-AC-14)

Every R2-AC-14 condition in [ROUND2-SDD](../../../../../docs/fe-review/ROUND2-SDD.md) line 17 is shown below with linked evidence, so `targets.json` is now `verified:true`. The M1 harness, M2 repairs and M3 regression captures are complete for the approved synthetic scope. Real backend wiring, live Cloud and the product mainline are outside this result. Desk [T-0433](https://github.com/fallrising/desk/blob/main/tasks/T-0433-fanzloud-fe2-completion/task.md), [issue706](https://github.com/fallrising/newclear/issues/706).

## Result and scope

- **M1 harness:** a finite HTTPS/WSS synthetic harness under `fe-review/`. It serves the four product assets byte for byte, implements only the T006 HTTP surface and the T005B/C shapes, and fails closed on unknown routes and frames. It runs in a pinned `--network none` container with a fresh private CA trusted only by that run's browser. No production control-plane, runner, Codex CLI, credential or Cloud call is started.
- **M2 presentation:** three measured defects were repaired (PR725): mobile overflow (399 > 390), event and diff regions that were not focusable or named, and contrast evidence (bound ≥ 6.96:1, cross-checked on PNG). Nothing else in the product UI changed.
- **M3 regression captures:** 27 dark canonical cells (9 states × 3 sizes), focused journeys N01–N09, and the unchanged shared `capture.mjs` against private targets.
- **Product source:** `apps/control-plane/web/` was last changed by PR725 (M2) and before that by PR604. The PR604 `p0-client.js` bounded read fix was made under [SPEC-T006](../../../docs/specs/SPEC-T006-private-operator-web.md) P-006-10 with its own owner approval, not under T006R, which does not change the controller. Served asset hashes: `/` `dd5d6c2e…`, `p0-app.js` `a0dcb11e…`, `p0-client.js` `a7c0fe33…`, `p0.css` `1d66f393…`. They are the same in every run from v7 on.

## R2-AC-14 conditions (ROUND2-SDD line 17)

| Condition | Evidence | Result |
| --- | --- | --- |
| Every decided change has implementation or evidence | M1: C1 15 oracles (PR735) and the F1–F4 harness repair (PR739). M2: PR725. M3: v7 27/27 (PR731), `journeys-001` (PR752/754), `capture-002` (PR761/764/765) | holds |
| Changes made only after measurement carry the observation | M2-01..03 each cite the measured baseline ([SPEC-T006R-m2-repair](../../../docs/specs/SPEC-T006R-m2-repair.md)). The read-path fix cites the app-free [layer ablation](../../../../../docs/fe-review/fanzloud-completion-regression/LAYER-ABLATION.md) (reader + no-store ERR_ABORTED; `arrayBuffer` 0/600) | holds |
| Actual startup, journeys and owned cleanup pass | v7 desktop/tablet/mobile, `conformance-001`, `journeys-001` and `capture-002`: each container removed and its listeners (8443, plus 8444–8445 for C2) proven absent before the result was written | holds |
| targets match the runtime | `capture-002` copied `targets.json` (`5aa2d64c…`) byte for byte to private targets and served `https://127.0.0.1:8443`, which matched | holds |
| Evidence and limits recorded per R2-AC-E | this report | holds with this PR |
| No missing prerequisite; no PASS from documents or mocks alone | every runtime result has a receipt and an independent actual review; required CI passed on every PR; real backend/Cloud is stated as out of scope | holds |

`capture-002` ran on the pre-flip bytes `5aa2d64c…` (`verified:false`). `capture.mjs` does not read `verified`, so the flip changes only the flag and `verifiedNote`. The wrapper pin in `shared-capture.mjs` moves to the new `targets.json` hash, and the targets test now asserts `verified:true`. `verified:true` is required metadata for the synthetic review origin. It is not evidence of real backend, security or owner acceptance.

## Source commits

| Milestone | PR | Head | Merge | Merged (UTC) |
| --- | --- | --- | --- | --- |
| ERR_ABORTED bounded read fix, dark baseline 27/27 | [604](https://github.com/fallrising/newclear/pull/604) | `7a69aa74` | `01119084` | 2026-10-28T17:26:18Z |
| M2 repairs | [725](https://github.com/fallrising/newclear/pull/725) | `158056c8` | `ed063534` | 2026-10-28T17:55:29Z |
| v7 recapture 27/27 on the M2 source `fa614871` | [731](https://github.com/fallrising/newclear/pull/731) | `e613bdfd` | `0ff9bab0` | 2026-10-28T18:18:08Z |
| C1 conformance | [735](https://github.com/fallrising/newclear/pull/735) | `ddfa04e1` | `d77a6ffd` | 2026-10-29T03:41:54Z |
| F1–F4 harness repair, C2 driver | [739](https://github.com/fallrising/newclear/pull/739) | `a126796a` | `74b107e6` | 2026-10-29T05:39:47Z |
| C2 results | [743](https://github.com/fallrising/newclear/pull/743) | `b43f169e` | `669e24ac` | 2026-10-29T05:46:49Z |
| Focused journeys spec, seams, driver | [752](https://github.com/fallrising/newclear/pull/752) | `df10a299` | `ab4ebac2` | 2026-10-29T08:39:01Z |
| `journeys-001` results | [754](https://github.com/fallrising/newclear/pull/754) | `5e22f841` | `f7c45811` | 2026-10-29T12:03:59Z |
| Shared capture spec and wrapper | [761](https://github.com/fallrising/newclear/pull/761) | `9c9f9b47` | `582403c3` | 2026-10-29T14:45:48Z |
| Wrapper tool-resolution fix | [764](https://github.com/fallrising/newclear/pull/764) | `92c16767` | `f8b12f76` | 2026-10-29T14:58:53Z |
| `capture-002` results | [765](https://github.com/fallrising/newclear/pull/765) | `51378cfb` | `e558d5f7` | 2026-10-29T16:24:51Z |

The Tokio prerequisite (PR616, merge `63568403`) was approved earlier and is not a new dependency change.

## Commands and tool versions

Runtime image `fe-review-trust-terminal:20261024` (SHA256 `f659591f…`), UID 1000, `--network none`, Node v24.18.0, Playwright 1.63.0, Chromium 153.0.8010.12, OpenSSL 3.0.13. Each run was started once by a private root launcher after its own owner approval. In-container commands, from the component root:

| Run | Command | Source | Result |
| --- | --- | --- | --- |
| v7 desktop/tablet/mobile | `node fe-review/remaining-v7-baseline.mjs` (one phase each) | `fa614871` | PASS, all CANONICAL_ACCEPT, 27/27 |
| `conformance-001` | `node fe-review/conformance-browser.mjs` | `a126796a` | PASS 4/4 verdicts, 10.8 s, review ACCEPT |
| `journeys-001` | `node fe-review/journeys-browser.mjs` | `df10a299` | PASS 11/11, 80.4 s, review ACCEPT_WITH_FINDINGS |
| `capture-001` | `node fe-review/shared-capture.mjs` | `9c9f9b47` | FAIL at PRECONDITION in 0.3 s (wrapper defect); kept |
| `capture-002` | `node fe-review/shared-capture.mjs` (retry of `capture-001`) | `92c16767` | PASS 4/4 verdicts, 5.0 s, review ACCEPT_WITH_FINDINGS |

`capture-002` ran the unchanged `docs/fe-review/capture.mjs` (`d00b6bf7…`) as `--dry-run` and then as the actual three-size static capture against the private targets.

Native and local gates (host Node v24.18.0):

- `node --test fe-review/*.node.mjs` from `platform/fanzloud` with `REVIEW_MODULES` (the Playwright 1.63.0 tools directory) and `FE_REVIEW_RUNS` (the private v7 runs directory): 302/302 on this PR.
- T006: `node --test --test-isolation=none apps/control-plane/web/p0-client.test.mjs` 10/10.
- CI `fanzloud-ci.yml` on every PR above: Node 24.18.0 `p0-client.test.mjs`; Rust 1.97.1 `cargo fmt --all -- --check`, `cargo clippy --locked --workspace --all-targets --all-features -- -D warnings`, `cargo test --locked --workspace --all-targets --all-features`, `cargo build --locked --workspace --bins --all-features`; `git diff --check`. The fe-review node suites are not in CI; they are local only.
- `cargo deny check`: advisories, bans, licenses and sources ok on 2026-10-24 after the approved Tokio 1.53.3 patch (PR616). `Cargo.lock` and `deny.toml` have not changed since, so it was not rerun; its advisory data is as of that date.
- Rustdoc projection: the only Rust change in this unit is one added test in `apps/control-plane/tests/p0_subscription_e2e.rs` (PR604). No public signature changed.

## Results per clause (SPEC-T006R R01–R12)

| Clause | Evidence | Result |
| --- | --- | --- |
| R01 exact assets, unknown routes fail closed | `review_exact_assets_and_unknown_routes_fail_closed`; wrapper pins of the four served assets | PASS |
| R02 contained state, TLS | `review_fresh_state_origin_and_environment_are_contained`; C1 Node TLS; `conformance-001` R02: private-CA HTTPS/WSS work, wrong name `ERR_CERT_COMMON_NAME_INVALID`, untrusted CA `ERR_CERT_AUTHORITY_INVALID`, plain HTTP `ERR_EMPTY_RESPONSE` | PASS |
| R03 HTTP fixture equals the controller contract | `review_http_fixtures_match_actual_controller_contract` over the real loopback HTTPS transport (C1-b) | PASS |
| R04 ordered WSS, bounds, invalid frames | C1-a oracles over real WSS; F1–F4 found and repaired (H01–H04) | PASS |
| R05 explicit actions are the only mutations | `review_explicit_actions_are_the_only_mutations`; `journeys-001` per-route browser counts equal fixture counts, mutations only in auth/submit/cancel/logout | PASS |
| R06 gap, restart, timeout, refresh without resend | C1-d partitions; `conformance-001` R06 (subscribe at 2, one `history_gap` 5/68, resubscribe at 68, only GETs after submit); `journeys-001` J03 (client timer fired 15,009 ms after the press, no resend) | PASS |
| R07 measured presentation at three sizes | v7 27 cells: no unexpected overflow, axe no critical/serious; `conformance-001` R07: Tab lands on `#event-list` and `#diff-output` with `:focus-visible`, names "Ordered activity"/"Final diff" from both role query and AX tree, mobile diff keyboard scroll | PASS, limits below |
| R08 secrets cleared, diff inert | `review_secrets_clear_and_diff_is_inert` over v7; canary empty in `journeys-001` and `capture-002` | PASS |
| R09 owned bounded lifecycle | `review_late_acquisition_and_stalled_cleanup_fail_honestly`; cleanup receipts in every run | PASS |
| R10 canonical keys and focused journeys | `review_canonical_capture_keys_are_complete_and_immutable` (exact 27, hashes, chain); N01–N09 below | PASS |
| R11 native and shared capture | native gates above; `capture-002` | PASS |
| R12 evidence and acceptance | this report; `review_evidence_keeps_native_and_mock_boundaries` | PASS |

Focused journeys, mapped as [SPEC-T006R-focused-journeys](../../../docs/specs/SPEC-T006R-focused-journeys.md) specifies:

| Journey | Evidence |
| --- | --- |
| N01 gap and future cursor | `journeys-001` J01a/J01b; gap in `conformance-001` R06 |
| N02 stale instance, restart, 401 | `journeys-001` J02 restart and instance |
| N03 actual 15 s timeout after admission | `journeys-001` J03 |
| N04 malformed, binary, unknown-field frames | `journeys-001` J04 ×3 (server→client); C1 (client→server) |
| N05 refresh and disconnect without mutation | `conformance-001` R06; canonical `disconnected` at three sizes |
| N06 cookie, Origin, instance, key denial and replay | `journeys-001` J05 cookie expiry and J02 instance; client 403 handling in canonical `action-rejected`; Origin check, key replay and conflict at the Node layer (C1, `bounds.node.mjs`), as the spec states |
| N07 logout, dispose, late callback, secret cleanup | `journeys-001` J06; late-callback part in the R09 partitions |
| N08 unsafe HTML diff stays exact text | canonical `success-diff` at three sizes; R08 oracle |
| N09 network fallback, TLS negatives | `conformance-001` R02; `--network none` |

## Mock and real boundary

All browser evidence comes from the review harness: a synthetic fixture and transport behind a private CA, with the four product assets served byte for byte and the actual `p0-client.js` controller in a real Chromium. The Rust control-plane, the real HTTP/WS server, Codex CLI, device login and Codex Cloud were never started. Real backend TLS wiring and live Cloud need their own explicit scope (ROUND2-SDD R2-AC-14). [SPEC-T007](../../../docs/specs/SPEC-T007-p0-subscription-e2e.md) stays separate product-side evidence and is not counted here. SUCCESS AC-04 (live operator smoke) and AC-05 (actor/store loop) stay pending; mainline stays incomplete with no usable tag.

## Cleanup and backups

Every run closed its own listeners and the outer launcher removed its container. Results, PNGs and receipts stay private and untracked. Backups, each with SHA256SUMS re-checked on 2026-10-29 with 0 failures, are in `/home/ckc/test/backup/fe-round2-20261024/`:

- `t0433-recapture-20261028T181826Z` (85 files)
- `t0433-c2-conformance-20261029T054119Z` (10)
- `t0433-journeys-20261029T114943Z` (7)
- `t0433-capture-001-fail-20261029T145015Z` (7)
- `t0433-capture-002-20261029T150048Z` (12)

The run-only CA and leaf keys from `capture-002` remain at mode 0600 in the private state outside the repository. Disposing of them is the owner's decision. No credential, raw header, body, cookie, prompt or frame payload was recorded.

## PR and CI readback

Each PR above merged normally after independent review. Both required checks passed on its head:

| PR | Rust and operator web | validate |
| --- | --- | --- |
| 604 | 40735158937 | 40735158721 |
| 725 | 40739900434 | 40739900018 |
| 731 | 40743371271 | 40743371062 |
| 735 | 40813281215 | 40813281273 |
| 739 | 40824439120 | 40824439114 |
| 743 | 40825150715 | 40825150730 |
| 752 | 40843329822 | 40843329785 |
| 754 | 40869860183 | 40869860161 |
| 761 | 40894279176 | 40894279123 |
| 764 | 40896391282 | 40896391594 |
| 765 | 40898520980 | 40898520962 |

After each merge, the fetched main `platform/fanzloud` tree was compared with the reviewed head and was equal. On 2026-10-29 every merge commit's `platform/fanzloud` tree was re-checked against its head and all 11 were equal.

## Preserved failures

- `recovery007` and the earlier attempts stay FAIL and consumed. Their records are in [ROUND2-CLOSEOUT](../../../../../docs/fe-review/ROUND2-CLOSEOUT.md) history and the private backups.
- `capture-001` FAILED at the wrapper tool precondition before any server or browser started: `require('@axe-core/playwright/package.json')` is not exported by that package. This was a wrapper defect, not a product or `capture.mjs` defect. The FAIL is kept and was not renamed; `capture-002` is its retry after the PR764 fix.

## Limits

- The mobile diff keyboard scroll was sampled mid smooth-scroll (0 → 1 → 9). Only the mobile diff overflows, so the event list and desktop regions show keyboard reachability and names but not keyboard scroll.
- In `journeys-001`, the `j06_logout` DOM fields were overwritten after the verdict, so they rest on the stored verdict. J01a cannot tell a clamped cursor from an unapplied rewrite. J06b shows abort on dispose, not a late response.
- The C2 refresh-before-resubscribe step is inferred, not timestamped.
- TLS negatives come from `conformance-001`; `capture-002` shows TLS positively only.
- One headless Chromium, dark only, synthetic data. Light theme and Round 3 are out of scope.
- The fe-review suites run locally only, not in CI.

## Product findings

These were observed and recorded. The product was not changed for them, and no gate was relaxed.

1. **Socket stays open after a self-detected protocol error (medium).** In `journeys-001` J04 (×3), after the client detected an invalid server frame, its socket stayed open (`socketClosedBeforeRefresh=false`, one transport client) until a manual Refresh. A Refresh closed it within about 6–16 ms. The suspected cause is `socket.close(1008, "")` in `p0-client.js` `streamFailure`, which the browser WebSocket API rejects with `InvalidAccessError`. That cause is a source inference and was not observed.
2. **favicon 404 (low).** Chromium's automatic `GET /favicon.ico` gets 404 and logs one desktop console line. The product serves no favicon.
3. **Authenticate button touches the input (low, cosmetic).** The button sits directly under the bearer input with no vertical gap at all three sizes.
4. **TLS only positive in `capture-002` (low).** Negative TLS stays with `conformance-001` R02.

The harness findings F1–F4 (review transport versus T005C) were in the review harness, not the product, and were repaired by PR739.

Aggregate provider/model calls, tokens and cost are unknown.
