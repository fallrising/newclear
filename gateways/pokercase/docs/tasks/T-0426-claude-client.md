# T-0426 Claude client continuation and Cursor Agent CLI documentation

Owner explicitly requests cursor-agent CLI naming, cancellation of the Docker product requirement, and Claude-first development using Magpie as a reference. Claim PR390 merged before product edits. Original17AC history and prior accepted live packets remain unchanged.

## Fixed scope before implementation

- NC-1: Current README/provider/client/security entries identify Cursor Agent CLI (`cursor-agent`), not the IDE. Record the no-Docker product decision as superseding the old execution requirement; preserve compatibility IDs and historical evidence. Explicitly distinguish the still-container-only runtime from the requested future behavior. No Cursor runtime migration in this Claude slice.
- NC-2: Compare current Claude continuation with Magpie pinned at `9c58c87e8f2d084a5bdb124f07cdf2f1f331864c`, specifically `internal/gateway/claude_subscription.go` and `internal/claudetui/tui.go`. Select the smallest source-backed faithful correction after a focused synthetic reproduction. Preserve every external instruction, correct tool ID/result association, conversation history, model/tool identity, cancellation and usage. Do not port unrelated Magpie features, strip instructions or relabel fresh-run fallback as native reuse. Record exact design/scenarios before code changes; surface any material policy conflict rather than silently weakening the contract.
- NC-3: Necessary focused/native regression and repository checks, independent review, required CI, normal merge/readback, journal/desk, separate complete backup and owned cleanup. No real provider/login/profile/privateDB access, Docker, dependencies or permission expansion. Prior live budgets remain closed; mainline incomplete/usable_tag none remain.

Estimate60–90active minutes plus bounded CI waits;20minute checkpoints, initial diagnosis plus at most2 reasoned corrections per issue. No artificial product RED for the documentation change. Stop after this selected scope. Whole-session tool/model/provider/tokens/cost/active-wait metrics remain unknown; scoped local checks are distinct.

## Reference and diagnosis

Magpie checks `run.follows(req.Messages)` before exact-ID tool delivery. Thinrouter's waiting-tool path currently checks IDs but bypasses the signature/history checks used by ordinary user continuation. Pinned source is evidence of mechanics, not vendor approval, cache savings or full client compatibility. Magpie's exact-ID path does not impose thinrouter's strict signature contract; retain the latter deliberately.

NC-2 selected design, before runtime edits: pass the resolved model into waiting-tool admission; require the unchanged model/instruction/tool signature, the existing normalized conversation as a prefix, and exactly one assistant tool-call message followed by the pending results. Assistant call IDs and result IDs must each uniquely cover the pending IDs. Reject mismatches before usage reservation or any waiting/callback/sink/history mutation; return normal no-match selection so a fresh run receives the complete request. Do not weaken cancellation or accounting failure behavior.

Regression scenarios: changed prior conversation, changed/appended instruction, changed tool definitions, changed model, missing/duplicated/incorrect assistant or result IDs, unrelated intervening messages; each rejection preserves the original waiting state and permits a later valid continuation. Existing callback/result arrival orders remain valid. A fake-TUI gateway case must prove altered history is sent to a fresh child and cannot reach the old callback, alongside existing same-child MCP success. No real provider calls.

This gate uses existing `norm` semantics (text, roles, call IDs and image counts), not byte-exact media or complete tool-call name/argument history identity. It does not change shelf hashes, instruction ordering, dynamic inline-context policy, tool remapping or tool definitions during a run. Those broader contracts and real-client acceptance remain open; no claim of all Claude work or original17AC completion.

## Implemented and locally verified

Waiting-tool admission now checks the resolved model/signature, known normalized history, exact suffix shape and unique assistant/result ID coverage before reserving usage or mutating pending state. Valid MCP delivery still reuses the same process. Changed history selects a fresh process with complete corrected context, and a subsequent valid result still reaches the original callback. Independent T001 diagnosis and T002 source/docs review accepted this bounded contract; their reports and exact logs are retained in the owner-private delivery packet.

Observed checks (Rust1.99.0, locked dependencies, shared build cache):

- `cargo +1.99.0 test --locked --bin thinrouter claude_code::tests::`:53passed. Genuine pre-fix regression failed at `accepted history`; compile/invocation failures were retained separately.
- `cargo +1.99.0 test --locked --test claude_tui_e2e`:11passed, including changed-context isolation and valid later recovery, same-child MCP, text/restart, streaming, failure and cancellation.
- `cargo +1.99.0 test --locked`:436passed in25groups; `cargo +1.99.0 fmt --check`, `cargo +1.99.0 clippy --locked --all-targets -- -D warnings` and `cargo +1.99.0 build --locked` passed.
- Component `python3 -m unittest discover -s scripts/tests -v`:199passed. `offline_walkthrough.py --check` and `named_http_walkthrough.py --check` passed with the retained new binary and owned synthetic fixtures.
- Repository `python3 scripts/check_project_success.py`:53contracts; `python3 scripts/check_indexes.py`:9indexes; `python3 -m unittest discover -s scripts/tests -v`:20passed. Final staged diff check required before commit.

Initial socket-denied sandbox runs and a missing shared-target environment setting failed before corrected offline runs passed; those failures remain visible in private logs, not relabelled product RED. No real provider/official CLI/profile was used. Required remote CI, normal merge/readback, journal/desk, separate complete backup and owned cleanup remain later gates at this source checkpoint. Original17AC and older board history remain unchanged; no whole-product/client/cache/account-safety acceptance.
