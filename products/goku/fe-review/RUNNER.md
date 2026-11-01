# Goku bounded R2 runner

Use Node 24.18 and the component's existing npm lock. The parent provisions
`npm ci`, then runs the original `npm run lint` and `npm run build` from `web/`.
The build is Vite only; it does not imply a TypeScript check. No test framework,
Playwright or axe dependency is added to the product.

From the component directory, focused checks are:

```sh
node fe-review/test-store.mjs
node fe-review/test-isolation.mjs
node --check fe-review/serve-web.mjs
node --check fe-review/verify-browser.mjs
```

The store check uses existing Vite SSR loading and Node assertions, with API
methods replaced only in that test process. It exercises the real store's four
failure/recovery paths, retained data and successful empty state. It closes Vite
in `finally`. Guard checks reject non-loopback origins, existing state, symlinks
and non-private state. Synthetic temporary directories belong to those tests.

The runtime owner creates a fresh private directory (0700) outside the checkout
and mounts it as `/state` in one owned container. Use network none, no published
ports, UID1000, dropped capabilities, no-new-privileges, read-only source mount. The measured container root filesystem remained writable;
no `--read-only` root-filesystem claim is made. Mount this component's
`fe-review/runs` and the owned `/state` writable. External observer modules and shared Chromium cache
are read-only. From repository root inside that environment:

```sh
export FE_REVIEW_STATE_DIR=/state
export PLAYWRIGHT_MODULE=/review-tools/node_modules/playwright/index.mjs
export AXE_PLAYWRIGHT_MODULE=/review-tools/node_modules/@axe-core/playwright/dist/index.js
export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
node products/goku/fe-review/verify-browser.mjs
```

Both modes are mandatory and use separate fresh owned state/container runs.
The default mode edits the title while retaining the original URL/local image,
then checks all failure/recovery/delete flows. In a second fresh environment run:

```sh
FE_REVIEW_EDIT_ONLY=1 node products/goku/fe-review/verify-browser.mjs
```

That mode changes the actual URL and uses CDP Fetch only for the exact loopback
`http://127.0.0.1/favicon.ico` image. It does not register Playwright routes:
Playwright 1.63 internally aborts intercepted favicon requests before user routes.
CDP request/response, fixture hit and decoded image width are required. API traffic
remains real; no browser security flags or permissions are changed.
See [pinned source diagnosis](tasks/round2/evidence/favicon-tool-diagnosis.json).

The root owner bounds the command (180 seconds initially), retains its exit/log
and removes only that named container in `finally`. The driver claims empty
state, generates two synthetic bookmarks/local image, starts json-server 0.17.4
on127.0.0.1:3001 with the existing routes file and private DB,
and starts Vite on127.0.0.1:5173. Do not run `npm run mock`, reuse the tracked mock
DB, or add external favicon fallback.

`serve-web.mjs` uses the same existing React plugin and lucide optimization
exclusion as the product Vite configuration; programmatic setup places all
cache/config work in private state. Its `/vite.svg` and `/review.svg` responses are explicitly
synthetic local image fixtures for the existing HTML reference, not a product
asset change. API traffic is real json-server HTTP. The edited URL favicon at
`http://127.0.0.1/favicon.ico` is a narrowly allowlisted image response because
existing getFaviconUrl drops custom ports. Unexpected origins fail the driver. Exact image status/content-type/bytes and
browser naturalWidth are asserted. `FE_REVIEW_SKIP_AXE=1` allows a focused
continuation to retain prior scans without rerunning them; record that boundary.

The driver verifies loaded cards at three sizes/light, scoped axe findings,
shared `capture.mjs --dry-run` and normal capture against its already-owned
servers, actual Tab focus, real edit/delete and API readback, controlled PUT/
DELETE500 failures, actual json-server termination and same-state restart with
Retry recovery, then real empty state. Controlled500 responses are not backend
fault evidence. Add-bookmark failure is store-only because no creation UI is
wired. Search/category filtering, BookmarkMenu/CoreLayout wiring, fullR3 and
Go/CLI/MQTT integration are not claimed.

Every owned process is signalled, waited for and checked for listener absence;
Vite additionally emits its close marker. json-server termination is observed
SIGTERM/process exit, not an invented graceful application hook. Raw process
logs/DB stay in private state; screenshot PNGs stay ignored. Public evidence is
limited to synthetic text, source hashes, status and classified findings.

The final mode-input split was syntax/diff checked after the measured runs. It
was not a fresh full-mode runtime: historical runtime002 proves the actual
error/recovery/delete flows (and exposed the edited favicon gap); edit002 proves
the real URL edit/image correction. Source hashes and this boundary are recorded
in [result.json](tasks/round2/result.json). Do not relabel older manifests.
