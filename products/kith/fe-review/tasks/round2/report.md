STATUS: PARTIAL

## Summary

T-0380 R2-AC-1 / R2-AC-E: implemented DESIGN M1–M4 review tooling, anonymous/authenticated targets and operating documentation. Actual isolated worker/D1 migrations, base-v1 seed, fake provider, Vite and UI login succeeded. Existing product, worker, e2e, dependency versions and dev-bind code were not changed. targets is now dated verified=true for M1–M4 only; independent focused review and PR delivery remain pending. This is not round3 or product-mainline acceptance.

Source checkout: `044e45f571334149c01337f4812b32a4fe84a457`, with the documented review changes uncommitted during verification. Node24.18.0, npm11.16.0, Playwright1.56.1, Chromium141.0.7390.37/build1194, Wrangler4.135.0, Vite6.4.3. Linux container, uid1000, Docker network=none, cap-drop ALL, no-new-privileges, fresh image-owned home, shared read-only Node/browser mounts and shared npm cache. No host HOME, production credential or Docker socket mount. Final runtime image `sha256:e0b706e36cf161e5e4a720e55f093206bbbf7981fed7828b69cc9a6db6e8bffe` contains Git2.39.5 and browser libraries.

## Verification

| Command / evidence | Observed result |
| --- | --- |
| `npm ci --prefix products/kith --no-audit --no-fund` and corresponding web/e2e lockfile installs | exit0; no lockfile change |
| `products/kith/e2e/node_modules/.bin/playwright install chromium` | exit0; pinned build1194 installed in shared cache. Host-library warning retained; execution used the browser-capable container. |
| `node --test products/kith/fe-review/review.test.mjs` | 3 passed. Initial RED was missing new helper implementation (module-not-found), not a claimed pre-existing product regression. Helpers now live in import-safe launch.mjs. |
| `node --check products/kith/fe-review/launch.mjs` and `node --check products/kith/fe-review/flows.mjs` | exit0 |
| `npm --prefix products/kith/e2e run lint` | exit0 |
| `npm --prefix products/kith run lint` | exit0 |
| `npm --prefix products/kith/web run build` | exit0; 2 reading and 5 timeline tests, TypeScript and Vite build pass. Existing >500kB chunk warning retained. |
| `npm --prefix products/kith test` inside offline container | 293 tests through m7 passed; final reading stage failed because Git was absent in the first image. Not reported as whole-command PASS. |
| `npm --prefix products/kith run test:reading` in image with Git | exit0, 37 passed; previously passed stages were not repeated. |
| `node products/kith/fe-review/launch.mjs` in isolated container | migrations/seed/worker/fake/Vite/login PASS; ss showed every listener bound127.0.0.1. state0700, env/session/observed/context files0600. |
| Actual CLI negative checks | Host network rejected before children; concurrent launcher rejected with EEXIST while existing owner continued. |
| `node products/kith/fe-review/flows.mjs` | corrected ready-selector run exit0, 96 captures across3viewports×2schemes; login/message/stream completion/thread/history/8console views/offline assertions passed. |
| `node docs/fe-review/capture.mjs products/kith/fe-review/targets.json --dry-run` | exit0;1anonymous+14authenticated pages |
| `PLAYWRIGHT_MODULE=.../playwright/index.mjs node docs/fe-review/capture.mjs products/kith/fe-review/targets.json --out products/kith/fe-review/runs/static-20261024-b` | exit0;90 records, allHTTP200; no record error/pageerror/horizontal overflow. Optional axe was unavailable; not an a11y PASS. |
| Graceful SIGTERM cleanup | Both successful launch containers exited0; owned cleanup receipt written and lock removed. No unrelated process/container was stopped. |
| Artifact scan / `git diff --check` |8public JSON artifacts passed existing known-fixture/provider/observed-session secret scan; whitespace check exit0. |
| Existing `npm --prefix products/kith run e2e` | exit1 after7.9minutes:57passed,1existing desktop-only skip,2PT-01 path-preflight failures (desktop/mobile). The one authorized external-private-state PT-01 diagnostic then passed both cases (exit0,1.8minutes); prior full-suite FAIL is retained. |

Final interactive evidence: [flows.json](../../runs/20261024T060301973Z-594ccb9f-375b-4b7b-a0ab-8525a26734ca/flows.json), [cleanup.json](../../runs/20261024T060301973Z-594ccb9f-375b-4b7b-a0ab-8525a26734ca/cleanup.json). Static evidence: [capture.json](../../runs/static-20261024-b/capture.json). PNGs are intentionally ignored. The earlier successful matrix is retained under runs/20261024T055718246Z-3f41ff45-0318-4e63-8791-603411d1069b but its console waits used only app-shell; use the corrected matrix above for loaded console content.

The final artifact-directory exclusivity guard was added after the corrected96capture run; its positive fresh-directory unit contract and actual refusal to overwrite the existing live-run evidence passed. The entire96matrix was not repeated after that guard-only change. Functional assertions are not browser-health acceptance: corrected matrix has0pageerrors/overflow but17console entries and252failed-request entries in78records. All6login and6home captures have401-related console output;5intentional offline captures have WebSocket failures. Many remaining requests report ERR_ABORTED during React/navigation lifecycles; those are retained and not globally suppressed or silently classified as harmless.

## Documentation

SUCCESS was updated with scope/AC/verification plan before implementation; mainline incomplete and AC-04 pending are unchanged. PROMPT documents the isolated two-process workflow, pinned toolchain, one launcher shared by both target apps, fresh state, shared caches, private storage, cleanup and artifact limits. REVIEW stays in_progress. launch.mjs owns only its process groups and imported fake provider, scrubs ambient environment, bypasses developer .dev.vars via an explicit fresh env file and rejects ambient Vite .env files. flows.mjs uses existing real UI/API contracts and fails before overwriting prior evidence; it never starts a real provider or sidecar.

## Risks and Follow-ups

- Original image uid lacked a passwd/home entry; migration startup failed with os.homedir ENOENT. Parent repaired image-only prerequisite; successful fresh runs followed. Initial failure log and cleanup receipt are retained.
- Initial capture module-directory import failed; corrected to installed ESM index.mjs. No common capture code was changed.
- Existing e2e initially failed before tests because its .git pointer uses the canonical common directory, not the repos alias. Parent independently preflighted and authorized one corrected read-only canonical mount; that run is the current60test suite.
- PT-01 initially failed `Private trial check failed (paths)` at reading/trial.ts:137, invoked by reading-private-trial.spec.ts:80. Existing trial.ts:111 rejects private release/token paths inside the application checkout. The review's initial KITH_E2E_ARTIFACTS_ROOT was inside ignored fe-review state, which conflicts with that existing invariant. This is not evidence of a launcher regression. No reading/e2e code or safety check was changed. After the full suite finished, the one authorized targeted `npm --prefix products/kith run e2e -- --grep E2E-PT-01` run used genuinely external0700private state and passed desktop44.9s/mobile44.6s (2passed,1.8minutes,exit0). This isolates the original failures to the validation artifact-root prerequisite; it does not rewrite the full-suite exit1 into PASS. All59applicable cases now have passing evidence, plus the existing desktop-only skip. The original two failures and exact stack remain retained.
- Browser-health findings and missing axe remain visible. No runtime/container remains running after the targeted --rm container completed. Source/design M1–M4 does not authorize product frontend fixes for newly observed findings. Independent review, required CI, publication and final target verification remain parent-owned; no commit/push/merge was performed here.
- Private raw test logs/traces/storage remain git-ignored. Preserve needed ignored screenshots/logs before removing the worktree; only reviewed, secret-scanned summaries/JSON may enter publication.

Worker accounting: start observation2026-10-24T05:51:22Z; final report snapshot2026-10-24T06:18:32Z;10minute progress sent; first20minute checkpoint and parent-authorized10minute follow-up recorded in session. Active/wait/provider/tokens/cost totals unknown, not inferred from tool count. Two local diagnostic corrections plus explicitly authorized canonical-mount follow-up are enumerated above; no recursive agents.

Source fingerprints at report snapshot:
- `launch.mjs` SHA-256 `7c9b7519afe7125b3ee8c14dda6bbccca29a0e3be4db5d97bb89da77af204686`
- `flows.mjs` SHA-256 `5904c7d8bbeafe468050cf317457112156d4d97212256d9093ac62404e6ece85`
- `review.test.mjs` SHA-256 `23dae4bab552825d54019110439dab92e2aa15921db60d69bf0d1e36de7bc846`
- `targets.json` SHA-256 `aa03485a592bd417f38a88ecf50cbc6cfe792d08337164429fcdb90ef3531000`

## R4 evidence-attribution correction

The initial native293 and root/e2e lint/web-build output was retained in conversation tool returns, not saved as original raw stdout. `native-session-observations.json` is an explicit compact transcription naming sessions/chunks, commands, observed counts and limitations. Native293 success is supported by per-stage PASS counts and the package's && chain; the whole native command exited1 on the later missing-Git reading stage. The type/build batch exited0 and displayed no root/e2e lint errors, but their individual statuses were not separately captured because those three commands were newline-separated. Earlier standalone exit0 wording for those two lint commands was too strong; no raw log or standalone status is fabricated. Web build was the final successful command with7explicit tests and its internal && type-check chain. No passing gate was rerun for this attribution correction.

## R4 focused follow-up — 2026-10-24T06:25:29Z

Two review-only gaps were corrected without modifying product code. The first harness imports now execute inside the lock-protected try/catch, with cleanup installed before any awaited import. Cleanup attempts every owned resource and retains the lock if cleanup itself fails; no successful cleanup receipt is written on that failure.

RED: the actual CLI copied into a minimal isolated fixture with no e2e modules exited1 and left its lock; the focused suite showed3PASS/1FAIL (`failed import must release owned lock`, true!==false). GREEN: the final standalone namespace command `node --test products/kith/fe-review/review.test.mjs` exited0 with4PASS (tool chunk ae1985). The fourth test requires the isolated network namespace and does not launch a worker/provider/browser.

`node products/kith/fe-review/route-smoke.mjs` exited0 on a fresh real stack. All15configured routes had HTTP200, exact finalURL=requestedURL and a route-specific loaded-content assertion; authenticated pages used the actual configured storageState and had no login form. Room routes additionally matched the exact seeded title. This covers quiet/private/settings/not-found, which were not established by the original interactive matrix. Evidence: [route-smoke.json](../../runs/20261024T062130819Z-51cc897c-2fbd-4f99-bffa-d419997cee51/route-smoke.json), [cleanup.json](../../runs/20261024T062130819Z-51cc897c-2fbd-4f99-bffa-d419997cee51/cleanup.json), [focused record](r4-focused.json). The new stack stopped gracefully, exited0 and removed its lock.

The original90capture record stored requested URLs only; it remains historical evidence and is not retroactively described as redirect proof. The96matrix and full e2e were not rerun. Original PARTIAL, R3 browser-health findings and unrun axe remain visible; targets staysfalse. Current follow-up source hashes are in r4-focused.json and supersede the earlier source snapshot for these files. Historical lint-exit attribution remains as corrected above; parent owns that final evidence check.


## Root evidence gate and delivery candidate

Root inspected source, actual manifests and R4 findings. Both R4 implementation gaps have focused corrections and evidence above; no product/web/e2e source changed. Root also ran `set -e` followed by `npm --prefix products/kith run lint` and `npm --prefix products/kith/e2e run lint`: both exit0 (session46809). This closes the earlier individually-uncaptured lint exit gap; it is not a repeat of the whole green suite. Root `python3 scripts/check_project_success.py`, `python3 scripts/check_indexes.py`, and `python3 -m unittest discover -s scripts/tests -v` passed42contracts/index/20tests.

Targets metadata is promoted for actually verified M1–M4 only. R4 distinguishes R2 from the separate Round3 health/axe gate; original401/offline/cancellation records and axe-unrun stay visible. Required CI, normal merge and remote readback are still pending, so this delivery report remains PARTIAL until recorded. Overall T0380/T0379 remain in_progress. No release/deploy or product-mainline acceptance.
