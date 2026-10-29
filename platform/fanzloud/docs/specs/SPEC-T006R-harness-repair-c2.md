# Harness repair F1–F4 and the focused C2 browser run

Status: **approved by the owner on 2026-10-29** (「批准：修正 F1–F4 並準備 C2 driver，審查與 CI 通過後跑一次 C2。」). Desk T-0433 (issue 706), R2-AC-14 and R2-AC-E. C2 runs once, only after independent review and required CI of this change pass.

Basis:
- [SPEC-T005C](SPEC-T005C-p0-websocket-stream.md): upgrade refusals, the subscriber limit, lag, the serialization bound and close codes.
- The product route `apps/control-plane/src/websocket.rs` and T005A `subscribe` in `crates/codebox-session-runtime/src/runtime.rs`: refusal order and error mapping.
- [Conformance proposal](SPEC-T006R-conformance-proposal.md): C1 results, findings F1–F4 and the C2 scope.

This change touches only the T006R review harness, its tests and a new browser driver. It does not change the product controller, its security, retry or recovery behaviour, or any product acceptance.

## Part H — review harness repair

`fe-review/transport.mjs` and `fe-review/fixture.mjs` follow T005C on every path below. Canonical flows already passed on the old harness and are unaffected, because none of them reach these paths.

H01 — Upgrade admission (F4). A request to `/api/p0/v1/session/stream`, with or without `Upgrade`, is checked in the product's order. Each refusal is the T005B safe JSON envelope (`{"error":{"code","message"}}`) with `content-type: application/json`, `cache-control: no-store`, `x-content-type-options: nosniff`, an exact `content-length` and `connection: close`.

| Order | Condition | Status / code |
|---|---|---|
| 1 | Duplicate security header | 400 `invalid_request` |
| 2 | Path other than the stream route | 404 `not_found` |
| 3 | Method other than GET on the stream route | 405 `method_not_allowed` |
| 4 | A header value over 256 bytes | 422 `invalid_request` |
| 5 | Missing, malformed or expired cookie | 401 `authentication_required` |
| 6 | Connection over the harness bound of 32 open sockets (lifecycle admission) | 503 `service_unavailable` |
| 7 | Origin not exactly the configured origin | 403 `origin_forbidden` |
| 8 | Not an HTTP/1.1, version-13 WebSocket upgrade (`Upgrade: websocket`, `Sec-WebSocket-Version: 13`, a base64 16-byte key) | 426 `websocket_upgrade_required` / `a version-13 WebSocket upgrade is required`, plus `upgrade: websocket` and `sec-websocket-version: 13` |

A plain GET of the stream route therefore reaches 426 after the cookie and Origin checks. Other unknown upgrade paths are 404 JSON. The reconnect gate (`holdReconnect`) still holds at most eight upgrades and destroys any beyond that.

H02 — Subscriber limit (F1). The upgrade is no longer refused at eight sockets. After a valid subscribe frame, the fixture checks in T005A order: wrong session, future cursor, history gap, then the limit of eight admitted subscribers. The ninth admitted subscriber gets exactly one `subscriber_limit` error frame (`session subscriber limit reached`, no optional field) and close 1013 with reason `subscriber_limit`. No subscriber is registered for it.

H03 — Back-pressure and serialization (F2).
- All replay frames (`replay_begin`, events, `snapshot`, `replay_end`) are serialized before any is sent. If any frame, or later any live frame, exceeds the server message bound, the connection sends one `stream_unavailable` error and closes 1013. No partial replay is sent.
- Live frames go through a per-connection queue drained one send at a time. When the queue already holds the live capacity, the connection sends one `subscriber_lagged` error without `latest_available` and closes 1013. This matches the product, whose lag error carries no optional field.
- A send that does not complete within the 10-second write bound drops the connection without another application message.
- The old `bufferedAmount` check and its 1008 `protocol_error` close are removed.

H04 — Reachability (F3). Three review-only settings make the remaining paths reachable. Their defaults equal the product defaults, and the canonical runners do not set them.
- `createFixture({historyCapacity})`: an integer from 64 to 1024, default 256 (the product's range). A value out of range throws `REVIEW_LIMITS`. More events than the capacity evict the oldest, so a stale cursor gets `history_gap` with `oldest_available` and `latest_available`.
- `createTransport({limits:{liveCapacity, serverMessageBytes}})`: `liveCapacity` from 8 to 256 (default 32, the product's range); `serverMessageBytes` from 256 to 65536 (default 65536, the product's bound). Values out of range throw `REVIEW_LIMITS`.
- `transport.stallLive(on)`: a deterministic seam that holds every connection's live queue undrained while on, like T005C's gated private send seam. Turning it off drains each queue in order.

H05 — Unchanged: the 1024-byte subscribe bound, the five-second subscribe deadline, the 250 ms validity check, the 2-second close grace, the 1012 `server_shutdown` close, origin checks on mutations, and every HTTP route.

## Part T — tests

T01 — `fe-review/conformance-transport.node.mjs`:
- The two finding tests become contract oracles: `review_wss_upgrade_refusals_are_safe_json_in_product_order` (H01) and `review_wss_subscriber_limit_is_typed_1013` (H02).
- It adds `review_wss_history_gap_lag_and_unavailable_are_typed_1013_or_1008` (H03, H04). That covers `history_gap` with exact bounds and close 1008; `subscriber_lagged` with close 1013 and no frame after it; `stream_unavailable` with close 1013 and no replay frame; and `REVIEW_LIMITS` for out-of-range settings.
- Every existing oracle stays and still passes.

T02 — Historical runners. The v4–v7 runners pin the pre-repair `fixture.mjs` and `transport.mjs`. Their pin tests compare those two names with the recorded pre-repair hashes, and check that the current files differ, in the same way as the M2 asset pins. The v1 trace-transport restore test (`initial-lifecycle.node.mjs`) compares the stripped trace transport with the pre-repair `transport.mjs` hash instead of the current file. That changes its bytes, so the frozen suite hashes that chain from it are updated in order: v1 in `initial-lifecycle-v2.node.mjs`, v1 and v2 in `initial-lifecycle-v3.node.mjs`, and v3 in `initial-lifecycle-v4.node.mjs`. No runner file changes.

T03 — `fe-review/conformance-browser.node.mjs`: pure tests for the driver's verdict functions (C203) and its source pins, including that no canonical runner changed.

## Part C — the focused C2 browser driver

C201 — `fe-review/conformance-browser.mjs` is a new file. It reuses `lifecycle.mjs`, `trust.mjs`, `fixture.mjs`, `transport.mjs` and `baseline-support.mjs` unchanged, records SHA-256 for each with the served assets, and fails with `REVIEW_SOURCE_DRIFT` on any mismatch with its embedded pins. It produces conformance evidence, not canonical cells, and never writes into another run.

C202 — Checks, in this order, in one browser:

1. **R02 TLS (desktop).** `installFreshTrust` creates the NSS-trusted CA and a correct `IP:127.0.0.1` leaf. The driver adds two leaves in `/state`: a wrong-name leaf (`DNS:wrong.invalid`) signed by the trusted CA, and a correct-name leaf signed by a new CA that is not trusted.
   - Positive: on port 8443, `/` loads with 200 over HTTPS. After keyboard authentication, the stream reaches `connected` over WSS.
   - Negative: navigating to the wrong-name listener (8444) fails with `net::ERR_CERT_COMMON_NAME_INVALID`. The untrusted-CA listener (8445) fails with `net::ERR_CERT_AUTHORITY_INVALID`. `http://127.0.0.1:8443/` is not served: navigation fails, or ends anywhere other than an `http:` URL with status 200.
   - None of the three negatives adds a request to its transport's request count.
2. **R06 no-resend (desktop).** The fixture uses `historyCapacity: 64`.
   - The browser authenticates and submits one turn by keyboard, then waits until its cursor holds the two turn events.
   - `holdReconnect(5000)` closes the stream with 1012. While upgrades are held, the driver uses a second synthetic operator session over Node HTTPS (trusting only the private CA) to cancel the turn and run 16 submit-and-cancel cycles. That gives 68 events, so the browser's cursor falls behind the retained history.
   - The browser then reconnects and receives `history_gap`. It refreshes its snapshot and resubscribes at the snapshot high-water, and the stream returns to `connected`.
   - The driver then reloads the page and triggers Refresh by keyboard.
   - Pass when:
     - after the turn submit, every browser-originated HTTP request is a GET;
     - the browser sent exactly one `POST /session/turns` and one `POST /operator/session`;
     - the fixture's `POST /session/turns` count is 17;
     - the received frames include exactly one `history_gap` with `oldest_available` 5 and `latest_available` 68;
     - the next subscribe uses `after_seq` 68.
3. **R07 keyboard and names (desktop and mobile).** Scenario `success-diff`: keyboard authentication, a turn, completion and Show diff. Then:
   - Tab traversal from the document start, at most 60 presses, lands on `#event-list` and `#diff-output`. Each landing matches `:focus-visible` and has a computed outline style other than `none` with a width above 0. A screenshot of each landing goes into the private evidence.
   - The measured accessible names agree in two ways. Playwright's `getByRole('region', {name, exact:true})` resolves each heading text to its region. Chromium's accessibility tree (`Accessibility.getPartialAXTree` over CDP) reports role `region` and the heading text as the name.
   - On mobile, `#diff-output` overflows vertically (`scrollHeight > clientHeight`). With it focused, ArrowDown and then PageDown each increase `scrollTop`. On desktop, and for `#event-list`, overflow and keyboard scroll are recorded but not required.

C203 — Verdict functions (`fe-review/conformance-browser-verdicts.mjs`, pure): TLS error classification, the R06 request and frame verdict, the traversal verdict and the scroll verdict. The driver computes every pass or fail through them, and T03 tests them.

C204 — Health: any page error fails. Unexpected request failures in the positive, R06 and R07 contexts fail the run; the negative TLS navigations are expected to fail. Raw headers, bodies, cookies, bearer values, prompts and frame payloads are not recorded; frames are reduced to their type, error code and numeric fields.

C205 — Cleanup and deadline: the same `Lifecycle` cleanup as the canonical runner, with a 200-second internal deadline. Every listener is closed and ports 8443–8445 are proven absent before `result.json` is written.

## Runtime boundary (C2)

- Attempt `conformance-001`: one start, at most 300 seconds including cleanup.
  - Runs in the pinned image `fe-review-trust-terminal:20261024` (`sha256:f659591f…`) with `--network none`, `--cap-drop ALL` and `no-new-privileges`.
  - Mounts: the worktree read-only, the Playwright 1.63.0 tools and browser cache read-only, and private `/state` and `/output`.
  - Command: `node fe-review/conformance-browser.mjs` in `platform/fanzloud`.
- Before the start, a private launcher (`launch-conformance-c2.py`) checks:
  - the frozen source hashes and its own hash;
  - a runtime approval receipt (`APPROVE_ONE`, no retry, 300 seconds);
  - a started marker created exclusively.
- Cleanup removes the container and proves it absent.
- Stop conditions:
  - A FAIL is preserved, not retried and not renamed.
  - A product defect is reported as a finding; gates do not change.
- An independent actual review judges the result before it is recorded as evidence.

## Acceptance

- The H01–H04 oracles fail on the pre-repair harness and pass after it.
- All fe-review suites pass, with and without `REVIEW_MODULES` and `FE_REVIEW_RUNS`. T006 passes 10/10.
- Independent review and required CI pass before merge. C2 then runs once, and its result and review go into a follow-up PR.
