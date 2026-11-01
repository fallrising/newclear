# Browser acceptance

These Playwright tests start the real Signal Hub binary with temporary config,
token files, and SQLite storage. Each test seeds its own synthetic events and
cleans up its server and files. Requests are not mocked.

Build the frontend and Go binary before running:

```sh
cd web
npm ci
npm run build
cd ..
go build -buildvcs=false -o /tmp/signalhub ./cmd/signalhub
cd browser
npm ci
npx playwright install chromium
SIGNALHUB_BINARY=/tmp/signalhub npm test
```

Set `SIGNALHUB_CHROMIUM` to an existing Chromium executable when needed.
The configuration enables Chromium's sandbox; run as a normal, unprivileged
user on a host that supports the sandbox. The test runner deliberately does
not disable the sandbox to work around restricted container environments.

Coverage includes rejected invalid/producer credentials, read-only access,
100+5 pagination without duplicates, search URL/history/reload behavior,
memory-only tokens and logout, inert JSON rendering, unsafe origin links,
related-event navigation, API-backed source freshness transitions and recovery,
and mobile document overflow. The watch source uses a real two-second interval;
the silent transition is observed after more than four seconds.

Successful runs also save desktop timeline and mobile timeline/detail/sources
screenshots in `test-results/` for visual inspection. Chinese system fonts are
needed to inspect the Traditional Chinese interface accurately.

CI uses the Ubuntu 24.04 runner's preinstalled Google Chrome at
`/opt/google/chrome/chrome`, whose installed path is supported by Ubuntu's
AppArmor policy. The browser version is printed in the job log. This preserves
Chromium sandboxing without changing host security policy; the local default
continues to use Playwright's pinned Chromium download.

M3 adds a real metric browser flow: active-rule reload, more than 200 retained rollups, two versions, partial/threshold markers, group selection, desktop/mobile layout and logout. Its isolated synthetic database fixture removes only its own historical event to emulate a future retention boundary; production retention is not claimed. API requests are not mocked. Console/page exceptions fail this test, and CI uploads screenshots for review.

M4 adds `deliveries.spec.mjs`: six synthetic decision/execution events through separate source tokens and ordered correlation navigation; delivery counts, filters, pagination, readonly403, owner replay/audit, logout and 390px layout. The delivery fixture seeds only synthetic historical states to exercise real query/replay handlers. Actual transport/retry/DLQ/lease/ntfy/digest are exercised by `go test ./cmd/signalhub -run TestM4RealServiceDeliveryRecovery`, which starts a separate service process and trusted local TLS receiver. The suite retains all six M1–M3 browser cases; console/page errors and unexpected HTTP failures remain fatal.


M5 adds `archive.spec.mjs`: the real CLI archives, verifies and imports isolated synthetic events before the browser queries restored timeline/detail/related metadata and unchanged raw CloudEvents. It verifies repeated import, memory-only credentials/logout, desktop and 390px layout, console/page errors, unexpected HTTP failures and failed requests. It saves `desktop-restored-detail.png` and `mobile-restored-detail.png`. All eight M1–M4 cases remain. The HTTP drill and actual TLS recovery subprocess test separately verify live-WAL backups and preserved pending/inflight/DLQ behavior.

M6 preparation adds `sources.spec.mjs`: the checked-in release, inspection and Alertmanager samples go through the real production API with separate synthetic credentials. Retries retain the original seq; the browser sees exactly three events, original detail and three fresh source cards on desktop/390px mobile, with memory-only credentials/logout and strict browser-health checks. Artifacts are `m6-three-sources-desktop.png` and `m6-three-sources-mobile.png`. All nine previous cases remain. This is a synthetic preparation test, not seven-day source or live notification acceptance.
