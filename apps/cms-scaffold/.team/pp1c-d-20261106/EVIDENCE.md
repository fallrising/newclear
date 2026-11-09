# PP1c D checkpoint evidence

This is source/evidence acceptance only. D actual acceptance is **FAILED / pending**, as recorded in [CHECKPOINT.md](CHECKPOINT.md).

## Source identity

- `source-freeze-after-T193.json`: historical 260-file source used by D9.
- `source-freeze-after-setup-stage.json`: historical diagnostic 260-file source. Exactly three paths differ: recovery.spec.ts and local-restore-smoke.mjs/test; 257 are unchanged.
- `source-freeze-after-ci-portability.json`: current 261-file source. The [bounded CI portability correction](CI-PORTABILITY.md) adds one material module and modifies two existing files; 258 remain unchanged from the setup-stage freeze.
- All original nine new sources plus the new material module are included, including the four explicitly staged ignored local modules/fixtures/tests. No runtime dependency or permission change is introduced.

## Observed checks

Commands run from apps/cms-scaffold with Node 24.18.0 (`NODE24` denotes its executable). These retained native runs are reused because their frozen source is unchanged, except for the three separately verified diagnostic files.

| Check | Observed result | Evidence |
| --- | --- | --- |
| `NODE24 --test --test-reporter=spec scripts/local/*.test.mjs scripts/ops/*.test.mjs` (exact expanded vector in results.json) | D9: 1413 pass, zero fail/cancel/skip; 405200.168572ms | node-full-native-D9.log; after-T193 freeze |
| `NODE24 --test --test-name-pattern=setup_stage_ scripts/ops/local-restore-smoke.test.mjs` | Intended Red: 3 failures for missing new stage codes; same command Green: 3 pass | setup-red.json (worktree-prefix redacted) and setup-green.log |
| `NODE24 --test --test-reporter=spec scripts/ops/local-restore-smoke.test.mjs` | Current diagnostic source: 53 pass, zero fail/cancel/skip; 59129.258527ms | setup-smoke-suite.log |
| Direct `tsc --noEmit ... e2e-pp1-local/recovery.spec.ts playwright.pp1-local.config.ts` | exit 0 | results.json exact vector and log hashes |
| Playwright `test --config playwright.pp1-local.config.ts --list` | exit 0; exactly one listed test; no browser/input/socket | results.json; listing is not runtime execution |
| Java source-bound reuse | 208 unchanged sources; 630 unit / 223 real PostgreSQL, zero failure/error/skip | results.json; required PR CI also runs Java/PG |
| Frontend source-bound reuse | Previously accepted workspace/native checks; no frontend product change in D. One-line title-test wait was already delivered in PR1038 | PR1038; current PR required web CI |

D9 log SHA256: `db9b64f3d441d5a84090a2c6d49b4cba0106e2be7c59ccab72eee1e3ba4971db`. Current affected smoke log SHA256: `b45ad1acbe3c44e2989ccd4ef35b53b4e20bdb61769a58ee93495119725357d9`. The historical 1413 tests do **not** cover the three later diagnostic edits; the 53-case run and T196 do. Type/list checks do not execute the browser journey.

## Independent reviews and failures

T190 accepted source/evidence only after its independent transient-lock I1 and cancellation-cleanup I2 Reds became Green. T191 covered the public readonly CLI/comparison and T193 the private failure-cleanup correction. T196 independently reviewed exactly the later three-file/21-line diagnostic change and its Red/Green/53-case/type/list evidence. Original reports, frozen preimages and failures remain in the private continuation evidence; [T197 checkpoint publication review](../reports/T-197.md) and its [independent audit receipt](publication-20261109/review/audit.json) found no publication blocker. No whole-source audit or full native rerun is implied by publication review.

Actual D1–D4 remain failed. D4 browser phase began and failed; earlier progress text claiming browser success was corrected. No complete proof, independent actual readback, actual default readonly CLI or default RECOVER success exists. These gates cannot be replaced by native tests, listing or source review. Current PR CI and remote merge/readback receipts must be observed before declaring this checkpoint delivered; they do not accept D.

Private source/evidence backups were individually read back: final pre-I2 636-file archive SHA256 `2e85fb66b65bf95a025c53554e710aec6f907414677a8be2990a712ad1d7eb52`; I2/actual4 325-member archive `9a52a303370e0c86a30f085a5ccf39542614527fac0a43bc3837d85c16f08190`; latest setup 294-member archive `12ace4d59f4f0b6477a3c70615028d5d3e7ce6e2634034a8d143a6523b6a09b9`. Receipts and original private runtime/data remain local; no DB/media/credentials/JAR/cache or raw model events are published.

## First PR CI failure and scoped correction

The first head passed Java/PG/contracts but web failed six T178 cases due to workstation-only test assets. This failure is retained in [CI-PORTABILITY.md](CI-PORTABILITY.md); its Red/Green and current 261-file source freeze supplement the historical evidence above. It does not change D4's failed actual result or authorize a new drill.
