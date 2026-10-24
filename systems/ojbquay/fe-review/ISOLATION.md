# Approved R2 isolation contract

This implements the owner-approved 2026-10-24 DESIGN addendum. It is a review
fixture over the unchanged eleven-service deployment, not a production rollout.
Current status: approved R2 local evidence is complete; independent final review and current CI/publication remain pending. The measured owned stack has been removed with positive absence.

The orchestrator owns Docker/Compose, images, the fresh bridge and volumes. Each
run has an unpredictable `fe-ojb-<hex>` project/run ID, source SHA, fresh private
0700 directory, generated PostgreSQL/admin/Grafana identities and passwords.
Secrets enter processes via environment or private stdin/file0600 only. No full
resolved config, token, cookie, payload or request header/body is public output.

`compose.review.yaml` clears every inherited host publication, labels every
service/volume/network and uses five run-specific image tags. Existing service
dependencies, internal listeners, build files and read-only config mounts remain
unchanged. Resolve base and overlaid models privately with the same explicit
project/e2e profile; `ownership.py` verifies the permitted delta and rejects
pre-existing projects, foreign/external resources, inherited ports and ownership
drift. Tool containers are separate declared owned resources on the fresh bridge.
No browser Docker socket or host networking is allowed.

The browser tool container uses its own namespace, nonroot UID, dropped
capabilities and no-new-privileges. Source, observer modules and browser cache
are read-only; state/evidence are the only task writes. Vite binds127.0.0.1:5173;
`loopback-proxy.mjs` binds127.0.0.1:8080 and transparently forwards only `/api/`
and `/internal/` to the fixed `console-api:8080` upstream. It preserves actual
session/CSRF/status/body semantics and creates no API data. Existing backend
bridge listeners are explicitly authorized; the inspected frontend remains
loopback-only. Validate actual listeners and bridge members before login.

Login is the real UI using a fresh ADMIN and CSRF/session cookies. REST creates
synthetic topics/groups/PUSH/PULL; existing gRPC ProduceDelay uses a body token
from private stdin and is checked by authenticated REST readback. Actual DLQ
uses the existing owned push-sink's unlistened port9, as the existing stack test
does. No direct database/Kafka writes, retained accounts or injected auth.
Empty/500 page.route cases are scoped to their named phases in each viewport context, then removed; they are clearly supplemental.

Before cleanup, close/wait browser, Vite, proxy and helper processes; prove
listeners absent. Inventory exact owned container IDs, volume names/network IDs
and labels again. Any mismatch/foreign member prevents destructive cleanup;
preserve and report. Remove only recorded owned resources, in dependency order;
never default-project down, image prune, shared cache cleanup or broad volume
removal. Record positive absence and preserve raw failed-attempt receipts. A
fresh retry is a new run, not an overwrite of failed evidence.

Public artifacts contain synthetic names, fixed result categories, source/image
hashes and sanitized metrics only. Screenshots, logs, credentials, storageState,
private configuration and traces remain ignored and are archived by root.

## Stable outer-launcher interface

`python3 -B fe-review/run-isolated.py prepare --state <fresh0700dir> --source <sha>`
creates private owner.json/environment.json. The orchestrator reads the latter
into child environment without echoing it. Check absence via successful inventory
before any build/start; `absent` requires `{inspectionSucceeded:true,resources:[]}`.
Resolved base/model JSON and normalized Docker inventory files are private0600
inside that same directory. `check-config --base <file> --model <file>` verifies the
actual normalized overlay; `record --inventory <file>` seals exact resource IDs;
`cleanup-plan --inventory <fresh-file>` refuses any mismatch before root removal.
After removal `absent` checks a new successful inventory. Never convert failed
Docker inspect/list into an empty result. The helper itself performs no Docker
operation and publishes no secrets.

Inventory resource fields: `kind` (container/network/volume), `id` (Docker ID or
volume name), `labels`; containers additionally `networkMode`/`publishedPorts`,
networks `members` (container IDs). Temporary tool/gRPC containers must be closed
and proven absent before the stack cleanup inventory, so they cannot be mistaken
for foreign retained members. Root owns their independent exact-ID receipts.

## Inner browser observer and partial resume

The root-owned tool invokes `node /work/systems/ojbquay/fe-review/run-browser.mjs
/evidence/<unique-run>` with fresh private `/state/browser.json` containing only
`user`, `password`, `run`, `source`. Existing source/dependencies are read-only.
The runner uses locked Playwright1.62.0/Chromium1234. Its review-only observer
module applies to main, states and shared capture: only the exact frontend origin
can reach the browser network; the source Google Fonts import is blocked and
classified as an unresolved existing resource dependency. Known tokens are masked
at screenshot time, including nested audit code text; actual API/DOM data is not
rewritten. Raw audit/API bodies never enter public summaries.

The initial browser attempt stopped after one topic, three groups and two PUSH
subscriptions because PULL maxBatch16 exceeded concurrency1. Resume requires an
explicit `FE_REVIEW_RESUME=1`, the same owned stack/run/user, and exact readback
of those partial resources, ownership and relationships. It creates only the
missing PULL with maxBatch1, then continues the not-yet-run message/delay/capture
steps. This is not a second fresh stack. API failures and raw console diagnostics
are private0600 files. The existing React/AntD compatibility warning is matched
by complete source-derived text/hash; its console.error method remains recorded
separately from its warning meaning. Other errors are not suppressed.
