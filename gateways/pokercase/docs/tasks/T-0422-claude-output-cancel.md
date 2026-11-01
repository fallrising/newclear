# T-0422 Claude active output cancellation

Demand: [desk T-0422](https://github.com/fallrising/desk/tree/main/tasks/T-0422-thinrouter-claude-output-cancel). Fixed acceptance: [OC-1–OC-3](../../SUCCESS.md#t-0422--claude-active-output-cancellation).

Baseline: `427f9cbd4b03dc1305d3125c6eac68e76895d9c3`. Claim PR235 merged before implementation as `311ef11b5ba91cdf4b553f30a012e79a215d7e88`. Owner explicitly requested the next source-supported lifecycle gap and full normal delivery. T-0414 and T-0418–0421 remain delivered; their evidence is not rerun as new work.

Baseline source findings before this change: first_reply handed off a ClaudeRun containing first/rx only; collect and into_stream did not observe the current token. Reader selects stop or closed receiver. finish_turn detaches its sender before publishing idle/tool reuse under the live lock. HTTP handlers construct CancelOnDrop and streaming paths disarm before returning the body. These facts support explicit active-output cancellation; they do not establish network-disconnect propagation.

Started 2026-10-26T10:32:34Z; estimated45–65active minutes including integration/review/publication,20minute checkpoints. Per issue: initial RED plus at most2reasoned corrections/diagnostics; commands/CI bounded600seconds. Source worker20+5minutes, source review8+3minutes, ledger review4+2minutes; no nested workers. Full usage/tool/provider/token/cost/active-wait metrics unknown/null unless separately observed with coverage. No real product provider calls.

Source implementation, focused checks and root complete native verification passed; independent final-document review and remote CI/merge/readback remain publication gates. Tests use isolated fake processes and local state; no credentials/provider/Docker. Original failures and exact commands will be recorded here. Completion preserves existing best-effort filesystem cleanup and termination grace; HTTP disconnect, global session/concurrency redesign and whole-product acceptance excluded.

## Design and focused evidence

A ReplyReceiver binds its WeakSender identity at channel creation for fresh, saved, idle and tool-result starts. ClaudeRun carries that original identity and current token through polled consumption. A biased check precedes the first buffered record and each receive; cancellation compares the original channel under the sink mutex used by finish_turn. An active match marks interruption and stops the selected run, closes the receiver to unblock producer backpressure, then awaits the existing cleanup latch before fixed499 or the existing stream error. A detached completed response ignores its old token and cannot target a later sink. Cursor retains first_record without this context.

The completed-turn send path also had a measured ownership bug: finish_turn detached its sink and exposed reuse before a backpressured terminal send. Dropping that old response caused the reader to exit and a newly installed continuation to receive retryable502. A completed-turn send failure now abandons only that obsolete send; an active-turn send failure still retires the run. No general concurrent-request protocol was added.

Original active-output RED: `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml --bin thinrouter oc1_cancel_active_collection_returns_499 -- --nocapture` exited101 after2.09s: actual first record delivered, token cancelled, collection remained pending until the2second test timeout. Initial GREEN0.04s.

Original completed-terminal RED: same command with `oc3_detached_terminal_drop_preserves_next_request` exited101 after0.09s: continuation received502/retryable after old-response drop. An earlier test-only E0382 moved-value compilation failure was retained and corrected by making timeout cleanup diverge; it is separate from the intended behavioral RED. The initial matrix passed6.33s and expanded OC checks passed6.32s. No failed production-fix attempt or relaxed runtime deadline.

Six new tests cover19primary scenarios: one minimal process cancellation;12process matrix iterations (fresh/saved/idle/tool × collect/stream8, SIGTERM-resistant collect1, full-channel stream1, fresh/idle drop2); one completed-terminal process race; one injected pre-handoff identity race; two injected queued-cancellation/latched-cleanup cases; two completed queued process replies (healthy/tool). Sixteen actual-process cases and three state injections; the matrix additionally checks12healthy replacements. Tool admission uses native mcp_call and a fixture gate, not the external helper/HTTP. Cleanup checks precede shutdown and include cleaned/PID/slot/live/session/shelf/owned-directory/sibling witnesses. Stderr cleanup follows the existing latch order, without an independent FD census.

The full Claude-focused command (filter `claude_code::tests::`) passed37tests in11.30s. The prior FR3 healthy/fallback control passed, then its setup was anchored to observed completed idle state before cancelling the old token so it cannot race the newly requested active-output behavior; the exact affected test passed0.28s. Historical T-0421 evidence remains scoped to its original pre-first-record work. This milestone deliberately extends cancellation beyond that handoff, without rewriting old evidence.

Cancellation is observed during polled collection/streaming, including pending receive. A retained response that is never polled has no new autonomous cancellation watcher. HTTP disconnect-to-token wiring, true provider compatibility, process groups and total RSS remain unverified/out of scope. Existing five-second grace and best-effort filesystem cleanup remain.

## Root native verification

All commands ran from the repository root with Rust1.99.0 and the shared target directory; each build/test command bounded600seconds.

```sh
cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml
cargo +1.99.0 fmt --manifest-path gateways/pokercase/Cargo.toml -- --check
cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings
python3 scripts/check_project_success.py
python3 scripts/check_indexes.py
git diff --cached --check
```

Observed232tests/18groups,zero failed/ignored;fmt and Clippy warnings-as-errors passed;43contracts/six navigation indexes passed. Source SHA256 `a27d9e29de9447a7baaf375dc8de418264e7cd80c3679c4905e932976f2b5168`. Native consumer/process tests establish explicit cancellation; unchanged cli_attempt classification is source-reviewed and existing converter/full integration regressions pass. No new HTTP cancellation-injection claim. Independent review and required CI precede merge; board publication records observed source/merge identities and time.
