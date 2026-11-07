# Desktop remaining v5 — eight non-recovery desktop states on the T-0433 source

Scope: desk T-0433 (issue 706), R2-AC-14, T006R review harness only. [Recovery v4](SPEC-T006R-recovery-v4.md) produced the `recovery-required` desktop cell on the fixed source. The other eight desktop cells were accepted on the previous source and cannot be reused. The owner approved preparing a runner for those eight cells and running it once after review and CI. This document changes no product protocol, product acceptance or existing runner.

## Why the base is `remaining-baseline.mjs`, not v4

v4 inherits the recovery-only gate from `recovery-formal.mjs`. That gate requires a `recovery_required` session body with an `outcome_unknown` turn, exactly one manual action and recovery-state counts. Every other state would fail it by design, and `bootstrap-empty` never authenticates. `remaining-baseline.mjs` is the existing all-state runner (tablet and mobile use it for nine states). It has the generic authenticate, bootstrap diagnostic, action guard, turn/device/disconnected flows and per-state counts, without recovery-only assertions. These are the gates the eight earlier cells were accepted under, so v5 keeps them unchanged.

## Clauses

D01 — `fe-review/remaining-desktop-v5-baseline.mjs` is a new file. Its bytes equal `remaining-baseline.mjs` with exactly these substitutions and nothing else:
- the header comment;
- the selection: only the argument `desktop-remaining` is accepted, using the desktop viewport from the unchanged `selectPhase(['desktop-recovery'])` and the states `scenarios.slice(0,8)`;
- the receipt `scope` text;
- the `fixture.mjs` and `/assets/p0-client.js` source pins, set to the T-0433 source;
- the recorded runner file name;
- the retained-seven and ordering-reuse block, replaced by `receipt.retainedDesktopKeys=[];receipt.reuse='NONE_SOURCE_CHANGED';`;
- the previous-phase read, replaced by `const previous=null;`;
- `receipt.fullViewportFresh=false`, because one viewport state (recovery) lives in the v4 result.

D02 — v5 reads no earlier run, accepted manifest, PNG or reuse approval, so no prior-run mount is needed. For byte traceability it keeps the base's provenance hashing of unchanged source files and its unused reuse import; those bytes are hashed into the receipt but never parsed or trusted. The base's `if(previous)` PNG check and `previous?` manifest hash stay as unreachable code because `previous` is always null.

D03 — Every remaining gate is unchanged:
- initial 401 health and body;
- the strict bootstrap diagnostic, where any unexpected health entry or `requestfailed` (including `ERR_ABORTED`) fails;
- the action guard and per-state mutation, effect and turn counts;
- the device, turn, rejection, cancel and disconnected observers and their post-reconnect checks;
- cursor storage, DOM, keyboard, axe and PNG;
- the 180-second internal deadline, owned cleanup and listener absence.

D04 — A v5 PASS produces eight candidate cells (`bootstrap-empty` through `disconnected`, `__desktop__dark`) on the T-0433 source. They become canonical only after an independent actual review. Together with the v4 recovery cell, they complete desktop 9/9. A FAIL is preserved and stops further runs: there is no automatic retry, and renaming an attempt does not reset its allowance.

D05 — The pure test `fe-review/remaining-desktop-v5.node.mjs` proves:
- forward and inverse application of the D01 substitutions to `remaining-baseline.mjs` is byte-exact, and only the two pins change;
- every source pin matches the current file or embedded asset;
- v5 contains no reuse or previous-run read;
- the selection yields the eight non-recovery states at the desktop viewport, and `remaining-baseline.mjs` is unchanged.

## Runtime boundary

The run is attempt `baseline-desktop-remaining-001`: one start, at most 300 seconds including cleanup, in the pinned image with `--network none`. Its mounts are the read-only worktree, Playwright tools and browser cache, plus private `/state` and `/output`. The runtime approval and launcher stay in private execution receipts. Raw headers, bodies, cookies and bearer values are never recorded.
