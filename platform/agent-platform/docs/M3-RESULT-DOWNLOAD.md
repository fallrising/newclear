# Safe persisted diff download

The authenticated workbench now offers **下載 diff** for saved results with complete, structurally valid diff metadata. Empty diffs are valid. Failed or unknown verification remains inspectable; downloading does not change a result or mean its verification passed. No provider key or billing integration is needed.

`GET /api/v1/runs/{run_id}/result.diff` reads only that run's persisted diff. The API checks UTF-8 encoding, at most 256 KiB, an exact integer `diff_bytes` (booleans are rejected), lowercase SHA-256, and a lowercase 40/64-hex `base_sha` matching the run. Missing run/result/diff returns 404; damaged data returns 409; missing or expired session returns 401.

Successful responses preserve exact bytes, including CRLF and Unicode. They use `text/plain; charset=utf-8`, a server-generated `run-<UUID>.diff` attachment name, `nosniff`, `no-store`, and CSP `sandbox; default-src 'none'`. Result-supplied filenames, media types and paths do not control the response. The UI uses same-origin session credentials, checks HTTP success before creating a download, releases its object URL, and displays failures for retry. Downloaded patches are not interpreted by this feature.

The result summary, diff and activity remain React text nodes. The browser fixture sends script tags and event handlers through real PostgreSQL/API paths and checks that no injected script/image nodes, dialogs, payload requests or script canary appear. It also downloads and compares exact Unicode/CRLF bytes and SHA-256. The existing 100-event disconnect/reconnect browser case remains in the suite.

## Verification

Platform acceptance used Python 3.12. Frontend and real-browser acceptance used Node 24.18.0; the local browser API fixture used Python 3.13.5 with the existing locked Python dependencies. No VM/provider acceptance is claimed. Commands:

```sh
make platform-check
make web-check
make browser-test
```

The browser suite requires Playwright's Chromium and its system libraries. It starts a local API and a dedicated `agent_platform_test` PostgreSQL database. The security seed is a test script action, not a product endpoint. It creates fake persisted run records and does not allocate a VM or invoke a model. Sanitized evidence is in `evidence/m3-result-download-2026-10-03.json`.

This delivers bounded persisted diff transport and browser injection coverage. General artifact storage, Git export, VM execution acceptance and remaining M3 integration gates are separate work. Billing remains deferred.
