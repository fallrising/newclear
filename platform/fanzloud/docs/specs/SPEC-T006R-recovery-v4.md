# Desktop recovery v4 — recovery-only capture on the T-0433 source

Scope: desk T-0433 (issue 706), R2-AC-14, T006R review harness only. The [T-0433 read-path fix](SPEC-T006-private-operator-web.md) (P-006-10) changed `p0-client.js` and `fe-review/fixture.mjs`. The v3 runner pins both files to their old hashes and requires reuse of eight previously accepted desktop cells under hash equality. It therefore cannot run on the fixed source. The owner approved one desktop recovery run on the fixed source and this recovery-only runner. This document changes no product protocol, product acceptance or any v1–v3 file, and it does not turn a historical FAIL into a PASS.

## Clauses

V01 — `fe-review/initial-lifecycle-v4-baseline.mjs` is a new file. Its bytes equal v3 with exactly these substitutions and nothing else:
- the header comment;
- the receipt `scope` text;
- the `fixture.mjs` and `/assets/p0-client.js` entries in `expectedSources`, pinned to the T-0433 source;
- the recorded runner file name (`initial-lifecycle-v3-baseline.mjs` becomes `initial-lifecycle-v4-baseline.mjs`);
- v3's retained-seven and ordering-reuse block is replaced by `receipt.retainedDesktopKeys=[];receipt.reuse='NONE_SOURCE_CHANGED';`.

V02 — v4 reads no earlier run, accepted manifest, PNG or reuse approval, so no prior-run mount is needed. The only selectable phase stays `desktop-recovery` with state `recovery-required`, through the unchanged `selectRecoveryPhase`.

V03 — Every other v3 gate is unchanged:
- the initial-trace v3 observer and its completeness rule;
- exact 401/201/200 bodies;
- original and unexpected health, where any `requestfailed` (including `ERR_ABORTED`) fails;
- request identity and cardinality, and the action guard;
- DOM, keyboard, axe and PNG;
- the 180-second internal deadline, owned cleanup and listener absence.

V04 — A v4 PASS produces one candidate `recovery-required__desktop__dark` cell on the T-0433 source. It becomes canonical only after an independent actual review. It does not restore the eight earlier cells; those are recaptured on the same source under separate approval. A FAIL is preserved and stops further runs: there is no automatic retry, and renaming an attempt does not reset its allowance.

V05 — The pure test `fe-review/initial-lifecycle-v4.node.mjs` proves four things:
- rebuilding v3 from v4 by inverting the V01 substitutions is byte-exact;
- every `expectedSources` entry matches the current file or embedded asset;
- v4 contains no reference to reuse inputs (`/reuse-acceptance.json`, `/accepted-`, `remaining-accepted.json` reads, `acceptOrderingReuse(`);
- v1–v3 runner hashes stay unchanged.

## Runtime boundary

The run is attempt `baseline-desktop-recovery-008`: one start, at most 300 seconds including cleanup, in the pinned image with `--network none`. Its mounts are the read-only worktree, Playwright tools and browser cache, plus private `/state` and `/output`. The runtime approval and launcher stay in private execution receipts. Raw headers, bodies, cookies and bearer values are never recorded.
