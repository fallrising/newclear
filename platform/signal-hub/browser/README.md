# Browser acceptance

These Playwright tests start the real Signal Hub binary with temporary config,
token files, and SQLite storage. Each test seeds 105 CloudEvents and cleans up
its server and files. Requests are not mocked.

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
