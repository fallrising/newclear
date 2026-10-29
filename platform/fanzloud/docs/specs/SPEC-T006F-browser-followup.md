# T006F — Favicon and focused browser follow-up

Status: specified for T-0440; implementation and runtime evidence pending.
Contract unit: CU-WEB-P0-01 (SPEC-T006). Owner direction, 2026-10-29: complete the previously deferred favicon fix and browser observation of the T-0438 fixes.

## Scope and design

F01 — Add exactly `GET /favicon.ico` and `HEAD /favicon.ico` to the embedded static surface. Serve a small, valid 16×16 ICO with `Content-Type: image/x-icon`, the same no-store and security headers as other assets, and an empty HEAD body. No filesystem lookup, API authority, dependency, HTML/client/CSS change, or redirect. Unknown favicon subpaths remain 404 and other methods return safe 405. The current CSP already has `img-src 'self'`; it remains byte-for-byte unchanged. The icon contains no executable or external content.

F02 — In a fresh desktop Chromium context, the page's automatic favicon request must receive 200 with the embedded bytes. No request interception may suppress the favicon. Capture the bootstrap page at desktop 1440×900 and mobile 390×844; measure the vertical gap from bearer input bottom to Authenticate button top (at least 12 CSS px), and require no horizontal document overflow. Capture before entering any bearer.

F03 — On the unchanged current client in Chromium, authenticate with synthetic fixture credentials and inject one malformed text frame. Before any Refresh, observe the browser WebSocket close event, the transport client count reach zero, and the UI become disconnected with its fixed invalid-frame error. For 1500 ms after closing, assert zero new upgrades and zero fixture mutation-count changes. Then one explicit Refresh must reconnect once without starting or canceling a turn. This is focused browser evidence against the review fixture, not native-provider or Cloud evidence.

F04 — Browser health records page errors, console warnings/errors, failed requests and HTTP failures. Only the one initial bootstrap GET session 401 per fresh context is expected; no favicon 404, CSP error, unrelated HTTP failure or page error may be hidden. Record the automatic favicon status/count at the server because Chromium may omit it from Playwright request events. The transport's opt-in favicon support defaults off so historical captures retain their original behavior and pinned bytes.

F05 — One bounded attempt (`followup-001`, at most 300 seconds including cleanup) uses the existing pinned trust-enabled image, Node 24.18.0, Playwright 1.63.0 and Chromium 153.0.8010.12, an isolated network-none container, read-only source/tool/browser mounts and fresh private state/output. No real credentials, backend, external request, TLS bypass or host trust modification. Freeze source hashes and launcher, record intent/started/outcome, and prove container/listener cleanup. Do not silently retry; retain failed receipts. The current owner request authorizes this focused follow-up after code review and required CI pass. Historical runners/results stay unchanged; a new result never relabels old evidence.

## Acceptance and verification

| AC | Given / When / Then | Evidence |
| --- | --- | --- |
| AC-F01 | Given the Rust router, when GET/HEAD/POST and an unknown icon subpath are requested, then embedded ICO, unchanged security headers, empty HEAD, 405 and 404 match F01. | Focused Rust test, then normal Rust CI gates. |
| AC-F02 | Given fresh desktop/mobile Chromium pages, when they load, then the automatic favicon succeeds and screenshots/DOM measurements show the Authenticate gap without overflow. | followup-001 receipt and two PNGs; independent visual review. |
| AC-F03 | Given a connected current client, when malformed text arrives, then native WebSocket closure, zero clients, terminal quiet window and explicit Refresh recovery match F03. | followup-001 browser/transport observations; existing T006 controller tests. |
| AC-F04 | Given the focused harness, when it runs and closes, then browser health and cleanup match F04/F05 and historical evidence stays pinned. | harness regression tests, full fe-review suite with evidence environment, source/cleanup receipts and independent acceptance review. |

Native commands: `cargo test --locked -p codebox-control-plane p0_web_`; `node --test --test-isolation=none apps/control-plane/web/p0-client.test.mjs`; `node --test fe-review/*.node.mjs` with REVIEW_MODULES and FE_REVIEW_RUNS; `cargo fmt --all -- --check`; workspace clippy/test/build in CI; repository check_indexes/check_project_success and staged whitespace checks.

## Semantics and exclusions

Static reads are idempotent and have no side effects beyond existing route metrics. There is no new retry, recovery, authentication, persistence, cancellation or atomicity policy. Browser credentials and trust keys are private run-only artifacts; receipts omit them. Cleanup failure or unknown runtime outcome blocks acceptance. No runtime dependencies or permissions are broadened. Cloud entitlement smoke, durable actor/store/runtime integration, Round 3, releases and deployments remain outside this task.
