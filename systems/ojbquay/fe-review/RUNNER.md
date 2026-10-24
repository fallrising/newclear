# Reproducing the approved R2 review

Use the [isolation contract](ISOLATION.md) and [approved task](tasks/round2/task.md).
The checked-in helpers do not own Docker: an authorized orchestrator must supply
fresh exact-owned resources, perform inspections and remove them afterward.
Historical run state is not a reusable deployment; the measured stack is gone.

## Native checks

Use Java25 and the checked-in wrapper, Node24.18 and locked pnpm11.18 dependencies.
From the component root:

```sh
./gradlew build --no-daemon --no-parallel
pnpm --dir console-web test
pnpm --dir console-web build
make validate-deploy
pnpm --dir console-web exec vitest run src/test/dashboard.test.tsx
python3 -B -m unittest discover -s fe-review -p 'test_*.py'
node --test fe-review/*.test.mjs
pnpm --dir console-web exec playwright test --config ../fe-review/playwright.config.ts --list
```

Existing `console-web/e2e` mock journey uses its own original config and isolated
static server. It does not replace the real-stack review. There is no added lint
script or dependency. Recorded native results, versions and image hashes are in
[the native index](tasks/round2/evidence/native/publication-index.json).

## Exact-owned environment

1. Create a new private0700 state directory and unpredictable project/run ID via
   `python3 -B fe-review/run-isolated.py prepare --state "$STATE_ROOT" --source "$SOURCE_SHA"`.
   Read its0600 environment.json only into the Compose child environment; never
   echo values or evaluate untrusted shell output.
2. Require successful empty project inventory. Resolve the unchanged production
   Compose and the review overlay with the same unique project and e2e profile;
   write the two models0600 under state. Call `check-config --state ... --base ...
   --model ...`. It must pass before build/up. Compose2.39.1 supports `!reset []`.
3. Build the five unique review image tags and start the existing eleven services.
   Inspect exact IDs/labels/networks/volumes and no host publication, then seal
   inventory with `record --state ... --inventory ...`. Do not use default-project
   down, host networking, external volumes or retained accounts.
4. Start one owned nonroot tool container with init, dropped capabilities,
   no-new-privileges, no Docker socket or host ports, attached only to the fresh
   bridge. Mount repository/dependencies read-only at `/work`, a fresh0700 private
   state at `/state`, ignored evidence at `/evidence`, Chromium1234 cache read-only,
   and the external axe4.13 observer module read-only. Supply
   `PLAYWRIGHT_BROWSERS_PATH` and `AXE_PLAYWRIGHT_MODULE` as container paths.
5. Write only fresh `user`, `password`, `run`, `source` to `/state/browser.json0600`.
   Invoke `node /work/systems/ojbquay/fe-review/run-browser.mjs /evidence/<unique-run>`.
   The runner owns loopback Vite5173 and transparent proxy8080; fixed upstream is
   the actual `console-api:8080`. Browser HTTP and WebSocket requests are restricted
   to the exact frontend loopback origin; source external fonts remain classified.
6. Watch exclusively for `/state/grpc-request.json0600`. Invoke only the existing
   ProducerService/ProduceDelay through the approved owned bridge/proto image,
   sending request JSON/token through stdin. Atomically publish0600
   grpc-response.json with `{exitCode,response}`. Never resend after an accepted
   delay ID; verify it through REST. No direct DB writes.
7. Preserve actual source hashes, receipts and private images. Remove the owned
   tool containers positively before stack cleanup. Reinspect exact sealed IDs,
   labels and network members, call `cleanup-plan`, remove only its IDs, then
   call `absent` with a new successful inventory. Unknown inspection is failure,
   not an empty inventory. Do not restart this historical stack.

The original default runner is for a fresh fixture. Explicit resume modes are
only for an orchestrator-authorized continuation of that same owned run:

| Mode | Preconditions and work |
| --- | --- |
| `FE_REVIEW_RESUME=1` | Exact partial topic/three groups/two PUSH ownership and relationships; only missing PULL created. |
| `FE_REVIEW_RESUME_READONLY=1` | Prior result/run/source/resource IDs and accepted RPC byte hash (`FE_REVIEW_GRPC_RESPONSE_SHA256`) must match. Only GET seed readback; no message/RPC resend. |
| `FE_REVIEW_SKIP_DRAWERS=1` | Private geometry-proof.json pins same source/styles and both actual measurements. |
| `FE_REVIEW_FINISH_ONLY=1` | Same product hashes, prior chart proof and exact41 state keys; only mobile anonymous bad-password state and still-missing route checks/captures. |
| `FE_REVIEW_REDACTION_ONLY=1` | Same product/source proof and private prior audit PNGs; six drawer image replacements plus conditional audit coverage checks. No unrelated matrix/flow rerun. |

Child commands have180s outer bounds; signal cancellation and independent cleanup
have separate finite bounds. Unknown resource closure is reported unsuccessful;
root-owned container removal remains necessary. Original failures never become
passing historical runs. Public output is sanitized summaries/hashes; private
state, payloads, console logs and PNGs are not publication artifacts.
