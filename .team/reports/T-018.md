STATUS: PARTIAL

# T-018 — M3 resumable development checkpoint

## Summary

User requested saving progress and a new-conversation prompt on 2026-09-21. Work stops at a recoverable checkpoint, not M3 acceptance. Product correction: `b58298e9ddc2498830f1fd144277b1c6345359b1`; branch `agent/dim-gate/mainline/m3-delivery`; worktree `/home/ckc/test/codex/newclear-m3`.

M0/M1/M2 remain ACCEPTED and MERGED. PR #13 is verified MERGED at `29bed41788a33684f24d216f4fd4d5f3f998c672`. M3 started from `e760d8e`; latest SSH-fetched main is `aafd24d7e7110454847ef8856bc15cd76626c2c7`. That delta touches agent-platform/root portfolio documentation only, not dim-gate or its ledger. It is not merged into this branch yet. No M3 PR exists at this checkpoint, and no M3 remote CI is claimed.

Saved implementation:

- `f1c5cc6`: frozen M3 contract/schema/tasks.
- `96fe94d`: atomic delivery engine, scoped reads/audit, prod approval, artifact history, rollback and tests.
- `4cb7dd5`: integrated worker UI/client (source worker `d40b98e`).
- `4422919`: central client/routes/shared-policy/environment links.
- `2abbec9`: nine authored Chromium journeys and original PARTIAL T-019 report (source worker `768435a`).
- `b58298e`: corrections for independent review findings, playback control, immediate-action UI timing, test locator fix and recovery/scope regressions.

## Verification

- Frozen install, Node 24.18.0 / pnpm 11.18.0 locked runtime, earlier in this worktree; no dependency changes — passed
- `pnpm test` on exactly the correction content committed as `b58298e`: 170 tests, 18 files — passed
- `pnpm lint`, `pnpm typecheck`, `pnpm check:architecture`, `git diff --check` on correction content — passed
- Original `2abbec9` production build: JS 444.80 kB gzip; correction build has not run, so old `dist` is not current HEAD — passed
- Original `2abbec9` M3 Chromium: 7/9 passed, 2 failed; evidence in [attempt 1](T-018-attempt-1.md) — failed
- Correction production build, all E2E, remaining full native gates, independent re-review and current-head remote CI, required before acceptance but deferred at user-requested handoff — skipped

Original production preview was `pnpm preview --port 4173 --strictPort`, URL `http://127.0.0.1:4173/dim-gate/`. It was managed by Playwright and exited after the suite. Port 4173 was confirmed free at handoff. No service is claimed running.

## Documentation

[T-020 attempt 1](T-020-attempt-1.md) preserves the independent REWORK verdict and both newly reproduced domain failures. [T-019](T-019.md) remains the worker's original report; it is not a final integration acceptance report. The latest PLAN resume block and STATUS point here.

## Risks and Follow-ups

1. Add real Chromium playback start/pause/resume, reload and persona/reset cleanup coverage. Recheck completion-versus-dialog-version synchronization; re-run the two original failures first. Strengthen new UI tests to operate actual theme controls and assert initial dialog focus (existing test sets the theme attribute and manually focuses before Tab containment). Add a browser-level Data→Commerce clock receipt isolation assertion using real UI transitions.
2. Rebuild current HEAD, run every native gate and full E2E, save console/page/network/DOM/axe/focus evidence, and inspect screenshots. The nine M3 journeys are added to the existing 22 regression journeys; initial M3-only run is not a full-suite pass.
3. Reconcile latest main safely, perform independent fixed-commit follow-up, preserve findings/attempts, update reports/ledger. Push the same branch, open or reuse a Draft M3 PR (check remote first), require current-head CI, then mark Ready only when justified. Do not auto-merge or deploy.

Runtime and local artifacts:

```sh
export PATH=/home/ckc/test/codex/.toolchains/node-v24.18.0-linux-x64/bin:/usr/local/bin:/usr/bin:/bin
export LD_LIBRARY_PATH=/tmp/dim-gate-playwright-libs/usr/lib/x86_64-linux-gnu
export FONTCONFIG_FILE=/tmp/dim-gate-m3-fonts-kaBaS8/fonts.conf
cd /home/ckc/test/codex/newclear-m3/platform/dim-gate
pnpm install --frozen-lockfile
pnpm build --mode demo
pnpm exec playwright test e2e/m3-delivery.spec.ts
# then all prescribed gates, including pnpm test:e2e
```

- Existing Playwright Chromium 1243 is under `/home/ckc/.cache/ms-playwright`; normal config uses it. `actionlint` is `/tmp/dim-gate-actionlint/actionlint`.
- Original browser trace/report/screenshot archive: `/tmp/dim-gate-m3-browser-attempt-1.tar.gz`, local-only. It is preserved, not claimed remotely portable.
- Original screenshots lacked CJK fonts. Ubuntu `fonts-noto-cjk` was downloaded/extracted to the temporary directory above; task-local fontconfig resolves Noto CJK. No system font installation/global configuration changed. Font-corrected screenshots are still pending.
- Kernel contract fully read at pinned `237aa277b0d067f65c8f64f49c6854597f7f8b15` in `/tmp/dim-gate-m3-kernel-ykJiGn/repo`; original read-only reference remains `664d176`. Latest SSH kernel HEAD observed during handoff is `0902d57b3516014f3f15e7167f37cdc744fd2973`; its changed instructions have not been read, so do not claim adoption.
- The local sandbox cannot start (`bwrap: loopback: Failed RTM_NEWADDR`). Approved shell escalation was used. Local edits used `/usr/bin/env apply_patch` through that approved route; do not bypass future denials.
- Source, M1/M2, UI and fixed-review worktrees plus kernel-reference were clean at handoff. No source/accepted worktree rewritten; unrelated agent-platform worktree remains outside scope.
- Four-machine SSH-config request remains conditional/pending target details: aliases, IP/domain, SSH user/port, existing IdentityFile path and jump host. No `~/.ssh/config` edit or private-key read occurred. Do not infer hosts from another component or initialize real infrastructure as part of dim-gate.

The M5 300 kB gzip target remains a known optimization risk. M4 observation/incident resolution is not implemented. No paid service, real cloud operation, deployment or merge occurred in M3.
