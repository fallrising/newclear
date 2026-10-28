# Tablet and mobile v6 — eighteen cells on the T-0433 source

Scope: desk T-0433 (issue 706), R2-AC-14, T006R review harness only. Desktop is 9/9 on the fixed source: [recovery v4](SPEC-T006R-recovery-v4.md) captured attempt 008 and [desktop remaining v5](SPEC-T006R-desktop-remaining-v5.md) captured attempt remaining-001, and both were accepted by independent actual review. The owner approved preparing a tablet/mobile runner and, after review and CI, running tablet once. Mobile runs only after a tablet PASS and a separate owner approval. This document changes no product protocol, product acceptance or existing runner.

## Previous-phase chain

`remaining-baseline.mjs` runs `tablet` only after a `desktop-recovery` result produced by the same runner, and requires every source hash it records to match. The fixed-source desktop evidence comes from two runners (v4, v5), so that rule cannot be met as written. v6 therefore checks the desktop evidence with an equally strict helper, and keeps the original rule for mobile.

P01 — `fe-review/previous-desktop.mjs` exports `assertPreviousDesktop(recovery, remaining, currentHashes)`. It requires all of the following:
- Both results passed with stage `COMPLETE`, mode `remaining-baseline`, viewport `desktop` and reuse `NONE_SOURCE_CHANGED`.
- The phases are `desktop-recovery` and `desktop-remaining`.
- Together the results hold exactly the nine canonical desktop keys, in scenario order, with no duplicates.
- Every row satisfies the same predicate as `assertPreviousPhase`: semantic pass, asset status 200, safe storage, empty bearer and prompt, inert diff, PNG hash, and non-empty all-expected health. A `disconnected` row additionally needs `reconnectedWithoutMutation` and expected post-reconnect health.
- Every source key present in both a desktop result and the current receipt is equal, and the product and fixture keys (`fixture.mjs`, `transport.mjs`, `lifecycle.mjs`, `trust.mjs`, `baseline-support.mjs`, `/`, `/assets/p0-app.js`, `/assets/p0-client.js`, `/assets/p0.css`) must be present and equal.
- Tools are Node v24.18.0, Playwright 1.63.0 and Chromium 153.0.8010.12, and cleanup is complete.

The runner separately checks each desktop PNG against its recorded hash, using the unchanged `assertPreviousPNGs`.

## Runner clauses

V601 — `fe-review/remaining-v6-baseline.mjs` is a new file. Its bytes equal `remaining-baseline.mjs` with exactly these substitutions and nothing else:
- the header comment;
- one added import of `assertPreviousDesktop`;
- the selection: the unchanged `selectPhase`, restricted to `tablet` or `mobile`;
- the receipt `scope` text;
- the `fixture.mjs` and `/assets/p0-client.js` source pins, set to the T-0433 source;
- the recorded runner file name, plus `previous-desktop.mjs` in the provenance list;
- the retained-seven and ordering-reuse block, replaced by `receipt.retainedDesktopKeys=[];receipt.reuse='NONE_SOURCE_CHANGED';`;
- the previous-phase block. `mobile` keeps `assertPreviousPhase` and `assertPreviousPNGs` against `/previous` unchanged. `tablet` reads `/previous-recovery` and `/previous-remaining`, calls `assertPreviousDesktop` and `assertPreviousPNGs` for both, and records their manifest hashes.

V602 — Every other gate of `remaining-baseline.mjs` is unchanged, including all nine state flows, health (any `requestfailed` fails), counts, diagnostics, DOM, keyboard, axe, PNG, the 180-second deadline and cleanup. `fullViewportFresh` stays true, because each phase captures all nine states fresh.

V603 — A tablet PASS produces nine candidate cells that become canonical only after an independent actual review. A FAIL is preserved and stops further runs: there is no automatic retry, and renaming an attempt does not reset its allowance.

V604 — Pure tests:
- `fe-review/previous-desktop.node.mjs` covers acceptance of a valid pair and rejection of each failed condition in P01.
- `fe-review/remaining-v6.node.mjs` proves forward and inverse byte-exact substitution, current pins, no reuse read, unchanged `remaining-baseline.mjs`, and the two-phase selection.

## Runtime boundary

Tablet is attempt `baseline-tablet-001`: one start, at most 300 seconds including cleanup, in the pinned image with `--network none`. Its mounts are the read-only worktree, Playwright tools and browser cache, private `/state` and `/output`, and the two desktop run directories mounted read-only and pinned in the source freeze. The runtime approval and launcher stay in private execution receipts. Raw headers, bodies, cookies and bearer values are never recorded.
