# T-0386 — Converted stream completion

Demand: [desk T-0386](https://github.com/fallrising/desk/tree/main/tasks/T-0386-thinrouter-stream-completion). Scope/fixed SC-1–SC-3: [SUCCESS](../../SUCCESS.md#t-0386--converted-stream-completion).

Base `c1d37aadcd0ee4c20a671ebc9622a8333b4b731d`. Start approximately2026-10-24T10:36Z; claim merged before product edits. Expected25–35active minutes; checkpoint20active minutes, CI at most10minutes. Initial RED plus at most2reasoned corrections per failure. No realmodel/login/permission/deploy action.

Status: implementation and local verification complete; independent review PASS (2026-10-24T10:45Z). RemoteCI/merge/readback are publication gates tracked in desk/journal. Root writes source/spec/tests; bounded independent reviewer reads actualdiff/evidence. Plan: RED→GREEN converter/chain regression, localHTTPgateway tests, fullRust/fmt/clippy/docs, review, requiredCI, normalmerge/readback, journal/desk. Hosted model/tool/token/cost totalsunknown; product realmodelcalls0 planned. All-product acceptance remains pending.


Contract correction: old unit `responses::tests::stream_without_completed_still_finishes` required synthetic `finish_reason: stop` after only a text delta and EOF. Under SC-1 it must preserve the already-streamed delta, emit fixed error plus transport `[DONE]`, never synthesize a success finish and remain terminal on repeated EOF. First full suite caught this obsolete assertion (67unit tests passed/1failed); retained as `tests-initial.log`. Test is renamed `sc1_stream_without_completed_reports_failure` and strengthens those error/finality assertions; product expectation is documented, not weakened to match accidental output.


## Verification (2026-10-24)

| AC | Evidence | Observed result |
| --- | --- | --- |
| SC-1 | `proxy::stream_completion_tests::sc1_premature_eof_in_all_converters_and_chains_is_failure`: six conversion paths, empty/partial text+tool inputs, byte-fragmented UTF-8; corrected `responses::tests::sc1_stream_without_completed_reports_failure` | PASS; fixed error, no successful completion or tool-arguments.done |
| SC-2 | `sc2_completed_and_limited_streams_remain_terminal`, `sc2_explicit_errors_and_responses_done_are_not_success` | PASS; success/length/usage retained across six paths, finish_reason-only Chat accepted, repeated EOF empty, explicit error final, bare Responses DONE rejected |
| SC-3 | `tests/stream_completion_e2e.rs::sc3_http_chat_upstream_completion_contract`: seven input cases × Messages/Responses HTTP clients | PASS14local HTTP journeys; truncated text/tool/empty fail, normal/length/tool-finish without DONE and explicit Chat DONE preserve outcomes |

Commands from repo root; cargo test/clippy use shared the operator-provided shared `CARGO_TARGET_DIR` (exact local location retained in private evidence):

- `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml sc1_premature_eof_in_all_converters_and_chains_is_failure`: originalRED failed, showing `{` tool arguments marked completed; after the production fix the focused regression passed (`red.log`, `green.log`).
- `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml`: first full run67unit pass/1fail due to the explicitly corrected old contract above (`tests-initial.log`). Final run107tests passed/0failed/0ignored, including existingCursor/Claude/Responses/cost-security regressions and14new localHTTPjourneys (`tests.log`).
- `cargo +1.99.0 fmt --manifest-path gateways/pokercase/Cargo.toml --check`:PASS.
- `cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings`:PASS (`clippy.log`).
- `python3 scripts/check_project_success.py`:42contractsPASS; `python3 scripts/check_indexes.py`:PASS; `git diff --check`:PASS. Staged whitespace gate still required beforecommit.

Logs/review remain in the private T-0386 evidence record referenced by desk/journal. This slice does not change Docker/CLI execution or isolation; no new Docker canary or realprovider smoke was run/needed. Existing runner tests remain in the full suite. Native passthrough and buffered HTTP are excluded, not asserted safe by converted-stream coverage. Already-sent HTTP200 headers and text cannot be retracted; failure is expressed by protocol events. Remote CI, independent review and merge/readback remain separate required publication gates.

Independent source/evidence review: PASS. A publication hygiene finding moved machine-specific paths out of this public task into private evidence. No remaining product blocker.
