# ReopenWorkItem proposal review evidence

T-0339 / BOARD HROPP. Proposal: [reopen-work-item-20261102](../plans/reopen-work-item-20261102.md).

## Review

Claude Code `claude -p --model claude-opus-5-5 --allowedTools Read,Grep,Glob` (read-only, no edits or commands) on the
proposal at commit `c864de2f`; exit 0, 177.7 s, 47 turns, reported list price USD 1.944 (not billing). Verdict **REWORK**:
every factual claim of the "Why" table confirmed; one major and four minor findings. Aggregate provider requests, tool
counts and active-vs-wait time were not instrumented (unknown).

## Dispositions

| # | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| 1 | major | OpenAPI `CommandSuccess` and result.go allow `reason` only for RequestRework, so "no new schema" was wrong for a reason-carrying `WorkItemReopened` result | Adopted. ROP-04 lists the public `WorkItemReopenedResult` and `CommandSuccess` branch plus the validator case; D1 names the public contract amendment; ROP-AC-01 checks the closed result and ROP-AC-04 the Redocly lint of the branch |
| 2 | minor | ROP-02 check order put settled/clock before version, unlike RWK-02 | Adopted. One order for Ready-with-history and Developing; early return narrowed to Ready with zero Runs; ROP-AC-02 adds stale version + regressed clock → `version_conflict` |
| 3 | minor | Audit subject digest unspecified | Adopted. Request digest, as MarkReady |
| 4 | minor | Keep Ready-target input check; name scenario and intentional order | Adopted. `Scenarios[0]`, order rationale and a changed-policy Ready refusal then Draft success case in ROP-AC-01 |
| 5 | minor | ROP-AC-04 redundant with the gate AC; unsettled-Run negative unreachable after Done | Adopted. Folded into ROP-AC-04 as "no existing test modified" (now four ACs); settled guard stated as defensive without a test |

The reviewer judged ROP-02 necessary and sufficient for RWK-03 ordering, found no reader assuming one CompletionRecord
per WorkItem or "record implies Done", no path for the old Candidate or approvals to act after reopen, and D1 the only
owner decision once the OpenAPI amendment is included. No follow-up review was run: every change is a direct adoption
of the reviewer's own remedy. Raw prompt/result: `~/test/backup/hai-reopen-20261102/review/` (owner-local).
