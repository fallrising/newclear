# T-0415 Bounded CLI stdout records

Demand: [desk T-0415](https://github.com/fallrising/desk/tree/main/tasks/T-0415-thinrouter-cli-line-bound). Contract: [LB-1–LB-3](../../SUCCESS.md#t-0415--bounded-cli-stdout-records).

Design: replace the two unbounded BufReader.lines readers with a shared cancellation-safe bounded line reader. Keep partial data on the reader across next_line cancellation; inspect fill_buf before copying, count raw bytes including CR but excluding LF, then preserve existing UTF-8/line normalization.16MiB is a local per-record envelope, not total memory or provider sizing evidence. Overflow is a known failure independent of stderr and must enter existing cleanup, not silently become EOF or success. Healthy Claude sessions remain reusable; corrupted overflow runs must not enter the resume shelf.

Estimate45–60active minutes including integration/review/delivery;20minute checkpoints;initial failure+at most2reasoned corrections per issue;CI≤10minutes;source review8+3minutes,ledger4+1minutes. Exact tool/provider/token/cost/active-wait totals unknown/null without complete meters. No realprovider/model/login calls. Native verification and independent source/final-document review passed; publication pending.


## Verification — 2026-10-25

RED: `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml lb1_lb3_claude_stdout_bound_http_and_cleanup -- --nocapture` failed after4seconds. The fake CLI wrote more than16MiB without newline/EOF and stayed alive; the old unbounded line reader never returned an error. The fixture guard killed only its exact fake process on failure. Original RED retained; no other implementation/test failure occurred.

The shared reader checks each fill_buf slice up to its first LF against remaining allowance before reserving/copying. CR counts as raw input and is stripped only before LF, matching prior line behavior; EOF preserves a final CR. Partial bytes live on the reader rather than a disposable next_line future. Oversize and read errors discard partial state; source ownership ends when the caller drops the reader. Error classification for existing I/O/invalid UTF-8 termination remains unchanged.

Both producers drop stdout before their existing cleanup. Claude retains the active sender across forgetting/stopping/removing the run so receiver EOF cannot masquerade as success; overflow clears the idle flag, preventing a corrupt run from entering the resume shelf. Child stop and run-slot release precede the fixed502 failure. Cursor skips stderr classification for a known overflow, kills/waits/reconciles through the existing policy, then releases the permit and sends the fixed error. No new timeout, retry or process-isolation policy is introduced. Healthy Claude sessions and Cursor first-terminal precedence remain unchanged.

Added75scenario iterations across6tests:
- Shared-reader tests:28raw boundary cases (0/1/limit-1/limit/limit+1, LF/CRLF/EOF, fragmented/single reads, excluding impossible zero-byte CRLF);3multi-line/UTF-8 compatibility sequences;1invalid-UTF8;1two-cancellation split-UTF8 scenario;3open-source/read-error cases.36unit scenarios across3tests.
- Actual loopback gateway plus fake CLI/runtime:18Claude and18Cursor cases across3APIs × stream/nonstream × before-output overflow/after-partial overflow/exact ignored line. Each oversized fixture stays open. Nonstream fails502 without partial output; streamed partial responses contain failure and no success terminal. Linux PID checks and fake Cursor named-container reconciliation verify cleanup; replacement requests succeed at max-runs1.
-3additional Claude lifecycle cases in1test: overflow on reused idle and tool-result turns, plus overflow after a completed response. The accepted response is not retracted; the corrupted run is reaped, not shelved/resumed, and a new request succeeds.

These are scenario iterations, not75test-runner entries. The source-drop fixture demonstrates logical retained ownership; allocator/RSS/transport buffers/JSON expansion/queue or filter-state bounds are not claimed. Cursor runtime is synthetic, not a real Docker acceptance test. Existing session/disconnect/terminal/HTTP/token regressions remain green.

```sh
cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml
cargo +1.99.0 fmt --manifest-path gateways/pokercase/Cargo.toml --check
cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings
python3 scripts/check_project_success.py
python3 scripts/check_indexes.py
git diff --cached --check
```

Results:189tests/18groups,0failed/ignored;fmt/clippy,43project contracts and6navigation indexes PASS. Independent source/final-document review PASS without blockers. RequiredCI/merge/readback remain publication gates. No realprovider/model/login/Docker smoke, dependencies/permissions/release/deploy changes or whole-product acceptance. Owner done remains separate. Next work must be separately scoped; queues, filter state and stderr were not addressed here.
