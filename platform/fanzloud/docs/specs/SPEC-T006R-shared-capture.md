# Shared capture gate R11 (`capture-001`)

Status: **specified; wrapper and tests in this change; no run.** Owner direction on 2026-10-29 (「按你推薦做吧。」), accepting option A of the T0433-3 R11 gap: add one bounded run of the unchanged shared `docs/fe-review/capture.mjs` against private targets. Desk T-0433 (issue 706), R2-AC-14 and R2-AC-E. The run, `capture-001`, needs its own owner runtime approval after independent review and required CI pass.

Basis:
- [SPEC-T006R](SPEC-T006R-fe-review.md) R11: the runner owns startup, auth, fixture and trust, writes private targets, then runs the unchanged `docs/fe-review/capture.mjs <private-targets> --dry-run` and an actual initial static capture through a browser that keeps genuine TLS validation. The shared static capture never replaces the dedicated canonical states.
- [ROUND2-SDD](../../../../docs/fe-review/ROUND2-SDD.md): `targets.json` may become `verified=true` only when targets match the runtime and the row's full conditions hold.
- The T0433-3 inventory: none of the canonical, C2 or `journeys-001` runs used `capture.mjs`, and `targets.json` still named port 18443.

## Scope

In scope:
- `fe-review/targets.json` names the review origin `https://127.0.0.1:8443`, the only product page `/`, dark, `en-US`, and no `start`. It stays `verified:false` until `capture-001` passes and is reviewed.
- A wrapper, `fe-review/shared-capture.mjs`, that serves the fixture and transport, installs the fresh trust, copies `targets.json` byte for byte to private state, and runs `capture.mjs` twice as a child process: `--dry-run`, then the capture.
- Pure verdicts in `fe-review/shared-capture-verdicts.mjs` and their tests.
- One review-only counter in `fe-review/transport.mjs` (W08). The `journeys-001` driver stays pinned to the transport bytes it ran on (`9167d04e…`); its test checks that pin as historical.
- `fe-review/.gitignore` keeps `runs/*/capture/` (the shared script's `capture.json` and screenshots) out of git.

Out of scope:
- Any change to `docs/fe-review/capture.mjs`, the product client or the fixture, and any transport change beyond W08.
- Authenticated or other canonical states. They stay with the dedicated canonical driver (27/27 on v7).
- Real backend, Cloud or provider integration.

## Wrapper (W01–W07)

W01 — Preconditions: the same as the dedicated drivers. UID 1000, HOME `/home/ubuntu`, no inherited `CODEBOX_*`, `CODEX_*`, `OPENAI_*` or `ANTHROPIC_*` variables, a fresh private `/state`, and an empty private `/output`. Source pins (`REVIEW_SOURCE_DRIFT`) cover `fixture.mjs`, `transport.mjs`, `lifecycle.mjs`, `trust.mjs`, `shared-capture-verdicts.mjs`, `journeys-browser-verdicts.mjs` (for its canary scan), `targets.json`, the shared `docs/fe-review/capture.mjs` and the four product assets. Node v24.18.0 and Playwright 1.63.0 are checked before anything starts.

W02 — Trust: `installFreshTrust` creates the CA for this run and adds it to the container HOME NSS database. The browser that `capture.mjs` launches reads the same HOME, so it trusts the review certificate through normal validation; nothing passes `ignoreHTTPSErrors` or turns off certificate checks.

W03 — Service: one fixture in the `bootstrap-empty` scenario and one review transport on `127.0.0.1:8443`, registered with the lifecycle before any await. The wrapper starts no browser of its own.

W04 — Private targets: the wrapper reads `fe-review/targets.json`, checks it matches the runtime (project `fanzloud`, one app `control-plane`, `baseUrl` equal to the review origin, one page `home` at `/`, `colorSchemes` `["dark"]`, locale `en-US`, no `start`, no `storageState`, no `viewports`), and writes the same bytes to `/state/targets.json` (mode 0600). `capture.mjs` therefore uses its default viewports: desktop 1440×900, tablet 834×1112 and mobile 390×844, the canonical sizes.

W05 — Children: each child is `node /work/docs/fe-review/capture.mjs /state/targets.json … --out /output/capture`, started without a shell, from `/work`, with only `PATH`, `HOME`, `PLAYWRIGHT_MODULE`, `AXE_PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE` in its environment. Playwright 1.63 adds `--no-sandbox` itself unless `chromiumSandbox: true` is passed, which `capture.mjs` does not do; the container's `--cap-drop ALL` therefore does not need a script change. Output is read with a 64 KiB byte cap per stream. A spawn error settles the child at once instead of waiting for the deadline. Output lines are compared exactly: the text ends with one newline and has no blank line.
- Dry run: limit 10 s. Its stdout must be exactly the three plan lines (`control-plane: https://127.0.0.1:8443 (1 pages) start=undefined`, `  - home: /`, `out: /output/capture`), stderr empty, exit 0, and `/output/capture` must not exist afterwards.
- Capture: limit 90 s. Exit 0, stderr empty, stdout `ok` lines for desktop, tablet and mobile in that order, then one `wrote …/capture.json` line, and no `FAIL` line.

W06 — Safe receipt: `result.json` (private, 0600) records the plan and capture verdicts, the child exit codes and stdout lines, the first 2 KiB of any stderr for diagnosis, the `capture.json` summary (counts of console errors, page errors and failed requests, not their text), each screenshot's sha256 and PNG width and height, the transport and fixture counters, the canary result and cleanup. The screenshots stay private under `/output/capture/screenshots`.

W07 — Cleanup and deadline: the internal deadline is 150 s. The lifecycle closes the transport, the fixture is disposed, port 8443 is proven absent, and only then is `result.json` written with `wx`. A child still running at the deadline is killed with SIGKILL and recorded. SIGKILL stops the Node child; Chromium, which Playwright starts in its own process group, exits when its debugging pipe closes, and the launcher's `docker rm -f` removes anything left.

W08 — Favicon: Chromium requests `/favicon.ico` by itself. Playwright never reports that request as a request, response or failure event; the dedicated drivers never saw it because their `context.route('**/*')` aborts it before it is sent, but `capture.mjs` installs no route, so it reaches the transport, which answers 404 because the product has no favicon. The transport therefore counts `GET /favicon.ico` separately (`unknownFavicon`), still inside `unknownRequests`, and every other unknown request still fails the verdict. The receipt records the favicon count and the favicon console lines as a presentation finding, as ClarkQ's shared capture did; it is not reported as zero errors, and no favicon asset is added.

## Verdicts (V01)

`planVerdict` passes only on the exact W05 dry-run output, exit 0, empty stderr and no output folder.

`captureVerdict` passes only when:
- the child exited 0 with empty stderr, three `ok` lines in viewport order, one `wrote` line and no `FAIL`;
- `capture.json` has project `fanzloud`, `axe` true and exactly three results, one each for desktop, tablet and mobile, all app `control-plane`, page `home`, scheme `dark` and URL `https://127.0.0.1:8443/`;
- every result has status 200, no `error`, title `Codebox operator`, no horizontal overflow, no page errors, and failed requests exactly `GET https://127.0.0.1:8443/api/p0/v1/session HTTP 401`. Its console errors, in any order, are exactly the bootstrap line `[error] Failed to load resource: the server responded with a status of 401 (Unauthorized)`, optionally plus one favicon line `[error] Failed to load resource: the server responded with a status of 404 (Not Found)` (W08);
- the desktop result has `axeViolations` with no `critical` or `serious` entry; `capture.mjs` runs axe on the first viewport only, so tablet and mobile have none;
- each screenshot exists, is a PNG whose width equals its viewport width and whose height is at least the viewport height;
- with `f` the transport's favicon count (0 to 3): the transport saw exactly `15 + f` requests (three contexts × the page, three assets and one `GET /session`, plus the favicon requests), exactly `f` unknown requests, no upgrade and no refused upgrade, and the favicon console lines across all results are at most `f`. The fixture counts are exactly `GET /api/p0/v1/session: 3` with no effects and no turn starts.

The canary scan covers the dry-run and capture stdout and stderr and `capture.json`, with the fixture bearer as the secret; the bearer is never sent to the browser, so any hit is a failure.

`passed` requires both verdicts, the canary, complete cleanup and port 8443 absent.

## Tests

- A failing row for each verdict condition, a passing row, and passing rows with one and with three favicon requests.
- A real loopback oracle (`review_transport_counts_favicon_separately_from_other_unknown_requests`): only `GET /favicon.ico` raises the favicon count; `HEAD`, `POST`, a query string and another path stay plain unknown requests, and all are 404.
- Static checks on the wrapper: no `ignoreHTTPSErrors`, no `shell: true`, no `exec(`/`execSync(`, no `route(`, no `screenshot(`, no `runs/` path, `capture.mjs` called only through its fixed path, and the pinned hashes equal the files.
- `targets.json` matches W04.

## Runtime boundary (`capture-001`)

- One start, at most 300 seconds including cleanup. The wrapper's deadline is 150 s; the estimate is under 30 s.
- The container setup is the same as `journeys-001`: pinned image `fe-review-trust-terminal:20261024`, `--network none`, `--cap-drop ALL`, `no-new-privileges`, `--shm-size 1g`, the worktree, the Playwright 1.63.0 tools and the browser cache read-only, and private `/state` and `/output`.
- Command: `node fe-review/shared-capture.mjs` in `platform/fanzloud`.
- A private launcher modelled on `launch-journeys-001.py` checks the frozen source hashes, its own hash, a runtime approval receipt (`APPROVE_ONE`, no retry, 300 seconds) and an exclusive started marker; it removes the container and proves it absent.
- Stop conditions: a FAIL is preserved, not retried and not renamed; a product or shared-script defect is reported as a finding and gates do not change.
- An independent actual review judges the result before it is recorded as evidence. Only after that may `targets.json` become `verified:true`.

## Acceptance

- Each verdict function fails on its failing rows and passes on its passing row.
- All fe-review suites pass, with and without `REVIEW_MODULES` and `FE_REVIEW_RUNS`. T006 passes 10/10.
- Independent review and required CI pass before merge.
- `capture-001` then runs once, after its own approval. Its result and review go into a follow-up PR, and the T0433-3 report links R11 to it.

Limitations known in advance:
- The product has no favicon, so Chromium's automatic request gets a 404 with one console line; this is recorded as a presentation finding, not fixed.
- `capture.mjs` covers only the static initial page; it does not authenticate, so its three images show the bootstrap state only.
- Axe runs at desktop only in the shared script; tablet and mobile axe evidence stays with the canonical 27/27.
- The evidence comes from a synthetic fixture with one headless Chromium.
