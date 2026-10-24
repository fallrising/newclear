# #387 — 本地 pixel oracle 證據

Status: VERIFIED — local author gates passed; no CI/merge/owner whole-product acceptance claim.

## Summary

Source base d8ca3c4089a9fbe852459da3d9602329224230e7. AC-VIS01–03 add three narrowly scoped desktop/light scenes, native threshold0/maxDiffPixels0 Playwright comparisons, independently reviewed PNGs, typed/hash-verified comparison evidence, bounded fault cases and a portable pinned offline-container launcher. Product UI/backend and root CI are unchanged.

## Verification

All install/build/browser/test commands ran through the shared workspace launcher; protected task IDs below identify preserved logs and fresh run directories. `RUNTIME` was the task emitted by `T040-portable-runtime`.

| Evidence | Result |
| --- | --- |
| `T040-semantic-red`: VIS01 ID assertion against original helper | intended RED: unsupported ID, exit1 |
| `T040-candidates4`: explicit candidate creation, run `20261023-165200-d8ca3c4-dirty` | 3 candidate scenes; independently reviewed, not counted as GREEN |
| `T040-pixel-red`: controlled12px magenta border, run `20261023-165751-d8ca3c4-dirty` | intended pixel mismatch: login49,344pixels differ; other2pass; expected/actual/diff retained, no harness errors |
| `T040-green-series`: fresh containers/seed `20261023-170233`, `170300`, `170326` (all `-d8ca3c4-dirty`) | 3×3 GREEN, unchanged PNG hashes |
| `T040-portable-runtime`: delivered helper `provision` | exact Node archive checksum, three existing locks, Chromium1194 and image digest provisioned |
| `T040-portable-refusal`, `T040-helper-negatives` | existing foreign runtime links, concurrent ownership, outside candidate destination, relative runtime refused; links unchanged |
| `T040-portable-check`: delivered helper `check`, run `20261023-171454-d8ca3c4-dirty` | 3/3 GREEN; only self-created source links removed |
| `T040-bundle-red`: partial expected/actual-only failed comparison | intended RED: reporter incorrectly returned passed before repair |
| `T040-harness-fixed`: `suite --focus harness`, run `20261023-180217-d8ca3c4-dirty` | all5 W0 desktop/mobile pass; existing leak/missing/collision tests preserved; new partial-bundle and HTTP/WS/native-offline/context/tab tests pass |
| `T040-final-types`: `npm --prefix e2e run lint`; `T040-root-types`: `npm run lint` | both passed |
| `T040-portable-full3`: final frozen `suite`, run `20261023-182041-d8ca3c4-dirty` | exit0,59passed1existing desktop/mobile-platform skip; mobile W1-06 passed; final functional manifest `d98650fa2606041cee52312b64c43e34a40a35ee435c6839dda211c5f6000a4d` |
| `T040-final-pixel-red`: `probe`, `20261023-182948-d8ca3c4-dirty` | exit1 exactly intended login49,344pixel mismatch; other2pass; complete triplet and errors[] |
| `T040-final-green1/2/3`: `check`, `20261023-183006`, `183022`, `183039` (all `-d8ca3c4-dirty`) | each3/3 GREEN in fresh containers/seed; immutable PNG hashes; source links removed |
| `T040-nested-capability-red` → `T040-nested-capability-green`, `20261023-181649` → `181905` (same suffix) | actual nested navigator signal false RED, explicit capability propagation then all5W0 GREEN |
| `T040-final-audit` | final functional hashes, all321manifest file entries/evidence hashes, identical seed/pins/font assets, unchanged production inputs and source links absent verified |
| `T040-final-static` / `T040-handoff-static` |42project-success contracts、95local links、Python AST、25scoped files、unchanged locks and diff check passed |

First setup attempts are retained as resolved harness evidence: missing host browser libraries, readonly dependency cache, Wrangler scratch/config destinations. They are not pixel RED. First full run `T040-portable-full`, `20261023-171558-d8ca3c4-dirty`, exit1:27passed31failed1existing platform skip. W0 nested probe lost the new external dist override; the remaining room failures reflected native `navigator.onLine=false` in Docker network-none (not a product regression finding). `T040-online-signals` separately proved loopback HTTP200/WS success while native signal false; CDP online initialization restored true, native offline blocked fetch and returned false, then native online restored HTTP200. Force-network browser flags did not solve the signal. The original failures remain in evidence.

## Documentation

[Local gate, exact commands and update policy](../../docs/v2/11-visual-oracle.md); [baseline metadata](../../e2e/visual-baselines/metadata.json) includes PNG/environment/seed/lock/source hashes. Actual fallback is WenQuanYi Zen Hei Regular, not inferred Noto installation. Independent engineering review approved the same three PNG hashes conditionally on actual mismatch RED and three fresh GREEN, now proven. It is not owner whole-product visual acceptance. Pixelmatch keeps includeAA=false: zero counted differences excludes AA-classified pixels; baseline SHA256 is provenance/integrity, not a byte-equality oracle.

Node24.18.0, Playwright1.56.1, Chromium1194 /141.0.7390.37, digest-pinned Ubuntu24.04.4, 1280×800 DPR1, zh-TW, Asia/Taipei, light. Per-job operational scratch/state and config; runtime dependency cache only may be reused. Browser/service external egress disabled by Docker namespace; visual routes additionally reject other origins. Opt-in CDP initializes reachable-loopback connectivity without navigator getter replacement or weakening native offline tests.

## Risks and Follow-ups

This is a documented local gate; root CI remains existing test/web. A reproducible CI lane needs separate scope/runner/cost approval and the same image/runtime/font/artifact policy. Only three locator crops are covered; no mobile/dark/full-page/whole-product acceptance claim. Parent final source review/CI/merge remain separate from these completed local author gates. No commits, staging, GitHub mutations, real models, provider credentials or live user state used.
