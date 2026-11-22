# FZ-OFFICE-NAV — private Office result navigation

Current: owner resumed implementation after PR1061; see **Authorized continuation**
and [current specification](../specs/SPEC-FZ-OFFICE-NAV.md). The original gap-report
sections below are historical and superseded only by the scoped continuation.

Owner direct continuation, 2026-11-22. Lead: this Codex session, branch
`work/fz-office-nav-contract-20261122`. Formal entry for the requested private,
read-only navigation; [BOARD](BOARD.md) is the progress authority.

## Goal and current decision

Let a Fanzloud user find an existing Office read-only result entry without creating
a result service, transferring credentials/data, or changing execution authority.
The owner's explicit fallback applies: if the entry/contract is insufficient,
locate the concrete gap and present the smallest reviewable proposal first.

Latest main checked at 2026-11-22T13:04:13Z:
`1c642259957aed8f65c31dc45f77740a121d9aa4`.
PR1048/1051 are historical; PR1049/1054 supplemented the comparison and PR1057/1058
already delivered/closed **instruction navigation**, tracked by closed issue1055.
No duplicate implementation is started. PR1056 remains an Office T29 draft owned
on GitHub by `fallrising`, with no assignees; it records HTTP402 and explicitly
forbids automatic retry/merge. Open issue159 is Fanzloud FE design, assigned to
`fallrising`; AP issue379 is M4 work. None establishes a private Office result URL.
Open PR/issue lists were checked; no open private-navigation implementation was found.

Desk main `14b3b29796966d8b19dc36ec2f6b91a613ee730b` was also fetched:
[T-0450](https://github.com/fallrising/desk/blob/14b3b29796966d8b19dc36ec2f6b91a613ee730b/tasks/T-0450-portfolio-consolidation/task.md)
is actively held by `Codex-GPT6-portfolio-pilot` for desk-only portfolio aggregation,
explicitly read-only in product repos. This owner-directed product slice does not
take over or edit that card. Existing Fanzloud T-0442 remains held by
`codex-gpt6-pilot`; this optional navigation adds no prerequisite or completion claim
to its original M1–M3/FN07. The shared product BOARD links both scopes.

[Gap and proposed design](../plans/office-private-navigation-gap.md).
**Functional outcome: BLOCKED by the unverified private destination/access contract.**
Documentation delivery must not mark the requested navigation or FN07 passed.
No live host/deployment inventory was accessed; absence from repository evidence
does not prove that no private deployment exists elsewhere.

## Writable scope and limits

Only these five files may change:

- `platform/fanzloud/docs/tasks/FZ-OFFICE-NAV.task.md`
- `platform/fanzloud/docs/plans/office-private-navigation-gap.md`
- `platform/fanzloud/docs/acceptance/FZ-OFFICE-NAV.acceptance.md`
- `platform/fanzloud/docs/tasks/BOARD.md` (append this task only)
- `platform/fanzloud/SUCCESS.md` (append this scope only)

No production code, existing entry-map rewrite, SDD/AC change, Office/AP edit,
credential/private locator capture, service start/deploy, public projection,
paid model/provider request, migration, cancellation/retry/reconcile write or
entry retirement. Original terminal/session/local operation and source status,
unknown, permissions, raw/display hashes and ref semantics remain authoritative.

## Acceptance and verification

G01: identify current entries, location/access constraints and the exact mismatch
with PR1057's already delivered behavior, using fixed-source references.
G02: propose minimal conditional navigation and its negative tests, rollback and
stop conditions without inventing an endpoint or relaxing owner acceptance.
G03: fresh-context independent document review, repository indexes, staged whitespace,
local links and five-path scope checks; normal PR/CI/merge/remote readback.
These are gap-report checks, not replacements for functional N01–N05 in the plan.

Verify from root: `python3 scripts/check_indexes.py` (using an existing environment
with the pinned OpenCC dependency), `git diff --cached --check`, changed-file and
relative-link inspection. Required hosted CI remains mandatory. No new checker
or runtime tests for prose; preserve the earlier Chromium evidence's fixture limits.

One fresh-context native read-only reviewer, inherited model/effort, no children
or edits; max 15 minutes, one initial review and one focused correction if needed.
Read-only scope is an instruction, not stronger OS isolation. Lead monitors time
and interrupts at the bound. Estimate 20 minutes for documentation/review/checks;
CI wait bounded at 10 minutes with minute checkpoints. No user-imposed hard budget.
Do not repeat unchanged failures beyond two reasoned attempts.

## Handoff and stopping

Finish the authorized gap report's review and normal Git delivery; keep the feature
row in_progress with no end time. Stop dependent implementation at the missing
contract. The only resumption input is a verified existing private entry plus its
source-owned access contract; if providing one requires a new service, credential
change or deployment, request that scope separately. No next milestone starts.
Rollback of this report removes only its five-file additions. Proposed feature
rollback is specified in the plan. [Evidence](../acceptance/FZ-OFFICE-NAV.acceptance.md).

Governance re-read from desk main: governance-contract blob
`86d9f4f063238a05ff1e7b34637e2f8dbed7138e`, delivery-and-handoff blob
`13bf6ff32c6131208ef14e27619160c2906dcb32`, operating-method blob
`f6f4347574a5ee70a69f574b8604d9a9c820dd52`. Stage two remains disabled.

## Authorized continuation — 2026-11-22

Owner now says “繼續開發” and permits Claude Code technical support focused on
requirements. Lead resumes this same task on main
`1f855489328736a2578bb0c9e7d76e688b4f5bf8`, branch
`work/fz-office-nav-impl-20261122`. PR1062/1064 changed only the separate diff
lifecycle; no overlapping open navigation PR. Office T29/PR1056 remains untouched.
Previous gap findings remain historical evidence, not a permanent ban on the
small source-UI integration needed to close them. Deployment/credential changes,
new services, product model calls and original AC changes remain excluded.

Candidate for technical review: an explicitly selected local-browser Office port
(no host/URL/secret input or persistence) builds only the existing loopback root
with a fixed result-view fragment. The existing Office frontend honors a
results-only view; authentication still uses its original private launch URL in
the same source tab, never Fanzloud. Reuse original GET/state, result rendering
and hash checks. No new endpoint, server, data projection or token mechanism.
The readonly view is a UI restriction, not a new credential permission.

First obtain a no-tools Claude Code design critique before production code.
One call, model `claude-opus-5-5`, effort high, 300s host timeout, API-equivalent
CLI budget USD3 (subscription quota/billing unknown), no tools/MCP/hooks/skills,
no persistence, no children or edits; one focused correction allowed only for an
actual design finding. User explicitly permits this development consultation;
there are zero product/provider test calls. Review exact response/exit/model.

Provisional writable scope: existing Fanzloud task/plan/acceptance/BOARD/SUCCESS,
new normative navigation spec, isolated.html/isolated.js/p0.css and focused
acceptance tests; Office existing console HTML/JS/CSS, focused frontend tests,
CONSOLE/RESULTS/SUCCESS/BOARD and this feature's shared browser receipt. No
Office backend, AP, SDD, grant/auth policy, native terminal/session or T29 edits.
Finalize scope and machine-executable AC in the spec before implementation.
Estimate 60–90min active work, 20min progress checkpoints, max two reasoned
attempts per failure; CI wait max10min. Final independent source review is
required, with one bounded reviewer and no implementation team.

Claude advisory execution was rejected by automatic approval review before launch
because possible USD3 usage lacked explicit spending approval. Owner has been
asked once; no retry or alternate external model call. This optional consultation
is not a required gate in the user request. Lead continues authorized design and
tests independently; final fresh-context source review remains required.
[Current normative contract](../specs/SPEC-FZ-OFFICE-NAV.md) fixes the minimal
same-browser/source-owned login path. It supersedes the candidate's request to
wait for optional Claude advice before production; no credential/service scope
is enlarged. Native source review will judge actual implementation/evidence.

Final scope also includes existing Fanzloud README/isolated-operator guide and
Office CONSOLE/RESULTS guides, the local browser harness/fixture under Fanzloud
acceptance, four screenshots and browser receipt. No other product changes.
Browser/Office checks passed locally; final independent acceptance and hosted CI
remain gates. Parallel T049/issue1065 owns observation-order correction in separate
worktree; our isolated.js changes are limited to the opening navigation block and
our tests to appended navigation cases/helper DOM methods. Preserve its work on
normal main integration; do not take over T049.

Integration checkpoint: main `1c0483e8` now includes T049/PR1068 and Office
T29/PR1056 plus its closeout PR1066. Their owners completed those independently;
this task did not execute them. Normal merge preserves both appended boards and
all T049 tests; earlier draft/block status is historical. Rerun navigation browser
and combined Fanzloud tests on the integrated source before publication.
