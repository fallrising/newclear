# dim-gate W4 validation

Run `DG-W4-20260923-01` · [draft PR50](https://github.com/fallrising/newclear/pull/50) · [contract revision1](../../platform/dim-gate/docs/W4-INTEGRATION-CONTRACT.md) · base `d80028c64c2d359d6a44bbe699a09d1d1d2bfe8a`.

Status: **IN PROGRESS / NOT ACCEPTED**. This is an evidence index, not a claim that implementation, tests, review or CI passed. W3 PR37 is merged; its actual post-merge workflow35873299419 has since reached completed/SUCCESS. W4 contract checkpoint `9fd3279ead6aa9e776c56c9fb3066e670631484a` is SSH saved. Final fixed product SHA and all outcomes must be added from actual execution.

| AC | Required evidence | Current result |
| --- | --- | --- |
| AC-WS-12 | Service/infra rules, independent prod decision, sample-time/revision lineage, no duplicate incident, Silence expiry and delivery statuses | Pending T041–043 integration and tests |
| AC-WS-15 | Current-scope list/detail/evaluation/delivery/audit and stale persona response; 404/403 | Pending direct HTTP/browser tests |
| AC-WS-16 | Strict W1/W2/W3→v4 migration, active work, corrupt/quota retry and no ghost writes | Pending T042 tests |
| AC-WS-17 | Keyboard, axe light/dark 1440/768/390, deep refresh, Firefox/WebKit, unchanged performance gates | Pending fixed-product browser/benchmark |
| AC-WS-18 | Honest capability map, Demo marker, no external collector/message/cloud request | Pending content/network review |

Fixed-product gate plan: frozen install, lint, typecheck, native test, docs, contracts, CI/architecture, demo build; complete Chromium, Firefox/WebKit smoke, fresh unchanged benchmark and sibling/live isolation; uninvolved T044 fixed-source review; exact latest PR-head CI; then authorized normal merge and actual merge/tree/post-merge checks. Historical failed or partial attempts remain explicit. CI artifacts expire and `/tmp` raw logs are machine-local, so versioned summaries must preserve source SHA, command, result and artifact URL. Do not call a draft or intermediate branch ACCEPTED.
