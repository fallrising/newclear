# AddBlocker / ResolveBlocker proposal review evidence

T-0339 / BOARD HBLKP. Proposal: [blocker-commands-20261102](../plans/blocker-commands-20261102.md).

## Review

Claude Code `claude -p --model claude-opus-5-5 --allowedTools Read,Grep,Glob` (read-only, no edits or commands) on the
proposal at commit `cdb283d6`; exit 0, 214.8 s, 43 turns, reported list price USD 1.761 (not billing). A first launch
exited 1 in 0.8 s because the prompt did not reach the CLI (stdin was redirected from /dev/null); it is retained as
`attempt1-*` and the prompt was passed as an argument. Verdict **REWORK**: slice choice and payload narrowing confirmed;
two blocker, one major and four minor findings. Aggregate provider requests, tool counts and active-vs-wait time were
not instrumented (unknown).

## Dispositions

| # | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| 1 | blocker | The completion subject digest includes `work_item_version`; a blocker command in Review/QA makes bound Review/Evidence/Approval stale, so the QA part of BLK-AC-03 could not pass as written and D1 was not the only decision | Adopted. New "Why" row; D2 added (D2-a recommended: AddBlocker in Draft/Ready/Developing only; D2-b also Review/QA); ResolveBlocker in Review/QA documents the stale-subject consequence; BLK-AC-03 rewritten to the actual outcome (`active_blocker`, then `stale_subject`, recovery by RequestRework). Root also confirmed RequestQA does not check blockers and wrote the scenario through QA |
| 2 | blocker | Resolving on a Done item bumps the version and `loadDone` then finds no CompletionRecord → permanent storage corruption | Adopted. ResolveBlocker on Done → `invalid_transition` before blocker lookup; Canceled stays allowed; BLK-AC-02 updated |
| 3 | major | Detail attribution decodes every command result via `DecodeResultOwner`/`validOperation`; new rejection codes need `validRejectionCode` to be recordable | Adopted. BLK-03 lists `validOperation`, `validSuccessResult` (fields forbidden elsewhere), `validRejectionCode` and OpenAPI reasons; BLK-AC-03 asserts detail 200 with attributed blocker audit entries |
| 4 | minor | Bounds exclude corruption but not detail capacity (4 MiB wire, 1024 audit entries) | Adopted as wording: only corruption is excluded; capacity stays the shared typed limit. No extra total-bytes cap (proportionate) |
| 5 | minor | Off-by-one: the 1025th row is the refused one | Adopted |
| 6 | minor | Three inaccurate claims (store tests use Store methods; material-index reader checks only type/count/bytes; deferred fields are not in HAI-DEC) | Adopted; all three reworded |
| 7 | minor | Amend work-item-detail.md:19; resolve method must read `resolved_at_ns`; unknown-id 404 not recordable; cite the primary key for id non-reuse | Adopted |

No follow-up review was run: every change is a direct adoption of the reviewer's remedy, plus one root-verified
correction (RequestQA does not check blockers) that narrows the AC to source behavior. Raw prompt/result:
`~/test/backup/hai-blocker-20261102/review/` (owner-local).
