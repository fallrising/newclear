# Recapture v7 — all 27 dark cells on the M2-repaired source

Scope: desk T-0433 (issue 706), R2-AC-14, T006R review harness only. [M2 repair](SPEC-T006R-m2-repair.md) changed the served `/` and `/assets/p0.css`, so no earlier cell is reusable and the v4–v6 runners are historical. The owner approved updating the runner and recapturing all 27 cells: desktop, tablet and mobile, one run each. This document changes no product protocol, product acceptance or existing runner.

## Why one runner for all three phases

The generic all-state flow of `remaining-baseline.mjs` already passed on the fixed source for tablet and mobile, including `recovery-required`. Using it for desktop as well gives one run per viewport. It also lets each phase chain on the previous one with the same runner and the same source hashes, which is the original chain's intent.

## Clauses

R701 — `fe-review/remaining-v7-baseline.mjs` is a new file. Its bytes equal `remaining-baseline.mjs` with exactly these substitutions and nothing else:
- the header comment;
- one added import of `assertPreviousDesktopFull`;
- the selection: the argument must be `desktop`, `tablet` or `mobile`. `desktop` selects all nine states at the desktop viewport (size from the unchanged `selectPhase(['desktop-recovery'])`); `tablet` and `mobile` use the unchanged `selectPhase`;
- the receipt `scope` text;
- the source pins for `fixture.mjs`, `/`, `/assets/p0-client.js` and `/assets/p0.css`, set to the M2-repaired source;
- the recorded runner file name, plus `previous-desktop-full.mjs` in the provenance list;
- the retained-seven and ordering-reuse block, replaced by `receipt.retainedDesktopKeys=[];receipt.reuse='NONE_SOURCE_CHANGED';`;
- the previous-phase block:
  - `desktop` has no previous result.
  - `tablet` reads `/previous`, then calls `assertPreviousDesktopFull` and `assertPreviousPNGs`.
  - `mobile` keeps the unchanged `assertPreviousPhase` and `assertPreviousPNGs` against `/previous`.

R702 — `fe-review/previous-desktop-full.mjs` exports `assertPreviousDesktopFull(previous, currentHashes)`. It is `assertPreviousPhase` with the expected previous phase set to `desktop`, viewport `desktop` and all nine scenario keys:
- `passed`, stage `COMPLETE`, mode `remaining-baseline`;
- the same row predicate (including the `disconnected` reconnect checks);
- every current source hash equal in the previous result;
- tools Node v24.18.0, Playwright 1.63.0, Chromium 153.0.8010.12;
- complete cleanup.

R703 — Every other gate of `remaining-baseline.mjs` is unchanged:
- all nine state flows;
- health, where any `requestfailed` fails;
- counts, diagnostics, storage, DOM, keyboard, axe and PNG;
- the 180-second deadline and cleanup.

The runner records overflow and axe results without asserting them. The M2 final-state gates of R07 are judged in each run's independent actual review:
- no unexpected page horizontal overflow;
- named, keyboard-reachable event and diff regions;
- no axe critical or serious violations;
- contrast with the recorded bounded evidence.

R704 — Each phase runs once, in order: desktop, then tablet, then mobile. Each run must pass and be accepted by an independent actual review before the next phase starts. A FAIL is preserved and stops the sequence: there is no automatic retry, and renaming an attempt does not reset its allowance.

R705 — Pure tests:
- `fe-review/previous-desktop-full.node.mjs` covers accepting a valid nine-key desktop result and rejecting each failed condition.
- `fe-review/remaining-v7.node.mjs` proves forward and inverse byte-exact substitution, current pins, no reuse read, unchanged `remaining-baseline.mjs` and the three-phase selection.

## Runtime boundary

The attempts are `baseline-v7-desktop-001`, `baseline-v7-tablet-001` and `baseline-v7-mobile-001`. Each is one start of at most 300 seconds including cleanup, in the pinned image with `--network none`. Mounts are the read-only worktree, Playwright tools and browser cache, private `/state` and `/output`, and for tablet and mobile the previous phase's run directory, mounted read-only and pinned in the source freeze. The runtime approvals and launchers stay in private execution receipts. Raw headers, bodies, cookies and bearer values are never recorded.
