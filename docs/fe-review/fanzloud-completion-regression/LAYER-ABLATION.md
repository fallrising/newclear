# App-free layer ablation — ERR_ABORTED after a complete page read

Desk T-0433 / issue [706](https://github.com/fallrising/newclear/issues/706), R2-AC-14. On 2026-10-28 the owner approved two single, bounded, non-canonical runs. They are diagnostic evidence only: canonical stays 8/27, recovery007 stays FAIL/consumed, and no Fanzloud cell is accepted by them.

## Setup

The runs use the same pinned container image (`--network none`), Node 24.18.0, Playwright 1.63.0 and Chromium 153.0.8010.12 (Playwright revision 1243) with the same launch arguments as recovery007. Everything Fanzloud-specific is removed: there is no app, fixture, cookie, WebSocket, trust recipe or `response.body()` observer. A loopback HTTPS server writes the response the way the review transport does: `writeHead` followed by one `end()`. That gives chunked framing with no Content-Length. The page issues sequential same-origin `fetch` calls using the exact `p0-client.js` request options. Only per-cell counts and `net::ERR_*` enums are recorded. Private execution receipts hold the source hashes and raw results.

## Result

Every cell read all 300 bodies to completion on the page side, with zero page errors.

| Cell | Playwright `route.continue()` | Page consumption | Response | Request `cache` | `net::ERR_ABORTED` / 300 |
|---|---|---|---|---|---|
| A | yes | ReadableStream reader loop | no-store | no-store | 55 |
| B | no | reader loop | no-store | no-store | 82 (run 2: 96) |
| C | yes | `arrayBuffer()` | no-store | no-store | 0 |
| D | no | `arrayBuffer()` | no-store | no-store | 0 |
| E | no | reader loop | cacheable | default | 0 |
| F | no | reader loop | no-store | default | 88 |

## What this establishes

- The recovery007 signature (the page finishes the body, Playwright reports `requestfailed net::ERR_ABORTED`) reproduces on the exact engine without any Fanzloud component. The application, the isolated fixture and the body observer are not necessary causes.
- Playwright request interception is not necessary (B fails without it).
- Two conditions are necessary in this probe: a `no-store` response header and consumption through a ReadableStream reader. The request `cache` option is not a factor (F). A whole-body drain (`arrayBuffer()`) produced 0/600.
- This matches the preconditions of the [conditional source path](../FANZLOUD-COMPLETION-PLAN.md): a no-store response uses the direct consumer, and the BodyStreamBuffer reader client is the one that re-enters Cancel. The exact internal branch was not instrumented, so it remains source reasoning. Whether recovery007 took this path is not proven, but every observed recovery007 field is consistent with it.

The product contract requires `Cache-Control: no-store` on every response, so the response condition cannot be changed. The client fix is specified in [SPEC-T006](../../../platform/fanzloud/docs/specs/SPEC-T006-private-operator-web.md) P-006-10.

## Consequence for acceptance

The fix changes `p0-client.js` and the review fixture. Under the existing reuse rules, a prior capture is reusable only when the asset and fixture hashes are unchanged. All 27 canonical cells, including the 8 already accepted, must therefore be captured again on the fixed source. Recapture requires its own owner-approved runtime. No gate or reuse rule is relaxed.
