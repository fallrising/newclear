# T-0416 Claude stderr drain

Contract: [SUCCESS SD-1–SD-3](../../SUCCESS.md#t-0416--concurrent-claude-stderr-drain).

Started 2026-10-25T15:35:36Z. Current code reads stderr only after stdout terminates, creating a pipe-saturation deadlock. Retain first4096rawbytes while concurrently discarding excess; own and cancel the drain across input/run cleanup. Exact contract above is fixed before the RED.

Estimate35–50active minutes;20minute checkpoints;initial reproduction plus at most2reasoned fixes/issue;CI up to10minutes;source review8+2minutes andledger4+1minutes. Complete measurements unavailable are unknown/null.

Initial verification plan (results below): focused RED/GREEN, full locked Rust/fmt/clippy, contracts/index, independent source and ledger review, requiredCI, normal merge and remote readback. No live provider/login/Docker or RSS acceptance.

## Observed evidence

| AC | Result | Evidence |
| --- | --- | --- |
| SD-1 | PASS | `sd1_stderr_before_stdin_does_not_block_any_client_api`:6API/stream cases with1MiB input and1MiB stderr before input; `sd1_sd3_stderr_drain_survives_idle_and_tool_reuse`:2sameprocess follow-ups. |
| SD-2 | PASS | `sd2_prefix_bound_and_utf8_preserve_draining`:5sizes/3UTF8 cases; `sd2_open_stderr_wait_is_bounded_and_read_errors_release_source`:openpipe2secondboundedwait andreaderror; `sd2_sd3_stderr_failure_precedence_and_cancel_cleanup`:5exit/result/partial/overflow/cancel cases. |
| SD-3 | PASS | `sd3_stop_drop_and_cancelled_diagnostic_release_open_source`:3owned-source release cases; `sd3_failed_initial_input_reaps_process_and_releases_slot`:stdin error,PIDreap andone-slot replacement. Error/cancel cases also assertreaping/replacement;fullsuite retains expiry/shelf/disconnect regressions. |

27newscenario iterations across7runner tests,not27tests. Unit tests inspect retained prefix andowned-source release;14fakeCLI HTTP/lifecycle cases exercise actual loopback gateway andLinuxprocfs. Stderr stays separate from successful output; validUTF8 retains existing prefix/tail/status policy; malformed orboundary-splitUTF8 becomes replacementcharacters within the4096rawbyte prefix. A no-reply diagnostic can wait up to2seconds even if retainedprefix alreadyfull butstderrwriter staysopen. No process-group descendant termination, RSS, totalstderr throughput orliveClaude acceptance claim.

Commands from product worktree root, using the established shared CARGO_TARGET_DIR:
- RED: `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml --test claude_live_e2e sd1_stderr_before_stdin -- --nocapture` -> exit101,4second timeout;before implementation. Actual first invocation used workspace-relative manifest `wt/newclear/claude-stderr/gateways/pokercase/Cargo.toml`.
- GREEN: `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml sd -- --nocapture` -> exit0,6focused tests;then `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml --test claude_live_e2e sd3_failed_initial_input -- --nocapture` -> exit0,1test.
- `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml` -> exit0,196tests/18groups,0failed/ignored.
- `cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings` -> exit0,4.47seconds.
- `cargo +1.99.0 fmt --manifest-path gateways/pokercase/Cargo.toml --check` -> exit0.
- `python3 scripts/check_project_success.py` -> exit0,43contracts.
- `python3 scripts/check_indexes.py` -> exit0,43contracts/6navigation indexes.
- `git diff --cached --check` -> exit0,includingnewfiles.

Original RED and all outputs retained. No implementation/test failures after fix. A read-only progress probe attempted to read clippy.log before it existed;this was corrected by checking existence,not a lint failure. A read-only workflow lookup used the wrong filename; discovery located pokercase-ci.yml, with no test/commit impact. Source/ledger independent review,requiredCI andremote readback remain publication gates;owner done separate.
