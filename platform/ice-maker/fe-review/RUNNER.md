# Ice Maker bounded review runner

Run from the repository root with Python 3.12 plus the existing
`document-ingestion` extra, Node 24, Playwright 1.63 / Chromium revision 1243,
and axe 4.13 supplied outside this component. No frontend dependency is added.

Native commands, from `platform/ice-maker`:

```sh
env -u SSH_AUTH_SOCK PATH="$PWD/.venv/bin:$PATH" make check
PYTHONPATH=src:tests .venv/bin/python -m unittest -v test_document_service test_readable_results
PYTHONPATH=src .venv/bin/python fe-review/test_fixture.py
node --check fe-review/verify-browser.mjs
```

For browser runs, provision an owned container with no network, no published
ports, UID 1000, all capabilities dropped, `no-new-privileges`, read-only root,
and writable `/tmp` (exec) and the image user's home. Mount the checkout at its
canonical path read-only, `platform/ice-maker/fe-review/runs` writable, and a new
owned private directory (mode 0700) over `runs/.state`. Never use real document
state. Mount external review modules at `/review-tools/node_modules` and the
shared browser cache at `/ms-playwright`, both read-only. Activate the prepared
component venv before invoking the driver from repository root:

```sh
export PLAYWRIGHT_MODULE=/review-tools/node_modules/playwright/index.mjs
export AXE_PLAYWRIGHT_MODULE=/review-tools/node_modules/@axe-core/playwright/dist/index.js
export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
export PYTHONDONTWRITEBYTECODE=1
. platform/ice-maker/.venv/bin/activate
node platform/ice-maker/fe-review/verify-browser.mjs
```

The driver invokes the prescribed shared commands:

```sh
node docs/fe-review/capture.mjs platform/ice-maker/fe-review/targets.json --dry-run
node docs/fe-review/capture.mjs platform/ice-maker/fe-review/targets.json --start --out <owned-run>/shared
```

It asserts 18 records, real HTTP 200, no page errors or horizontal overflow,
then waits for `serviceClosed: true` and positive listener absence. A second
fixture startup on the same synthetic state must preserve batch/source IDs.
The separate fixture test also compares two fresh states and two startups each.
The driver checks axe on all 18 combinations, then real upload/running/busy,
completion, preview and exact Markdown bytes, failed batch, and actual invalid
metadata HTTP 400. Controlled route responses cover literal error text and
polling 404/409/network/malformed data; a controlled browser clock covers the
30-minute UI-only polling cap. These supplements do not prove backend faults.

`FE_REVIEW_FLOW_ONLY=1` skips the already recorded shared/axe matrix and runs
only interaction checks against a fresh owned state. It is a focused
continuation, not another complete matrix. Adding `FE_REVIEW_COMPLETED_ONLY=1`
limits that continuation to upload/running/completed, a 1.2-second stable GET
count, exact counts and preview/Markdown. Every attempt has a unique result
and source hashes; retain earlier failures. The outer owner must bound the
container command, remove only its named container in `finally`, and record
removal. SIGTERM is accepted only with the service-close receipt, uvicorn's
shutdown-completion marker and listener absence. SIGKILL is failure.

Only synthetic JSON/Markdown evidence is public. Screenshots and raw logs/state
stay ignored and are retained locally; do not publish private host paths.
