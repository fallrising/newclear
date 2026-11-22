# FZ-OFFICE-NAV evidence and handoff

## Implementation continuation — 2026-11-22

Baseline `1f855489328736a2578bb0c9e7d76e688b4f5bf8`; owner resumed development.
[Contract](../specs/SPEC-FZ-OFFICE-NAV.md) binds the port-only Fanzloud action to
existing Office `/` and `/api/state`, with original source-only authentication.
The preserved PR1061 report below described the earlier gap, not this implementation.

| Clause | Actual result and limit |
| --- | --- |
| N01 | Local actual Chromium → shipped Fanzloud markup/JS → real Office HTTP: keyboard open, fresh-tab login guidance, same-tab original launch, source result/detail/download, reload/reopen; 390/1280 screenshots inspected |
| N02 | Unset/invalid/bounds/reload cases, expired auth clears old rows/details, artifact tamper removes download, source offline preserves Fanzloud; browser owns top-level connection errors |
| N03 | Popup opener null, no document Referer, synthetic token exclusively in Office source tab, no Office storage/payload at Fanzloud; requests recorded without credential headers |
| N04 | Zero POST/provider spawn; before/after all fixture source files' hashes/mtimes and domain state match. Only catalog-generated response timestamp is excluded, since it is not stored state. Failed/incomplete preserved, unknown-label unit case, raw/display secret-only difference and verified Blob bytes tested |
| N05 | Explicit return restores original console controls without starting work. Local regression checks and independent review pass; CI/merge/readback pending |

[Browser receipt](evidence/FZ-OFFICE-NAV/browser.json),
[Fanzloud desktop](evidence/FZ-OFFICE-NAV/fanzloud-1280.png),
[Fanzloud mobile](evidence/FZ-OFFICE-NAV/fanzloud-390.png),
[Office desktop](evidence/FZ-OFFICE-NAV/office-1280.png),
[Office mobile](evidence/FZ-OFFICE-NAV/office-390.png). Receipt binds seven production
source files and inspector hashes. Source token has full original permissions; the
results-only mode is a UI safety boundary, not a new server credential capability.
Actual browser: Chromium153.0.8010.12, Node24.18.0; Python3.12.3.

Commands/results:

- From Fanzloud: `node --test --test-isolation=none apps/control-plane/web/p0-client.test.mjs acceptance/m2-isolated.test.mjs`: **51 passed**. Navigation test-first RED: 39 passed/2 failed; GREEN41 focused then full51.
- From Office: `umask 077` then `python3 -m unittest discover -s scripts -p 'test_*.py' -q`: **224 passed**. `node --test --test-isolation=none scripts/*.test.mjs`: **74 passed**, including six new result-view tests. `python3 scripts/check_publication.py`: **218 public sources passed**.
- Browser from repo root: `NAV_CHROMIUM_EXECUTABLE=<existing-chromium> timeout 90 node platform/fanzloud/acceptance/office-navigation-browser.mjs`, with the already extracted temporary OS libraries/fonts used by T047/T048: **passed**. [Harness](../../acceptance/office-navigation-browser.mjs) and [isolated source fixture](../../acceptance/office-navigation-fixture.py) launch no product model/runner.

Earlier failures retained: initial Node child-isolation run produced a runner
failure; no-isolation exposes intended RED tests. First browser cleanup raced
Chrome exit and masked its assertion; cleanup now waits for owned processes. Next
run exposed hash-only source login (fixed with source-local reload + unit test);
next exposed mobile long-hash overflow (scoped wrap fix). Next rejected dynamic
`catalog.generated_at`; corrected comparison excludes only that computed response
timestamp while retaining exact domain values and all stored bytes/mtimes. Final
browser run passed without removing a product assertion. Office full suite first
had 22 errors/1 failure under inherited umask0002, which made fixture source dirs
group-writable; umask077 fixtures satisfy unchanged grant checks. Node loopback
tests initially hit sandbox EPERM; authorized local-network run passed. No grant,
auth check, production permission or provider policy was weakened.

Optional Claude Code2.1.317 design call was rejected **before launch** by automatic
approval review for potential USD3 model usage without explicit spending approval.
No Claude response, request or acceptance is claimed; owner cost question remains
unanswered. Implementation proceeded under original authorization and awaits the
required native independent source review. No external-provider workaround.

Not verified: owner's Mac/private runs, installed/deployed version, live Fanzloud
Rust authentication/AP/provider journey, HTTPS deployment topology, FN07 owner
operation or full product AC. Fanzloud session responses are explicit fixtures;
Office HTTP/auth/reader/hash and browser actions are real with synthetic records.
No release/deploy, new listener in a private runtime, credential change, data
migration, public projection or paid product call.

Independent fresh-context source review: **ACCEPT**, no blocking findings. Reviewer
inspected tracked/untracked diff, source auth and GET-only UI, stale digest callbacks,
malformed/network/serialized refresh cases, browser harness and all screenshots;
independently ran 57 Node tests and verified seven production plus inspector hashes.
Board/SUCCESS stale pending text corrected. Reviewer did not rerun full Office
suites, Chromium or hosted CI; these remain separately recorded lead/CI evidence.

## Historical PR1061 gap report


Outcome: **BLOCKED for functional delivery**. The owner-authorized fallback is a
gap report and conditional design, not implemented private navigation.
[Task](../tasks/FZ-OFFICE-NAV.task.md), [proposal](../plans/office-private-navigation-gap.md).

Baseline: `1c642259957aed8f65c31dc45f77740a121d9aa4`, checked 2026-11-22.
GitHub readback confirms PR1048/1051, PR1049/1054 and PR1057/1058 merged.
`gh pr checks 1057` and `gh pr checks 1058` both report passing Fanzloud and
project-success checks. Those results belong to the previous instruction-navigation
delivery; they are not new private-navigation verification.

G01 source inspection: Office RESULTS/CONSOLE, actual console GET/auth/client code,
Fanzloud shipped navigation and current BOARD support the gap table. No private
runtime files, credentials or live Office deployment were accessed. Existing browser
evidence in [T047](T047.acceptance.md) explicitly uses synthetic session/503 and
intercepted document responses; it does not establish private destination access.

G02 proposal: conditional minimum action, negative cases, rollback and stop boundary
recorded. N01–N05 all **NOT_RUN**: no verified existing private result destination
and first-open access contract. No runtime code changes or model calls to test.
No document check is counted as functionality or owner acceptance.

G03 local checks passed in the target worktree with Python 3.12.3:

```sh
/tmp/fanzloud-p01-checks/bin/python scripts/check_indexes.py
git diff --check
```

55 project contracts, 9 llms indexes, zero errors. Read-only Python/pathlib/Git
inspection checked 101 relative links, six fixed newclear source targets, the exact
five-file scope and original BOARD byte-prefix preservation. No production, SDD or
original AC changes. The existing checker environment was reused, no install.

Fresh-context native read-only reviewer: **ACCEPT_DOCUMENT**, no blocking findings;
independently inspected the actual Office/Fanzloud sources, five-file scope,
relative links, preserved BOARD/SDDs, and reran indexes/whitespace. A focused
follow-up accepted the final desk ownership paragraph, relying explicitly on the
lead's fixed-commit desk readback. No edits, children or external provider call.
Lead accepts the gap report only; N01–N05 remain NOT_RUN.

Staged whitespace/alignment, hosted CI, normal merge and remote readback are still
delivery gates at this snapshot. The associated PR's final delivery receipt will
record their observed results and supersede this pre-merge pending note. Keep the
feature BOARD row in_progress with no end time; original product gaps stay open.

Initial connector searches rejected argument binding; the lead used authenticated
`gh` read-only queries. Initial sandbox fetch/network access failed; authorized
escalated Git/gh calls succeeded. No failed product test was recast as passed.
One native reviewer plus one focused ownership follow-up; provider request/token/
cost totals are unknown. Product model calls, runtime starts and deployments: zero.

Next input: verify an existing private entry and its non-secret topology/access
contract. Do not paste tokens or private locators into GitHub. If none exists,
retain manual Office access; a source-side contract change needs its own explicit
scope before implementation. No automatic continuation after this report.

Compatibility note: `office_console.js` is already included in the existing remote
grant source binding. Installing changed source may make an old unused grant fail
`remote_grant_source_changed`, as designed. This change neither migrates/recreates
grants nor retries them; T29 and all consumed authorizations remain untouched.
No private installation or grant was changed during this test.
