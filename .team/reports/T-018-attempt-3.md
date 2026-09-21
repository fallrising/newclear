STATUS: DONE

# T-018 — final M3 delivery acceptance evidence

## Summary

M3 AC-13–16 and AC-24 is accepted at product commit `04d6646a2a325bb4efc18c44b463e0e6fd1747f3`, after full local gates, independent T-020 closure and exact-head remote CI. [PR #17](https://github.com/fallrising/newclear/pull/17) targets main; acceptance does not merge or deploy it. Base main `7bb80d00d03d93a2d392185adba65588c5fe2462` was integrated by normal merge `95d1722` and remains the latest SSH-reconciled target at this checkpoint.

This run completed real Chromium playback start/pause/resume/reload, route/persona/reset cleanup, approval/terminal stop, immediate cancellation and Data→Commerce clock receipt isolation. Tests now operate actual theme controls and observe initial dialog focus before keyboard input. Additional adversarial response-delay probes exposed same-view pause and SPA-remount overlap; final playback, delivery manual controls and Guide share query-mutation pending ownership through response plus refresh. Timer intent remains view-local.

## Verification

Runtime: Node **24.18.0**, pnpm **11.18.0**, Playwright **1.63.0**, Chromium/headless-shell **153.0.8010.12**, revision **1243**. Lockfile SHA-256: `0da752e9e75f7b22902ba601583d1979e0a0d63b34275bcc445c4286dec7a32b`. No dependency/lockfile change.

All product evidence below binds `04d6646a2a325bb4efc18c44b463e0e6fd1747f3`:

- `pnpm install --frozen-lockfile` with component-local pinned runtime — passed
- `pnpm lint`, `pnpm typecheck`, `pnpm test`: 170 tests / 18 files — passed
- `pnpm check:docs`, `pnpm check:contracts`, `pnpm check:ci`, `pnpm check:architecture` — passed
- `pnpm build --mode demo`: production JS gzip 445.65 kB — passed
- `pnpm test:e2e`: 40/40 real production Chromium journeys, 0 failed/flaky/skipped; 18 M3 plus 22 M0–M2 regressions — passed
- `/tmp/dim-gate-actionlint/actionlint ../../.github/workflows/dim-gate-ci.yml`, `git diff --check` — passed
- Independent [T-020 attempt 3](T-020-attempt-3.md): no blocking/high/medium findings — passed
- GitHub Actions [35637762270](https://github.com/fallrising/newclear/actions/runs/35637762270), head `04d6646`, synthetic merge `2320eeb2e7a012c9bcf012a591404cb223a5f261`: 170 tests, every native CI gate, 40/40 Chromium journeys and browser artifact upload — passed
- SSH branch tip verified as the tested product commit; existing PR reused for subsequent evidence metadata — passed

Browser evidence:

- Stable staging→next→rollback, immutable artifact equality/history, health-only activation, build/health/rollback failure, retry, prod actor separation, busy/cancel/unlock and immediate post-clock cancellation — passed
- Playback timing advances one tick per request; pause/manual/resume and delayed-response SPA remount→Guide maintain maxPending=1. Reload has no offline catch-up; route/persona/reset/approval/terminal boundaries stop future ticks — passed
- Data-only pipeline progressed by Commerce clock has no run/release/digest/revision disclosure in Commerce receipt, lists, audit or visible DOM; original replay/scheduler recovery regressions remain in unit/contract suite — passed
- 18 delivery route/theme/viewport combinations (3 routes × light/dark × 390/768/1440), actual theme toggle persistence, zero document overflow and zero serious/critical axe — passed
- Dialog initial focus observed on close control before keyboard input, followed by Tab containment, Escape and opener restoration at all three widths — passed
- 18 M3 journeys capture 2012 network responses; page errors, failed requests, unexpected HTTP errors and unexpected console errors are all zero — passed
- Lead visual inspection of final mobile pipeline and desktop dialog, plus staging rollback evidence: readable Chinese glyphs, wrapped stages, contained table scrolling, visible focus and semantic status text — passed

## Documentation

Final source review is independent static inspection plus inspection of lead-generated runtime evidence; the reviewer did not implement the change or execute the browser suite. Built-in lead and independent collaboration reviewer use inherited runtime identities; no distinct model slug or external Claude source review is claimed.

Historical evidence is preserved: [original browser attempt](T-018-attempt-1.md), [resumed attempt 2](T-018-attempt-2.md), [original handoff](T-018-checkpoint-1.md), [worker attempt 1](T-019-attempt-1.md), and independent attempts [1](T-020-attempt-1.md) / [2](T-020-attempt-2.md). `f7905bb` passed 38/38 before adversarial pause rejection; `30b8d04` passed 39/39 before remount rejection. Neither is accepted. Original fixed review, source, accepted and worker worktrees were preserved, including historical dirty worker state.

Portable remote evidence: [CI browser artifact](https://github.com/fallrising/newclear/actions/runs/35637762270/artifacts/10656658825), retained for 30 days by workflow. Final metadata-head CI/artifact links are recorded on PR #17 after completion; progress-only documentation does not change product/tests/config/lockfile/workflow content.

Local evidence directory: `/tmp/dim-gate-m3-resume-evidence/`. Final logs, gate manifest, extracted JSON/text attachments and aggregate health/concurrency summary are in `final/`. Browser archive `04d6646-browser.tar.gz` SHA-256: `665d4180f637a3269222561671d84aa199ee4c3cf957c2fea32e60f0906fb56b`. Historical browser archives and both adversarial probe sources/results remain alongside it. Local archives are not claimed remotely portable.

Reproduce from `platform/dim-gate` using PATH `/home/ckc/test/codex/.toolchains/node-v24.18.0-linux-x64/bin:/usr/local/bin:/usr/bin:/bin`, LD_LIBRARY_PATH `/tmp/dim-gate-playwright-libs/usr/lib/x86_64-linux-gnu` and FONTCONFIG_FILE `/tmp/dim-gate-m3-fonts-kaBaS8/fonts.conf`, then the commands above. Browser config starts `pnpm preview --port 4173 --strictPort` at `http://127.0.0.1:4173/dim-gate/`; it exits after tests. Port 4173 was confirmed free after the final local suite.

## Risks and Follow-ups

The 445.65 kB gzip JS bundle remains above the future M5 300 KiB target. M4 observation/incident resolution is not implemented; rollback only emits the specified recovery-requested event. No cloud runner, real cloud operation, paid service, force push, main write, automatic merge or deployment occurred.

Push this evidence-only checkpoint and require its latest-head CI before marking PR Ready or ending the delivery handoff. PR remains unmerged; merge needs a separate user instruction. Next product milestone is M4, not a redo of accepted M0–M3.
