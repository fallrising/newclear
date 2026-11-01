# T-0417 Claude event state bounds

Contract: [SUCCESS CF-1–CF-3](../../SUCCESS.md#t-0417--bounded-claude-event-state).

Started 2026-10-25T16:03:04Z. Existing per-line limits do not bound state accumulated across events. Fix only Claude EventFilter per-message retention and its failure cleanup;keep cross-message sessions/queues outside this scope. Contract fixed before RED.

Estimate40–55active minutes including review/delivery;20minute checkpoints;initial reproduction plus at most2reasoned fixes per issue;each CI/build/test command≤600seconds;source review8+2minutes,ledger4+1minute. Complete tool/provider/token/cost/active-wait metrics unknown/null.

Initial validation plan: focused RED/GREEN, boundary/HTTP/process tests, full locked Rust/fmt/clippy/contracts/index, independent source and ledger review, requiredCI/normal merge/remote readback. No real provider/login/Docker or RSS claim.

## Observed evidence

| AC | Result | Evidence |
| --- | --- | --- |
| CF-1 | PASS | `cf1_text_overflow_is_not_forwarded`:16MiB exact then over-limit delta suppressed and retained text cleared; `cf1_cf2_payload_boundaries_and_sticky_failure`:12below/exact/over cases for UTF8 text,arguments,id/name metadata,reason; `cf1_cf2_block_starts_include_ignored_and_replaced_indexes`:6type/index matrix cases and3production-cap rounds. |
| CF-2 | PASS | `cf2_interleaved_tools_moves_and_unretained_payload`:interleaved fragment completion,renaming,id preservation,exact cumulative16byte test budget,moves without refund,reset andunretained ignored/unmatched data;production4096cap accepts two healthy messages with reset. Existing text/tool/usage/session regressions pass. |
| CF-3 | PASS | `cf1_cf3_claude_event_state_http_and_cleanup`:18API/stream/phase cases (ignored blocks before output,after partial,exact4095ignored+1text); `cf1_cf3_streamed_text_state_overflow_all_apis`:3large-text stream cases; `cf3_claude_reused_and_completed_state_failure_is_not_shelved`:3idle/tool/completed cases. Linux PIDreaping,one-slot replacement andnoresume retry;cleanup source inspected. |

48scenario iterations across7runner tests:24unit (1+12+6+3+2) and24fakeCLI (18+3+3). Inner event/fragment loops are not separately counted. New abnormal-session cases verify no resume via starts/no resumes;they do not directly assert session-directory emptiness. Existing session deletion code is preserved and inspected. Real provider/session-file acceptance is not claimed.

16MiB is cumulative charged payload, not just reply text:tool-id copies/name and stop reason also consume it.4096counts all block starts including ignored/replaced indexes. Moving/removing state does not refund;healthy reset renews the allowance. Charges bound raw retained argument input,not parsed JSON allocation overhead. Request name mappings,cross-message sessions/known/announced state,queues,transport andRSS remain outofscope. Earlier downstream collector failure may precede this bound for large nonstream output;that existing behavior is preserved.

Commands, with shared CARGO_TARGET_DIR and600second test/build bounds:
- From workspace: `cargo +1.99.0 test --locked --manifest-path wt/newclear/claude-state/gateways/pokercase/Cargo.toml --bin thinrouter cf1_text_overflow -- --nocapture` -> intended RED exit101 (over-limit delta emitted);same command after fix -> exit0.
- From workspace: `cargo +1.99.0 test --locked --manifest-path wt/newclear/claude-state/gateways/pokercase/Cargo.toml cf -- --nocapture` -> exit0,7focused tests.
- From product worktree root: `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml` -> exit0,203tests/18groups,zero failed/ignored.
- From product worktree root: `cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings` -> exit0; `cargo +1.99.0 fmt --manifest-path gateways/pokercase/Cargo.toml --check` -> exit0.
- Workspace invocation: `python3 wt/newclear/claude-state/scripts/check_project_success.py` and `python3 wt/newclear/claude-state/scripts/check_indexes.py` -> exit0,43contracts/6navigation indexes. Equivalent product-root scripts documented in repository gates.
- `git diff --cached --check` in product worktree -> exit0 including added task document.

Original RED retained;no implementation/test failure after fix. Discovery rg found no matching task and returned1,stopping a read/setup chain;follow-up correctly separated that no-match result. Independent source/finaldocs review,requiredCI/normalmerge/readback andledger closure remain publication gates.
