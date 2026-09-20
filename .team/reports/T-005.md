STATUS: DONE

## Summary

T-005 revision3 / attempt3, reserved final bounded cycle. DG-D010 accepts M0 AC-01–03 at durable implementation `695e962304276ab80885c985ce0f7287b15b4698`, local tested `26827e293c7bfc260ab790cc0696ebc7ce671e87`, identical complete tree `98f739b9b07537b41fd8c83f88da7d81de0787df`. This supersedes the acceptance suspension recorded at DG-D009. Existing [attempt2](T-005-attempt-2.md) retains complete architecture/AC/native evidence and source provenance; unchanged areas retain that evidence.

Final metadata CI run35513677939 failed 1/7 E2E: dark-theme axe sampled interpolating button colors (outline contrast2.85, primary2.4). Failure artifact10606044764, SHA256 `61c81865be9e9028af6bc6f131cb30bbbd3e5b02b28d77f1f03858cb5494e8a0`, retains trace/screenshot. Prior green evidence did not override this new failure. One product line removed foreground/background transitions; no test delay, exclusion, threshold reduction or retry was added. The product now switches directly between accessible theme colors.

## Verification

- Local fixed-commit production demo build, documentation gate and full source-to-commit whitespace check — passed
- Independent [T-004 attempt3](T-004-attempt-3.md) inspected the bounded delta and reran unchanged production responsive/dark/focus browser acceptance — passed
- [Final product CI35513835780](https://github.com/fallrising/newclear/actions/runs/35513835780), job106086297179: frozen install, lint, typecheck,82 tests, docs/contracts/CI checks, demo build, standard Chromium installation and7 E2E — passed
- Synthetic merge `a38b07292e60aa472bf664303a2fb3c45a1ba510` has parents reconciled main `a330237860b3002d68fec3f853a6d1deb44a8e9a` and695e962; `git diff --exit-code` for component, ledger and dim-gate workflow confirms exact scoped equality — passed
- Authorized API publication verified correction full tree, remote branch and existing PR7; no main write, force update, merge or deployment — passed

CI artifact10605983393, `dim-gate-m0-a38b07292e60aa472bf664303a2fb3c45a1ba510`,1170032 bytes, SHA256 `ae12f84d4ed60c8929ceb23b8a1aded5b0db2682b572db1d9fd23e9e10c3256d`, expires2026-10-20. Merge whole tree `34d202df6aec098d6732d027416f4e865fba34b4` differs due unrelated reconciled main additions; no whole-tree merge equivalence is claimed. Prior complete updated-main/CI-rule reading remains valid, same main parent.

## Documentation

Canonical T-004/T-005 point to attempt3; attempts1/2 remain immutable history. PLAN records the new failure, bounded correction, acceptance and released owner; STATUS reflects current accepted implementation. Tasksrevision3 authorized this reserved cycle before work. Exact source commits, unavailable model IDs/Claude, local browser fallback and recovery exercises remain documented in attempt2 and preflight. Final report/ledger changes alone do not change the tested product; final metadata CI and its commit are linked from PR7.

## Risks and Follow-ups

No unresolved M0 blocker. This is M0 only, not M1–M5 or full v0.1. Initial gzip ~317.5KiB exceeds future M5 300KiB; broader performance/browser/full-seed acceptance remains pending. Local Chromium153+Noto CJK and standard CI Chromium are distinguished. Same PR7 remains unmerged; next agent reconciles PR/main, preserves accepted M0 and selects M1 AC-04–08,20. Never auto-merge or duplicate the existing M0 PR.
