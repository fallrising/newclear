STATUS: PARTIAL

## Summary

M4 integrated candidate `298a563da0d163ecafa8cc90259a2e06a97ca84c`, stacked on accepted M3 `7d20bbc48a25e82c82c048304da8b74a897ec14e`. SSH branch `agent/dim-gate/mainline/m4-observability`; Draft PR https://github.com/fallrising/newclear/pull/20, base M3 branch. This is not acceptance.

Implemented shared observation API/domain, incident lifecycle and timed rollback recovery, correlated UI, scoped notifications and Guide preparation/business/audit flow. Worker handoffs are T-021/T-022 attempt1; no existing worktree or parent PR was overwritten.

## Verification

- Pinned Node24.18.0/pnpm11.18.0 frozen install, unchanged lock SHA256 `0da752e9e75f7b22902ba601583d1979e0a0d63b34275bcc445c4286dec7a32b` — passed
- Lint/typecheck and207 tests across21 files on the exact integrated product content committed as298a563 — passed
- check:docs, check:contracts (73operations/173schemas), check:ci, check:architecture, corrected root actionlint invocation and git diff --check — passed
- Fresh `pnpm build --mode demo` from298a563, JS gzip465.01kB — passed
- `pnpm exec playwright test e2e/m4-observability.spec.ts` from fresh298a563production build:4passed/3failed,7.4minutes — failed
- T-023 attempt1 independent read-only static review: no reproducible blocking/high/medium implementation finding; incomplete runtime evidence expressly excluded — passed
- Full production regression and latest-head CI acceptance — skipped

Chromium passed empty/strict window/dedupe/fallback/reopen, failed rollback/reset, persona/raw evidence/notifications/integration simulation, and actual theme/viewport/axe/initial-focus/Tab/Escape/return-focus checks. All three provider story cases timed out at the same test-author selector `getByLabel('Provider',{exact:true})`; the real DOM has `combobox Provider`. Replace with the accessible role selector already used by M2. No product assertion was removed or relaxed.

Raw console/network/DOM/PNG/trace/HTML evidence is preserved at `/tmp/dim-gate-m4-evidence/298a563-browser-attempt-1.tar.gz` before any rerun. Local-only artifacts are not portable proof by themselves; PR CI preserves remote artifacts. Actual screenshots render CJK correctly and reveal cramped wrapping in the new desktop toolbar. Follow-up adjusts notification/search/breadcrumb sizing, adds open-notification panel viewport evidence, and makes Guide manual clock pending wait for all invalidated projections.

Runtime from component directory: `PATH=/home/ckc/test/codex/.toolchains/node-v24.18.0-linux-x64/bin:/usr/local/bin:/usr/bin:/bin`, `LD_LIBRARY_PATH=/tmp/dim-gate-playwright-libs/usr/lib/x86_64-linux-gnu`, `FONTCONFIG_FILE=/tmp/dim-gate-m3-fonts-kaBaS8/fonts.conf`. Playwright1.63 uses cached Chromium153.0.8010.12 rev1243. Preview4173 is managed by Playwright strictPort with reuseExistingServer=false. Vitest console times are local Europe/Berlin, despite the T-022 worker report labeling its09:30:32timestamp UTC; actual UTC is07:30:32.

## Documentation

SDD02/03/06/08, generated OpenAPI and M4 contract document temporal samples, scoped DTOs and native SVG/table choice. Task/report scope remains T-021–024. Original reports and fixed review checkout remain preserved. Initial actionlint command used a nonexistent relative filename, then passed with `.github/workflows/dim-gate-ci.yml` from repository root.

## Risks and Follow-ups

Complete selector/layout correction, bind new exact commit to full gates and reviewer delta closure, and require current-head CI before acceptance. Current first-head CI35700984495 is pending at report writing. No automatic merge, force-push, direct main write, deploy or real cloud operation. M5 bundle/performance and extra-browser gates remain separate. No external model source transmission was attempted.
