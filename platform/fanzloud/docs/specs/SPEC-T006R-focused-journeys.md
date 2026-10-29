# Focused desktop journeys N01–N09 and the journeys browser run

Status: **implemented, merged (PR752) and `journeys-001` run once: PASS, actual review ACCEPT_WITH_FINDINGS.** Owner direction on 2026-10-29 (「按你建議。」), accepting option A of the T0433-3 inventory: add one focused desktop browser run for the R10 journeys that lack browser receipts. Desk T-0433 (issue 706), R2-AC-14 and R2-AC-E. The run, `journeys-001`, was approved by the owner on 2026-10-29 (「批准：跑一次 journeys-001。」) after independent review and required CI passed.

Basis:
- [SPEC-T006R](SPEC-T006R-fe-review.md) R10: "Focused desktop journeys … must have actual fixed stage/counter/identity receipts, not screenshot filenames alone."
- SPEC-T006R R06: "at least one real browser timeout must observe the actual timer and no resend."
- SPEC-T006R R05: "Same-key replay/conflict and logout invalidation are focused tests, not new UI controls."
- [Conformance proposal](SPEC-T006R-conformance-proposal.md) and [harness repair and C2](SPEC-T006R-harness-repair-c2.md): C1 and C2 results.

This change adds five review-only seams to `fe-review/transport.mjs`, one driver, its pure verdict module and their tests. It does not change `fixture.mjs`, `lifecycle.mjs`, `trust.mjs`, `baseline-support.mjs`, any runner, the product controller or any product acceptance.

## Journey map

Each journey is listed with the evidence that covers it and the layer that evidence comes from. "Browser" means the actual `p0-client.js` running in Chromium over the private-TLS HTTPS/WSS transport. "Node" means the real loopback transport driven by a Node client. "Partition" means the actual controller with fake primitives.

| N | Journey | Existing evidence | Layer | This run |
|---|---|---|---|---|
| N01 | gap and future cursor | gap: C2 `conformance-001` R06 (one `history_gap` 5/68, resubscribe at 68). future cursor: C1 `review_wss_errors_have_exact_fields_and_policy_close` | gap: browser. future cursor: Node | **J01** |
| N02 | stale instance, restart and 401 | 1012 restart: C2 R06. Restart, stale instance and 401: C1 partition `review_gap_restart_timeout_and_refresh_preserve_no_resend` | 1012: browser. Others: partition | **J02** |
| N03 | actual 15 s timeout after an admitted mutation | timeout partition (fake clock) | partition | **J03** |
| N04 | malformed, binary and unknown-field frames | client→server: C1 `review_wss_invalid_frames_close_without_effects` | Node | **J04** (server→client) |
| N05 | refresh and disconnect without mutation | C2 R06 (reload, keyboard Refresh, only GETs). Canonical `disconnected` on all three sizes | browser | — |
| N06 | cookie, Origin, instance and key denial and replay | Client handling of 403 `origin_forbidden`: canonical `action-rejected` (the scenario returns the 403 for one explicit action). The Origin check itself, cookie refusal, key replay and conflict: C1 and `bounds.node.mjs` R05 | handling: browser. Checks: Node | **J05** (cookie expiry), **J02** (instance) |
| N07 | logout, dispose, late callback and secret cleanup | C1 logout invalidation, R09 lifecycle tests, R08 per-cell DOM flags | Node, partition | **J06** |
| N08 | unsafe HTML diff stays exact text | canonical `success-diff` on all three sizes; R08 oracle | browser | — |
| N09 | network fallback and TLS negatives | C2 R02 (wrong name, untrusted CA, plain HTTP); `--network none` | browser | — |

Kept at the Node layer, with the reason:
- **The Origin check (N06).** The check that refuses a wrong Origin lives in the review fixture, not in the product, and C1 proves it over the real transport. The browser half is the client's handling of the 403, which canonical `action-rejected` covers. Forcing another Origin through the browser would only test the fixture again.
- **Same-key replay and conflict (N06).** R05 makes these focused tests, not UI controls. The client generates a new key per action, so a browser cannot replay one.

## Part H — review transport seams

All seams are off by default, one-shot and disarmed once used. No canonical runner, C2 or earlier driver calls them. None of them records a header value, body, cookie or frame payload.

H01. `transport.holdNextResponse(method, path)` arms a hold for the next request with that exact method and path.
- Only API routes accepted by `allowedRequest` (paths under `/api/p0/v1/`) qualify. A static asset, an unknown route, or a second hold while one is armed or held throws `REVIEW_HOLD`.
- When the request arrives, the fixture handles it as usual, so its effect is admitted and counted. The transport does not write the response.
- If the client closes the connection first, the response is never written, and the hold records `client-closed`.
- `transport.releaseHeld()` writes the held response if the connection is still open and records `released`; if the client already closed, it records `client-closed`. With nothing held it throws `REVIEW_HOLD`.
- A held response that is neither released nor closed within 20 s has its connection destroyed, and the hold records `expired`.
- `close()` destroys a still-held connection and records `closed`.
- `transport.summary().held` reports `{method, path, status, outcome}`, with `outcome` `null` while held.

H02. `transport.injectFrame(kind)` sends one frame to every open, subscribed and not-closing stream connection and returns how many got it.
- `kind` is `malformed` (the text `{`), `binary` (4 zero bytes) or `unknown-field` (the frame from H03). Anything else throws `REVIEW_INJECT`.
- Injected frames go through the connection's ordered live queue, so they follow any live frame already queued.
- `injectFrame` never changes fixture state.

H03. `unknownFieldFrame()` is exported from `transport.mjs`. It returns the fixture's `subscriber_lagged` error frame plus `review_extra: 1`. Without the extra key the frame is valid, and the client answers it with a refresh reconnect (`p0-client.js`, the final `streamFailure("refresh", …)` of `handleWsError`), not a terminal stop. The extra key alone therefore decides the outcome.

H04. `transport.overrideNextInstance(method, path)` arms a one-shot rewrite for the next request with that exact method and path. It accepts only API mutation routes (POST or DELETE), and anything else throws `REVIEW_OVERRIDE`. Before `fixture.request`, the parsed `codebox-instance-id` header is replaced with a fresh random UUID. This models a browser that holds a stale instance identity. `summary().override` reports `{method, path, applied}`.

H05. `transport.futureNextSubscribe()` arms a one-shot rewrite of the next subscribe frame.
- If the frame parses as a JSON object, its `after_seq` is replaced by the fixture's high-water plus 1, keeping key order, before `fixture.subscribe` sees it. The fixture then produces its own `future_cursor` error, with its own `latest_available`, and its own close.
- A frame that does not parse is passed unchanged and leaves the seam armed.
- This makes the review server answer as if its retained history were behind the browser's cursor. The browser cannot cause that itself, because `refresh()` discards a stored cursor above the snapshot high-water (`p0-client.js`, the `sameStoredIdentity` check).
- `summary().future` reports `{armed, applied}`.

H06. Pins:
- Only `transport.mjs` changes. The C2 driver ran on `transport.mjs` `fcc6aba7…`, and its pin test changes in the same way as T02 did for v4–v7: it compares that name with the recorded hash as a historical pin and checks that the current file differs.
- Every other C2 pin must still equal the current file.
- The C2 driver file itself does not change.
- v4–v7 pin the pre-repair bytes (`04636827…`) and are unaffected.
- No canonical cell or earlier result changes.

## Driver

D01. `fe-review/journeys-browser.mjs` is a new file in the same shape as `conformance-browser.mjs`. It covers:
- private state and output;
- the inherited-environment refusal;
- tool version checks (Node v24.18.0, Playwright 1.63.0);
- `installFreshTrust`;
- one headless Chromium at desktop 1440×900, dark, with service workers blocked;
- the `Lifecycle` cleanup.

It reuses the harness modules unchanged and records SHA-256 for each, together with the served assets. Any mismatch with its embedded pins fails with `REVIEW_SOURCE_DRIFT`. It produces journey evidence, not canonical cells, and never writes into another run.

D02. Every journey has its own fixture, its own transport on `127.0.0.1:8443` and a fresh browser context. All actions are actual Tab and Enter keyboard actions, as in C2. The route filter is the C2 filter: only allowed same-origin paths continue, and any other WebSocket URL is closed. The stream itself is not routed, so the browser's own WebSocket talks to the transport over private TLS. Interception only continues, or delays `continue()`, without changing the request. It never uses `route.fetch()`, which would need `ignoreHTTPSErrors`, `route.fulfill()`, or header access. Every journey uses the same trusted key and certificate from `installFreshTrust`.

D03. Every journey records, each request and frame labelled with the journey phase in which it occurred (a phase that begins when a response arrives is switched in the response handler itself):
- browser requests: method, path, and the phase in which each was sent;
- browser response statuses, by method and path;
- WebSocket frames, reduced by the verdict module's `journeyFrame` to type, error code and numeric fields. A binary payload is recorded as `BINARY` and text that does not parse as `UNPARSEABLE`;
- fixture counts per route;
- the transport's upgrade and rejection counts, and the browser WebSocket close events with their phase. In every "no upgrade" window an attempt is an accepted or a refused upgrade, because after a restart, expiry or logout an attempt is refused with 401 and would not count as an accepted upgrade;
- the DOM measure (`measureDOM`);
- the sequence of `#error-message` texts, from a context init script with a `MutationObserver` (at most 64 entries, consecutive duplicates dropped). These are the client's fixed messages. A successful stream reconnect clears the error on `replay_end` (`p0-client.js`, `state.error = ""` in the `replay_end` branch). So a journey that reconnects checks that its message appeared in this sequence and that the final text is empty;
- health: page errors, request failures and warning or error console messages.

Raw headers, bodies, cookies, bearer values, prompts and frame payloads are not recorded.

D04. Health is a pass condition of every journey part. There must be no page errors and no request failures, except those the journey names. Every warning or error console message must be `Failed to load resource` naming either a status the journey expects (each context's initial 401 before authentication, J02's 401 and 409) or the request failure it names. The number of such messages may not exceed the number of those expected responses and failures.

D05. Canary scan. At the end of each journey the driver checks the following for the journey's bearer, the synthetic prompt text and the cookie value: visible DOM text, input values, every `sessionStorage` value, console text and the journey's public row. The cookie value is read in memory from the context and is never stored. A hit fails the journey with `REVIEW_CANARY` and records only which source hit.

D06. Failure isolation. A journey that throws records its safe failure reason, counts as failed, and closes its own context and transport. The run then continues with the next journey, so one failure does not lose the evidence of the others. Cancellation and the deadline stay fatal, and nothing is retried.

### J01 — stored cursor and future cursor (N01)

Part a, stored cursor above the high-water (scenario `authenticated-ready`):
1. Authenticate.
2. Submit one turn (`Synthetic J01 prompt`).
3. Wait until the stored cursor holds `event_seq` 2.
4. With page script, rewrite the stored cursor's `event_seq` to 50, keeping its schema and identity.
5. Reload, and wait for `connected`.

Pass when:
- the first subscribe after the reload has `after_seq` equal to the fixture high-water (2);
- no error frame is received after the reload;
- every browser request after the submit is a GET;
- the browser sent one `POST /session/turns`, and the fixture's `turnStarts` is 1.

Part b, `future_cursor` handling (scenario `authenticated-ready`):
1. Authenticate.
2. Submit one turn.
3. Wait until the stored cursor holds `event_seq` 2.
4. Arm `futureNextSubscribe()` (H05).
5. Press Refresh by keyboard, which closes the stream and subscribes again.

Pass when:
- exactly one `future_cursor` error frame is received, with `latest_available` 2;
- the next subscribe after it has `after_seq` 2, the snapshot high-water;
- the stream returns to `connected`;
- `Current state changed; status was refreshed.` appears in the error sequence, and the final error text is empty;
- the stored cursor afterwards holds `event_seq` 2, not 3;
- every browser request after the submit is a GET, and `turnStarts` is 1.

### J02 — restart, 401 and stale instance (N02, N06 instance)

Part a, restart (scenario `authenticated-ready`):
1. Authenticate and wait for `connected`.
2. Close the transport. `close()` terminates its stream without a close frame, so the browser sees an abnormal close. The driver records the browser's close event and does not claim 1012.
3. Start a new fixture and transport on the same port with the same trusted key and certificate, but a new bearer, identity and session table. That is a restarted control plane: the browser's cookie is unknown to it.
   - From step 2 until the new transport is listening, the route delays `continue()` for same-origin requests, so the reconnect cannot reach a closed port. It never answers or aborts them.
   - The delay is capped at 5 s; past that the journey fails with `REVIEW_RESTART_GATE`.
4. Wait until the Authenticate heading is visible.

Pass when:
- the browser's first request after the restart is `GET /session`, and it gets 401 from the new fixture;
- the UI shows the Authenticate heading with the bearer field empty;
- no cursor remains in `sessionStorage`;
- no POST is sent after the restart;
- the new fixture's `effects` and `turnStarts` are 0;
- during 6 s after the Authenticate heading appears, no stream upgrade reaches the new transport.

Part b, stale instance (scenario `authenticated-ready`):
1. Authenticate and wait for `connected`.
2. Submit one turn. It is admitted, and the high-water becomes 2.
3. Arm `overrideNextInstance('POST', '/api/p0/v1/session/cancel')` (H04).
4. Press Cancel turn by keyboard.

Pass when:
- the seam reports `applied`, and the browser's one `POST /session/cancel` got 409. If the override was not applied, the journey fails with `REVIEW_OVERRIDE_NOT_APPLIED`;
- the fixture's `effects` and `turnStarts` are unchanged by the cancel, and the session status still shows `running`;
- every later browser request is a GET (the resync refresh);
- the next subscribe after the 409 has `after_seq` equal to the fixture high-water, which is greater than 0. That shows the snapshot high-water is adopted, not a retry from zero (R06);
- `Current state changed; status was refreshed.` appears in the error sequence, the stream returns to `connected`, and the final error text is empty;
- during 6 s afterwards, no further POST is sent.

### J03 — actual 15-second timeout after admission (N03, R06)

Scenario `authenticated-ready`:
1. Authenticate and wait for `connected`.
2. Arm `holdNextResponse('POST', '/api/p0/v1/session/turns')`.
3. Submit one turn. The fixture admits it, and the transport holds the 202.
4. Wait for that request to fail in the browser.

Pass when:
- the time from just before the Enter press to the browser `requestfailed` event is at least 15 000 ms. The client starts its timer before `fetch`, so the browser `request` event can trail it by a few milliseconds;
- the time from the browser `request` event to `requestfailed` is at most 17 000 ms;
- the held response has status 202 and outcome `client-closed`;
- the fixture turn count is 1, and the browser sent exactly one `POST /session/turns`;
- every browser request after the failure is a GET;
- `The request could not be completed safely.` appears in the error sequence after the failure, and the final error text is empty once the stream is `connected` again;
- the refreshed session status shows the admitted turn as `running`;
- during 6 s afterwards, no further POST is sent.

The 15-second timer is the client's own `HTTP_TIMEOUT_MS`; nothing shortens it. The driver waits for the failure with an explicit 20 s timeout, not the 8 s default. The single expected request failure is the aborted turn POST, and health excludes only that one.

### J04 — server-to-client invalid frames (N04)

Three parts, each with a fresh scenario `authenticated-ready` and its own context: `malformed`, `binary` and `unknown-field` (H02, H03). The review transport sends the frame over the real WSS connection.

Steps:
1. Authenticate and wait for `connected`.
2. Call `injectFrame(kind)`, which must return 1.
3. Wait for the error text `The session stream returned an invalid frame.`.
4. Observe for 6 s.
5. Press Refresh by keyboard and wait for `connected`.

Pass when:
- during the 6 s no new stream upgrade reaches the transport (protocol error stops automatic reconnect);
- after the keyboard Refresh, exactly one new upgrade and exactly one subscribe follow, and the stream is `connected`;
- the browser sent no mutation after authentication, and the fixture's `effects` and `turnStarts` are unchanged since authentication (the bootstrap is the one effect).

The pass also requires that the browser received exactly one frame of the injected kind.

What J04 shows, and what it does not. After the protocol error the client calls `socket.close(1008, "")` (`p0-client.js`, `streamFailure`). The WebSocket API accepts only 1000 or 3000–4999 from a page and otherwise throws `InvalidAccessError`, which the client's try/catch swallows. Reading the source therefore suggests that in a browser the client leaves the socket open after a failure it detects itself. The unit tests' fake WebSocket accepts 1008, so they cannot show this. This is a source inference, not an observed result. J04 records, without judging, whether the browser socket closed before the manual Refresh and how many transport clients remained.
- If the socket stayed open, "no upgrade in 6 s" shows that the client did not reconnect and stayed failed. It does not distinguish the terminal policy from the refresh policy, because neither one reconnects without a close event.
- The driver then reports a product finding: a failure that the client itself detects under the refresh policy (for example a sequence gap that the server does not close) would not reconnect.

Under the stop conditions, the finding is reported and no gate changes. The product client stays unchanged in this unit. The pure test checks that the `unknown-field` frame minus its extra key deep-equals the fixture's valid lag frame.

### J05 — cookie expiry (N06 cookie)

The fixture is created with `now: () => performance.now() + skew`, using the existing `now` parameter. Scenario `authenticated-ready`:
1. Authenticate and wait for `connected`.
2. Set `skew` to 300 001 ms.

Pass when:
- within 2 s the browser receives one `authentication_expired` error frame, from the transport's 250 ms validity check;
- the UI shows the Authenticate heading with `Authentication is required.` and an empty bearer field;
- no cursor remains in `sessionStorage`;
- no request or upgrade is sent during 6 s afterwards;
- the fixture's `effects` and `turnStarts` are unchanged since authentication.

### J06 — logout cleanup, dispose and a late response (N07)

Part a, logout (scenario `success-diff`):
1. Authenticate, submit one turn, complete it (`fixture.complete()`), Refresh and Show diff by keyboard, as in C2 R07.
2. Press Logout by keyboard.

Pass when:
- the browser sent exactly one `DELETE /operator/session`, and it got 204;
- within 1 s the transport has no open stream;
- the UI shows the Authenticate heading;
- the bearer, prompt and diff are empty, there are no events, and the device text is absent;
- no cursor remains in `sessionStorage`;
- during 6 s afterwards, no request or upgrade is sent.

Part b, dispose with a late response (scenario `authenticated-ready`):
1. Authenticate and wait for `connected`.
2. Arm `holdNextResponse('GET', '/api/p0/v1/session')`.
3. Press Refresh by keyboard, and wait until the transport holds that GET.
4. In the live page, dispatch a synthetic `pagehide` event on `window` (page script only). The app's `pagehide` listener disposes the controller, which aborts the in-flight GET.
5. Observe for 6 s.
6. Reload, and wait for `connected`.

Pass when:
- within 1 s of the `pagehide`, the hold records `client-closed` and the browser records exactly one request failure, for that `GET /session`;
- the transport then has no open stream;
- during the 6 s there is no request (including no `GET /login`) and no upgrade;
- after the `pagehide` the events and diff are cleared (`No retained activity in this tab.`, `No diff loaded.`);
- after the reload the page reaches `connected` from its own `GET /session`, with no error text;
- the browser sent no mutation after authentication;
- there are no page errors.

The pass would fail if `pagehide` no longer disposed the controller, because the held GET would stay open, so the hold would not record `client-closed` within 1 s and the browser would record no request failure. The stream is already closed by `refresh()` before the held GET, so `openStreams` alone does not discriminate.

## Verdicts and tests

V01. `fe-review/journeys-browser-verdicts.mjs` is pure. It holds one verdict function per journey part, which computes every pass or fail from the recorded row. It also holds the health verdict (D04), the canary scan and `journeyFrame`.

V02a. `fe-review/conformance-transport.node.mjs` adds `review_transport_journey_seams_are_bounded_and_one_shot`, which runs over the real loopback transport. It covers:
- H01:
  - a held response is admitted but not written;
  - a client close records `client-closed`, and nothing is written afterwards;
  - `releaseHeld()` writes exactly the fixture response, and throws when nothing is held;
  - the 20 s cap is a named constant checked by inspection;
  - a static asset, an unknown route and a second hold throw `REVIEW_HOLD`.
- H02 and H03:
  - each injected kind reaches a subscribed Node WebSocket client and leaves fixture counts unchanged;
  - an unknown kind throws `REVIEW_INJECT`;
  - the H03 frame minus its extra key deep-equals the fixture's lag frame.
- H04: the next matching mutation gets 409 `instance_changed` with no effect, the one after it is accepted, and a GET or unknown route throws `REVIEW_OVERRIDE`.
- H05: the next subscribe gets the fixture's `future_cursor` with its high-water and the fixture's close, and the next subscribe after that is accepted.
- No seam is armed by default.

Each part of it is shown meaningful by a mutation check.

V02. `fe-review/journeys-browser.node.mjs`:
- for each verdict function, one passing row and one failing row for each pass condition;
- `journeyFrame` for binary, unparseable and each text frame type;
- the canary scan over each source;
- the driver's source pins equal the current harness files;
- the C2 pin test follows H06;
- the driver uses no `route.fetch`, `route.fulfill`, `.body()`, `postData`, `headers()` or `allHeaders(`.

No browser runs in this suite.

## Runtime boundary (`journeys-001`)

- One start, at most 300 seconds including cleanup. The driver's internal deadline is 200 seconds; the launcher allows the container run 225 seconds and stops itself at 295 seconds. The estimate is about 120–130 s: about 70 s of waits (J03's 15 s and nine 6 s windows), plus about 45 s for 12 contexts, plus trust and launch.
- The container setup is the same as C2:
  - pinned image `fe-review-trust-terminal:20261024`;
  - `--network none`, `--cap-drop ALL` and `no-new-privileges`;
  - the worktree mounted read-only, the Playwright 1.63.0 tools and browser cache read-only, and private `/state` and `/output`.
- Command: `node fe-review/journeys-browser.mjs` in `platform/fanzloud`.
- A private launcher, modelled on the C2 launcher, checks the frozen source hashes and its own hash, a runtime approval receipt (`APPROVE_ONE`, no retry, 300 seconds) and a started marker created exclusively. It removes the container and proves it absent.
- Every listener is closed, and port 8443 is proven absent, before `result.json` is written.
- Stop conditions:
  - A FAIL is preserved, not retried and not renamed.
  - A product defect is reported as a finding, and gates do not change.
- An independent actual review judges the result before it is recorded as evidence.

## `journeys-001` result (2026-10-29)

`journeys-001` passed. It ran once on source `df10a299` (merged as `ab4ebac2`) in 80.4 s, with Node v24.18.0, Playwright 1.63.0 and Chromium 153.0.8010.12. All 11 verdicts are true: `j01_stored`, `j01_future`, `j02_restart`, `j02_instance`, `j03_timeout`, `j04_malformed`, `j04_binary`, `j04_unknown-field`, `j05_expiry`, `j06_logout` and `j06_dispose`. Every journey's health verdict passed and its canary scan was empty. Cleanup closed all 24 resources, port 8443 was absent, and the container was removed.

The independent actual review re-derived every verdict from the recorded rows and accepted the run with findings. Key values:
- J03: the client failed the turn 15,009 ms after the press and 15,007 ms after the request; the held `202` was never delivered and nothing was resent.
- J05: the expiry frame arrived 253 ms after the clock skew.
- J06b: the held `GET /session` was aborted 28 ms after `pagehide`.

Product finding (not a gate): in all three J04 parts the client's socket stayed open after the client detected the invalid frame itself (`socketClosedBeforeRefresh` false, one transport client) until the manual Refresh. Closes from `refresh()` were observed within about 16 ms in the same run, so a close is observable when it happens. The likely cause is `socket.close(1008, "")` in `p0-client.js`, which browsers reject for page code; this is a source inference, not observed. Possible impact (inferred, not observed): a failure under the refresh policy that only the client detects would not reconnect, and the server would keep a subscriber the client no longer reads. The product client is unchanged in T-0433.

Recorded limitations:
- `j06_logout`: the DOM record was overwritten after the verdict, so diff, events and device clearing are attested by the pinned verdict only, not by the stored rows.
- J01a: `after_seq` equal to the high-water cannot tell a clamped cursor from a rewrite that never applied; N01 also rests on J01b and C2 R06.
- J03: the resync `GET /session` was labelled `submit` because `requestfailed` arrived 5 ms after it, and the mutation-after-failure check covers only the after-failure and window phases, so the verdict is weaker than the spec; the raw rows show no mutation.
- J06b shows abort on dispose, not handling of a response that arrives after dispose; that part of N07 rests on the R09 partition tests.
- The canary scan ran before `transport`, `fixture`, `healthVerdict`, `tools`, `cleanup` and `sourceHashes` were written; the review inspected those fields and found only numbers, booleans and fixed names.
- The evidence comes from a synthetic fixture with one headless Chromium.

The private result, receipts and actual review are backed up with SHA256SUMS in `t0433-journeys-20261029T114943Z`; the launcher log `journeys-001.log` (one summary line) is not in the backup.

## Acceptance

- Each verdict function fails on its failing rows and passes on its passing rows.
- All fe-review suites pass, with and without `REVIEW_MODULES` and `FE_REVIEW_RUNS`. T006 passes 10/10.
- Independent review and required CI pass before merge.
- `journeys-001` then runs once, after its own approval. Its result and review go into a follow-up PR. Done: see the `journeys-001` result above.
- After that, the T0433-3 integration report maps N01–N09 from the table above to the actual receipts.
