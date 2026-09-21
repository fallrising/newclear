STATUS: PARTIAL

# T-018 — resumed validation and adversarial playback finding

## Summary

Fixed candidate `f7905bbab0c3032b28387d4596795c3a64800c58` contains the previous correction `b58298e`, main integration `95d1722`, and real Chromium playback/scope/theme/focus regressions. All ordinary gates pass, but independent T-020 attempt 2 and the lead adversarial reproduction reject its in-flight pause handling. No acceptance or remote CI is claimed for this checkpoint.

## Verification

- Node 24.18.0 / pnpm 11.18.0 frozen install, lint, typecheck, 170 tests, docs, contracts, CI, architecture, actionlint and diff --check — passed
- Rebuilt production demo, JS gzip 445.42 kB, plus complete 38/38 M0–M3 Chromium journeys on the fixed candidate — passed
- Original staging and immediate prod cancellation failures, playback start/pause/resume/reload/route/persona/reset/approval stop, Data→Commerce receipt/read/audit isolation — passed
- Actual theme controls; 390/768/1440 × light/dark × three delivery routes; initial dialog focus, Tab containment, Escape/restore; zero serious/critical axe findings — passed
- Adversarial real Chromium with delayed delivery of genuine clock responses: pausing enables overlapping manual clock requests (maxPending=2) — failed
- Independent T-020 attempt-2 acceptance — failed

During test authoring, two test defects were preserved then corrected: expected heading omitted 執行紀錄; guide selected unavailable 3-tick option rather than its actual 5-tick option. Focused rerun passed both. First frozen install invocation from repo root selected pnpm 12.5.1 and correctly refused the component; executing from the component resolved pinned 11.18.0 without changing package/lockfile/config.

## Documentation

Reports preserve all earlier evidence. Local logs and failed-authoring artifacts: `/tmp/dim-gate-m3-resume-evidence/`. Fixed candidate browser archive: `f7905bb-browser.tar.gz`; gate manifest `f7905bb-results.json`; suite log `f7905bb-e2e.log`; overlap reproduction `probe-playback.mjs` and `probe-playback.json`. These local artifacts are not claimed remotely durable.

## Risks and Follow-ups

Contract revision 2 clarifies pending ownership across pause. Third bounded cycle must run the new adversarial regression, full gates, and independent fixed-candidate closure before remote acceptance. M4 observation and M5 bundle optimization remain future work; no main write, force push, merge, deployment or real cloud operation occurred.
