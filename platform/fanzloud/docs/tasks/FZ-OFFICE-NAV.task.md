# FZ-OFFICE-NAV — private Office result navigation

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
