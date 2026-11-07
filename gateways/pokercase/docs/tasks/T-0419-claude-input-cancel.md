# T-0419 Claude startup input cancellation

Desk-Task: T-0419

Started 2026-10-25T18:01:29Z; claim PR226 merged and read back before source edits. Scope/IC-1–IC-3 are fixed in [SUCCESS](../../SUCCESS.md#t-0419--claude-startup-input-cancellation). T-0418's future-drop cleanup is already delivered; explicit token cancellation during initial write was excluded and is this task's gap. No reinterpretation of its failed HTTP-abort experiment.

Design: reject pre-cancelled start/slot calls before touching reusable state or capacity. Race the initial write against cancellation with cancellation priority when both are ready. A cancelled partial write terminates the new child via existing stop(), then stops diagnostics; RAII releases owned directory and permit before returning499/non-retryable. No fresh-run retry after cancelled saved-session startup. Preserve ordinary write errors and healthy flow. A token that cancels just after a completed write is handled by existing reader cancellation; that later phase is not a new499 promise.

Estimate25–40active minutes;20minute checkpoints;commands/CI≤600s;initial reproduction plus two reasoned fixes per issue. Source reviewer6+2min,ledger3+1min. Root owns implementation/integration/native gates/publication; reviewers report only with no nested delegation. Complete tool/provider/token/cost/active-wait totals unknown/null. No real provider/model/login/Docker.

Initial test plan (before implementation): pre-cancelled free/busy slot and start with existing waiting run; actual blocked initial write with tools/no-tools and SIGTERM-resistant fake child, large stderr, sibling preservation and subsequent healthy startup. Deterministic readiness witnesses and original failure retained. Full existing214test baseline validates healthy/error/reuse/cleanup behavior.

Initial fixture compile failed because collect() returns Bytes, not a Display value. Preserve that failure; parse the collected JSON before asserting the replacement text. This is a test-type correction, not behavioral RED or a product fix.

Behavioral RED: explicit token cancellation leaves initial stdin write pending for7seconds (exit101,7.04s). Minimum product fix adds pre-cancel admission guards and races first write against the token; cancellation stops/reaps the child and drain, then returns499/non-retryable. First corrected run passed the cancellation/cleanup assertions but the healthy replacement assertion used a Chat JSON path; collect() explicitly returns Anthropic Messages. Preserve that failure and correct the path to content[0].text. These two fixture corrections do not relax AC or timing.

## Local acceptance evidence

| AC | Result | Evidence |
| --- | --- | --- |
| IC-1 | PASS | `ic1_precancelled_slot_preserves_capacity_and_waiting_run`: free and busy cases preserve permit count and avoid evicting the waiting run. `ic1_precancelled_start_preserves_pending_tool_result`: unchanged waiting ID/pending payload, no new sink/buffer or stop. `ic1_precancelled_start_does_not_spawn_or_create_tool_files`: valid fake command never runs, no MCP directory created, slot available. Common start guard precedes idle/shelf mutation by inspection; no separate idle-state test is claimed. |
| IC-2 | PASS | `ic2_cancel_blocked_initial_input_reaps_child_and_releases_resources`: three actual-process sequences (tools, no tools, tools with ignored SIGTERM),1MiB input and pipe-sized stderr burst. PID readiness, no background reader and occupied slot establish the precondition. Explicit cancel yields fixed499/non-retryable; procfs disappearance, directory/sibling state and free slot are asserted before a real healthy replacement. Resistant child uses existing5second grace; test bound7seconds is unchanged from RED. |
| IC-3 | PASS | All218tests/18groups, including existing input-error502/retry, startup-future drop, tool/idle/session reuse and lifecycle tests. Healthy replacement in each new cancellation sequence returns Anthropic Messages text. Existing stop/drain behavior and no-retry-after-cancelled saved-session guard are preserved by source inspection. |

Four new tests, seven scenarios:2slot+1pending+1pre-spawn+3process sequences. Full218/18,fmt,Clippy,43contracts/six indexes PASS. Behavioral RED and both fixture corrections remain visible; they are not product passes. Independent final source review and remote CI/normal merge/readback remain publication gates.

Cancellation is observed at admission and during the initial write; it is not a general transactional guarantee against cancellation between synchronous checks. A token cancelling after write completion follows the existing reader path. No HTTP-disconnect detection or idle-resume input fix is claimed. Termination inherits stop()'s existing best-effort OS semantics and five-second grace; filesystem cleanup remains best effort. The added debug event is fixed `startup_input_cancelled` metadata only, with no input/token/body fields.

Commands (each test/build bounded by timeout600; existing shared CARGO_TARGET_DIR; exact local path retained only in private validation evidence):
- From workspace: cargo +1.99.0 test --locked --manifest-path wt/newclear/claude-input-cancel/gateways/pokercase/Cargo.toml --bin thinrouter ic2_cancel_blocked -- --nocapture. Initial fixture compile failure retained separately; behavioral RED exit101 at7.04s.
- Same manifest with --bin thinrouter ic -- --nocapture: initial post-fix16pass/1fail due wrong healthy-response JSON path, retained. Corrected focused --bin thinrouter claude_code::tests::ic -- --nocapture:4/4 PASS,5.34s.
- Same manifest without test filter:218tests/18groups PASS, zero failed/ignored.
- Same manifest cargo +1.99.0 clippy --locked --all-targets -- -D warnings: PASS5.06s; cargo +1.99.0 fmt --manifest-path ... -- --check: PASS.
- From product repository root: python3 scripts/check_project_success.py, python3 scripts/check_indexes.py and git diff --cached --check: PASS43contracts/six indexes and staged whitespace.
