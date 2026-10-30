# P0 real-browser acceptance

`p0-browser.mjs` is the AC-01 gate in SPEC-T008: real Chromium, actual production Rust
control-plane binary, and the exact shell fake extracted from T007. Its Node server only
terminates trusted local TLS and forwards HTTP bytes / WebSocket upgrades to Rust. It
contains no API fixture, intercepted request, patched WebSocket or certificate bypass.
This is **fake-provider evidence**, never a live Cloud success claim.

The driver requires the already-provisioned isolated review image with Node 24.18.0,
Playwright 1.63.0, Chromium 153.0.8010.12, OpenSSL and NSS `certutil`. Run as UID 1000
with a fresh image home `/home/ubuntu`. Do not change the host's HOME or trust store.
Mount these paths into a private container with networking disabled:

- reviewed source checkout at `/work` (read only);
- production `codebox-control-plane` binary at `/control-plane` (read only);
- existing Playwright modules at `/review-tools/node_modules` (read only);
- matching existing browser cache at `/ms-playwright` (read only);
- newly-created empty UID-1000 mode-0700 directories at `/state` and `/output`;
- frozen JSON source manifest at `/frozen/source-hashes.json` (read only).

Build the actual binary from the reviewed checkout first. Before launch, freeze the
manifest from that same checkout:

```sh
node acceptance/p0-browser.mjs --source-hashes > source-hashes.json
```

Supply `P0_SOURCE_COMMIT` as the full source SHA and
`P0_SOURCE_HASHES=/frozen/source-hashes.json`. The driver runs from the component path:

```sh
node acceptance/p0-browser.mjs
```

The outer launcher must bound total runtime to five minutes, use the recorded immutable
image, `--network none`, `--cap-drop ALL`, `--security-opt no-new-privileges`, and prove
removal of its own container afterward. It must not mount operator credentials or pass
provider credential variables. All fake provider paths are created inside `/state/fixture`
outside the source repository. The generated bootstrap bearer is never written to output.
Fresh TLS keys and disposable trust material remain in the private state mount; remove that
owned mount after retaining the sanitized receipt.

`/output/result.json` records source/binary hashes, browser versions, operation and state
counts, exact-diff comparison and cleanup results. It contains no raw request, response,
WebSocket frame, credential or diff. The run fails unless there is one submit, ordered
accepted/pending/ready events visible in activity, a refreshed Ready snapshot, one exact
diff read, reconnection without resubmit and rejection of the logged-out session cookie.
`Refresh status` is deliberate: the existing client appends event labels but does not
replace its session snapshot on live events.

Narrow static/negative checks:

```sh
node --check acceptance/p0-browser.mjs
node --test --test-isolation=none acceptance/p0-browser-contract.test.mjs
```

These checks do not establish a browser pass. The browser/container launch and its outer
cleanup receipt are required separately. Live AC-04 still needs the exact official CLI and
all SPEC-T007 operator prerequisites on the same production source; this fake harness does
not discover credentials or submit live work.
