# T-0440 focused browser follow-up

Source: `c973bcf3bfb885617ea0adce1b73cf78f52f4199`. Attempt: `followup-001`, started 2026-10-29T17:53:43.505657+00:00, one start, 5.187 seconds including cleanup. No retry. Specification: [SPEC-T006F](../../../docs/specs/SPEC-T006F-browser-followup.md). PR: [790](https://github.com/fallrising/newclear/pull/790).

## Results

| AC | Result | Evidence |
| --- | --- | --- |
| AC-F01 | PASS | Native favicon regression first failed 404 vs 200; then 3/3 static route tests pass: exact ICO, GET/HEAD/security headers, safe 405/404. |
| AC-F02 | PASS | Chromium desktop 1440×900 and mobile 390×844 each automatically requested favicon once, status 200, exact embedded SHA. Both measured 12px gap and document width equal viewport. Screenshots precede bearer entry. |
| AC-F03 | PASS | One malformed frame received, one native browser socket close before Refresh, zero transport clients and disconnected UI. 1511.7ms quiet window: zero upgrades, clients or mutations. One explicit Refresh: one upgrade/subscribe, connected; no turn/cancel/mutation. |
| AC-F04 | PASS, independent final ACCEPT | Both contexts have zero page errors and failed requests; only expected initial session 401 and its console error. No favicon 404 or other HTTP/CSP error. All five resources closed; listener absent; outer container removed, no cleanup error. |

Native verification: `cargo test --locked -p codebox-control-plane p0_web_` 3/3; `node --test --test-isolation=none apps/control-plane/web/p0-client.test.mjs` 10/10; `cargo fmt --all -- --check`, workspace clippy `-D warnings`, all-targets/all-features tests 307/307 and binary build pass. `node --test fe-review/*.node.mjs` with the existing review modules/evidence environment: 307/307, zero skipped. Index/project-success/whitespace checks pass.

Hosted source CI: [Rust and operator web](https://github.com/fallrising/newclear/actions/runs/40925077059) and [validate](https://github.com/fallrising/newclear/actions/runs/40925077068), both SUCCESS on the exact runtime source. Independent pre-runtime source/launcher review ACCEPT at `5e6446bf`; `platform/fanzloud` bytes are identical at runtime source `c973bcf3` after a main merge resolving only unrelated plan additions.

Prior sandbox attempts could not use sccache, bind loopback or spawn Node (EPERM). These failures remain in the private work log; the native executions above passed. No browser failures or browser retries occurred.

## Artifact integrity and visual review

Private raw result SHA256: `9cbaad3b411fb9b6e26dae497e4fb1eeb7e9f34c48169d518028688dbe6a7db5`.
Desktop PNG SHA256: `ab853d08f588b61945fce090a3a88d60493814f6d5e54372e53846a2c23dbc4d`.
Mobile PNG SHA256: `f6378a8d0ec882aa20f3e0695cf0f266cc89743ce700df6352fb98c79c610565`.
ICO SHA256: `28e22fa21ed089eaaeb9c95aad45086624332c72944ce587c556ef6cbb85b740`.

Root inspected both PNGs: empty bearer input, readable labels, clearly separated Authenticate button, no clipping or horizontal overflow. Mobile text wraps within the card. The initial authentication-required message is expected. PNG inspection does not certify general accessibility or the rest of the product.

Tools: Node v24.18.0, Playwright 1.63.0, Chromium 153.0.8010.12. Image SHA256: `f659591ff6a2df30b6d644236056a7f1b185a4161852f5b6639f45f042427884`. The network-none container used fresh private trust/state and read-only frozen sources/tools. No TLS bypass or host trust modification. Outer maximum 300s, runtime cap 225s, internal deadline 200s. Private receipts preserve full source/launcher/manifest hashes, intent, start, result and cleanup; raw outputs and keys are not published.

## Boundaries

This is real Chromium running the current production HTML/JS/CSS with the synthetic review fixture. Native Rust tests separately prove the product favicon route. It is not a live native backend/Cloud/provider journey, not a rerun of historical canonical cells, and not a release or usable-mainline claim. T-0433/T-0438 original observations stay versioned. Current task has no remaining runtime work after independent actual-evidence acceptance; full-product AC-04/AC-05 remain outside scope.

Independent actual-evidence review: ACCEPT AC-F01–F04. The reviewer independently checked CI-before-start, all frozen source hashes against Git, result/PNG digests, both images, browser observations and actual cleanup. No blocker or rerun required. See [ACCEPT-T006F](../../../docs/acceptance/T006F.acceptance.md).
