# Phark isolated review runner

The runner is scoped to the approved R2 M1–M3 assignment. [Report](tasks/round2/report.md) and [result index](tasks/round2/result.json) distinguish successful gates, immutable failed attempts, source deltas and remaining R3 findings.

## Environment and ownership

Root launches `node products/phark/fe-review/run-review.mjs` in the prepared isolated image with network disabled, no host ports or Docker socket, dropped capabilities, read-only tool mounts, the checkout at `/work`, and a separate fresh owned0700 private state mount. Existing frontend dependencies and the parent-built unchanged Spring jar are reused; no SDK or dependency is installed by this runner.

Required variables: unique safe `FE_REVIEW_RUN_ID`, external `FE_REVIEW_STATE_DIR`, `PLAYWRIGHT_MODULE`, `AXE_MODULE`, `CHROMIUM_EXECUTABLE`. Observed Node24.18.0/Chromium153.0.8010.12, Java17/Maven3.9.16; native receipts record their actual checks. Root owns the full container invocation and positive removal proof.

Vite listens127.0.0.1:5173; Spring listens127.0.0.1:8080. Baseline-001 proved runner config loading cannot evaluate the original `__dirname`. The review-only launcher exactly mirrors original React/Tailwind plugins, @ alias and literal localhost8080 proxy, requiring original config hash49687e45d1891dee0580e4996c554abe158fa69b2de6e15ff960f9dbe0a28ef4. Product vite.config.ts is unchanged. Cache, SQLite, media, raw logs, auth storage and HMAC stay private.

## Recorded phases

- Default baseline: six browser-only mock states before real Spring; two-account API fixture and three authenticated geometry/axe measurements. This is measurement, not final acceptance.
- Historical `real-only` and `mobile-diagnostic` continuations require exact prior receipt/source hashes and do not claim skipped phases ran again.
- Shared capture uses the unchanged `docs/fe-review/capture.mjs` as an owned child against already-running servers, without `--start`. It generates actual profile handle, substantive loaded selectors and0600 storageState privately. The final accepted matrix is final-001 nine green keys plus final-002 three notification repairs; strict selection rejects duplicate/missing/unexpected keys or replacing a green key.
- Nine supplemental route guards record actual identity, geometry and all-viewport axe incomplete findings without duplicate PNGs.
- `journey-only` pins the accepted capture/source receipts and executes real keyboard actions, controlled pending500/rollback, logout and explicitly mocked paging. It does not repeat the matrix.
- Final `logout-only` pins final004's completed12steps and final003's3paging channels. It creates only one fresh account/API login, performs actual keyboard login/logout and reads the session back. It does not seed posts or repeat passed workflows/captures.

These source-pinned continuation modes preserve this review's immutable evidence. They intentionally reject unrelated source drift; a new assignment needs a new baseline, not a bypass of those checks. Static targets contain three stable routes; authenticated four-route acceptance uses generated private targets including the actual returned profile handle.

## Safety and evidence

Real fixture uses anonymous CSRF→register→login→rotated CSRF and actual IDs/cursors. Defaults retain security/quotas; real429 stops without retry or quota resets. Normal seed budget is2registrations/2logins/4posts/1reply/2social/1report, plus documented browser writes. Mock response failures are explicitly labelled.

All unique runs write safe `runs/<id>/result.json`; screenshots are ignored. Raw shared manifests/storageState/service logs/DB/media remain private. Secrets are never serialized. Public artifacts record only synthetic identifiers, allowlisted path without query, fixed outcomes and hashes. Exact local paths were redacted from two public RED logs; original bytes remain privately preserved with hash provenance.

Browser launch has explicit30s timeout, below35s cancellation settlement. Resource ownership is registered before checking cancellation. Browser close is bounded5s; cleanup stages independently continue to recorded process groups and positive listener absence. The main210s deadline leaves room for cleanup within the outer bound. Two focused asynchronous tests cover late acquisition after cancellation and stalled close/late rejection; earlier guards remain tested. No graceful-close claim is inferred solely from an exit143; actual exit and forcedKill fields remain in receipts.

Unknown console/request events fail. Same-origin GET ERR_ABORTED requires an actually observed navigation interval or completed teardown. The sole POST exception requires the exact `/api/auth/logout` Request object also observed with204, followed by session GET200/account null and signed-out UI. Final005 proves this exact chain; it does not rewrite final003's unclassified count or final004's FAIL.

No full R3, complete contrast pass, dark-theme support, deployment, durability, usable tag or owner completion is claimed.
