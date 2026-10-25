# T-0418 Claude startup directory cleanup

Contract: [SUCCESS SC-1–SC-3](../../SUCCESS.md#t-0418--claude-startup-directory-cleanup).

Started 2026-10-25T16:30:59Z; claim PR219 merged before product edits. Early returns and startup future drop precede the old reader-only run_dir cleanup. Scope is ownership of newly created MCP directories; no historical sweep, session changes or stdin timeout/cancellation protocol change. AC fixed before RED.

Estimate30–45active minutes including delivery;20minute checkpoints;initial reproduction plus at most2reasoned fixes per issue;each CI/build/test≤600seconds;source review8+2minutes,ledger4+1minute. Complete tool/provider/token/cost/active-wait metrics unknown/null.

Validation: focused RED/GREEN, filesystem boundary and fakeCLI lifecycle tests, full locked Rust/fmt/clippy/contracts/index, independent source and ledger reviews, CI/normal merge/remote readback.

Test-method correction before rerun (SC-2 unchanged): aborting reqwest's HTTP client task did not demonstrate that the server startup future was dropped; the process witness timed out. Preserve this failure; do not claim blocked-stdin HTTP disconnect is fixed. Verify the promised startup-future drop directly by aborting and joining its owned Tokio task after a fake Python child signals it is not reading a 1MiB stdin input. HTTP input-error and healthy continuation remain integration coverage. The healthy fake emits another tool call on the next user turn, so assert that existing behavior instead of expecting a text-only reply. Initial failed log retained. Each issue uses its first reasoned test-method correction.

Full-suite failure retained (full-first-failed.log): healthy sequence timed out waiting for directory expiry. Inspection found the final turn still awaited a tool result, so MCP callback timeout could emit another completion and reset waiting_since concurrently with expiry. The intended SC-3 idle-expiry witness must finish the final tool call first. Correct the fixture sequence by returning its result and observing a healthy completed reply before the unchanged3second expiry check (configured idle2seconds). This changes the setup, not the timeout or product contract; no MCP timeout/session behavior fix in this slice. This is the second reasoned correction to the healthy-sequence test; no further attempts without new decision if it remains unresolved.

## Observed evidence

| AC | Result | Evidence |
| --- | --- | --- |
| SC-1 | PASS | `sc1_spawn_failure_removes_only_its_tool_directory`:2tool failures and1no-tools failure preserve503/retryable, sibling and slot; original RED retained. `sc1_partial_setup_and_existing_paths_keep_ownership_separate`:existing path rejected,3partial private-file setup failures remove only owned path. `sc1_initial_input_failure_removes_tool_files`:HTTP502 input failure, directory absent before return, PIDreaped, sibling intact andone-slot healthy replacement. |
| SC-2 | PASS | `sc2_dropped_startup_future_cleans_directory_child_and_slot`:1MiB input with fake Python child not reading; alive=0 proves reader not installed, permit held and directory present. Direct abort/join removes directory, child PIDdisappears andslot reacquires. This tests startup-future drop directly, not HTTP disconnect propagation or explicit token cancellation. |
| SC-3 | PASS | `sc3_tool_files_survive_continuation_then_expire`:3private0600files survive tool return and next user turn inoneprocess, then idleexpiry removes directory. Existing session/reuse/cleanup regressions remain green. |

208tests/18groups, zero failed/ignored.10newscenario iterations across5tests (3spawn+1collision+3partialsetup+1drop+1inputerror+1healthy sequence); event/file loops and request counts are not separately inflated. Partial setup is a deterministic guard/write_private unit failure, not injected through the production setup closure. Production ownership transfer is inspected. Filesystem removal remains best effort; no cleanup guarantee against OS errors or process crash. No historical sweep/session changes, runtime dependency/permission or liveprovider/login/Docker calls.

Commands (each build/test bounded to600seconds; shared CARGO_TARGET_DIR):
- From workspace: `cargo +1.99.0 test --locked --manifest-path wt/newclear/claude-startup/gateways/pokercase/Cargo.toml --bin thinrouter sc1_spawn_failure -- --nocapture` -> RED exit101:2directories instead of1preserved sibling.
- From workspace: `cargo +1.99.0 test --locked --manifest-path wt/newclear/claude-startup/gateways/pokercase/Cargo.toml sc -- --nocapture` -> first exit101 (HTTP abort witness/healthy fixture expectation), corrected exit0 including all5new tests. The broad substring also selects existing regressions.
- Final corrected suite from workspace: `cargo +1.99.0 test --locked --manifest-path wt/newclear/claude-startup/gateways/pokercase/Cargo.toml` -> exit0, full suite below. The first full run used the relative component manifest from product root and failed the final tool/idle setup, preserved separately.
- From product worktree root: `cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings` -> exit0; `cargo +1.99.0 fmt --manifest-path gateways/pokercase/Cargo.toml --check` -> exit0.
- From product worktree root: `python3 scripts/check_project_success.py` -> exit0,43contracts; `python3 scripts/check_indexes.py` -> exit0,43contracts/6navigation indexes; `git diff --cached --check` -> exit0 including added task document.

Source review, requiredCI, normal merge/readback and board/journal/desk closure are publication gates. Complete tool/provider/token/cost/active-wait totals unknown/null.
