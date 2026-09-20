STATUS: PARTIAL

## Summary

T-005 integration attempt 1, M0 AC-01–03. Candidate local `56ca8d0b1f1445f1473ccf3725ec53e0b4a9d45a`, durable equivalent `e7d74275b1bbf157ab8d1888e3d482e95fb647b2`, complete tree `9880368a9bfde197a2172d5f5108fb383eef9633`. Source main/spec `1117d297aa3efef9472d847c9dfa5714eb6c4460`, plus committed ADR-012–014 and M0-CONTRACT rev2; kernel `7cddad13f965d579b218579609c7f64e1ecf35b2`. Orchestrator model ID unavailable; actual built-in workers and independent reviewer, no claimed Claude or multi-model invocation.

The candidate implements shared pure domain/policy/atomic persistence, session/controller/MSW/typed client, three-center shell and demo controls, complete generated forward wire contract, exact lockfile and scoped root CI. It is not accepted: independent review reproduced failures missed by existing passing tests.

## Verification

- Fresh isolated worktree at local candidate, Node24.18.0/pnpm11.18.0, `pnpm install --frozen-lockfile`:334 packages, exit0; equivalent remote clean install is visible in CI job106074890059 — passed
- Native scripts below: all exit0, 79 unit/contract/component tests and7 production Chromium E2E — passed
- Independent review reproduced obsolete lost-reset/lost-persona response replay rewinding a newer Admin identity, violating AC-02 — failed
- Independent default-sort probe found omitted runtime sort=name versus published default=id — failed
- Full PR `git diff --check source..candidate` found one extra EOF blank line in the preflight report; worktree-only check had missed it — failed

| Command | Exit code | Local seconds |
| --- | --- | --- |
| `pnpm lint` | 0 | 5.89 |
| `pnpm typecheck` | 0 | 9.55 |
| `pnpm test` | 0 | 7.36 |
| `pnpm check:docs` | 0 | 1.54 |
| `pnpm check:contracts` | 0 | 1.96 |
| `pnpm check:ci` | 0 | 1.41 |
| `pnpm build --mode demo` | 0 | 11.12 |
| `pnpm test:e2e` | 0 | 48.85 |

[Remote CI run35509526982](https://github.com/fallrising/newclear/actions/runs/35509526982) and [job106074890059](https://github.com/fallrising/newclear/actions/runs/35509526982/job/106074890059) completed successfully, including standard Playwright browser installation, all native gates,79 tests and7 E2E. It tested synthetic PR merge `c2601922d9c8b6b5f71baf74379691e8612ab544`; API verification confirmed the same complete tree as the candidate. Artifact `dim-gate-m0-c2601922d9c8b6b5f71baf74379691e8612ab544`, ID10605005473, SHA256 `083318c0a17c57ac5086ed5c0a8fbc5cfbaeeffb83d6b8b7cd7afd2fae6f8420`,1170274 bytes, expires2026-10-20. CI green is not substituted for independent acceptance.

Local Playwright CDN browser download failed with repeated502/timeout. Tests instead used isolated `@sparticuz/chromium`153.0.0 / Chromium153.0.8010.0, preserving normal web security. The bundled font configuration was scoped to the test process and supplied NotoSansCJKtc-Regular.otf, SHA256 `dce08bd4fd91aa8aa76ed8fea4b694c2dfb8550f67871e326843212ddbeb88b4`. No global font/browser settings changed. CI uses its standard Playwright Chromium, so both environments are distinguished.

The first preliminary browser pass was5/6: axe found4.44:1 text contrast. A single shared light-muted token correction raised it above4.5:1. Missing CJK glyphs were corrected in the local test environment, then fresh screenshots and7/7 browser tests passed. Main and independent reviewer inspected actual guide1440/768/390/dark and center screenshots; no blocking clipping or unreadable CJK remained. The mobile closed persona selector truncates long names; full options and accessible names remain available.

## Documentation

[Commit mapping](dim-gate-commit-map.md) records GitHub API transport and exact tree equivalence. The initial local HTTPS push lacked credentials; supported connector writes saved the authorized branch and [Draft PR#7](https://github.com/fallrising/newclear/pull/7). Local immutable history and worker attempt reports are preserved. No force update, main write, merge or deployment occurred.

## Risks and Follow-ups

Do not accept this candidate. T-002 attempt2 addresses the reproduced identity bug with two real-handler regressions; lead corrects default sort and adds a DTO/runtime comparison, removes EOF whitespace and reruns the full PR diff check. A new fixed commit, independent follow-up, native gates and remote CI must precede acceptance. Keep PR#7 draft until those gates pass.

M1–M5,60-CI seed, full workflows, production authentication/cloud integration and Firefox/WebKit remain out of scope. Measured current initial JS gzip325.12kB (~317.5KiB) exceeds the M5 300KiB budget; no LCP/5000-CI/p95 performance acceptance is claimed.
