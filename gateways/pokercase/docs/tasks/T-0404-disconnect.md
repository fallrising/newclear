# T-0404 Client disconnect

Demand: [desk T-0404](https://github.com/fallrising/desk/tree/main/tasks/T-0404-thinrouter-disconnect). Contract: [DC-1–DC-3](../../SUCCESS.md#t-0404--client-disconnect).

Investigate active-turn cancellation after partial output and on reused Claude turns. Observe the current sink closing even during upstream silence; retain normal completed idle/tool sessions. Add local HTTP and fake Cursor resource-release evidence. No real-provider/auth or session-policy changes.

Required evidence: RED/GREEN, bounded release/one-slot reuse tests, full native checks and independent review; publication tracked by the board after source merge.

Process/reaping regressions use Linux procfs and are gated to Linux; loopback HTTP cancellation remains portable. Fake runtime checks model process ownership and named cleanup requests, not an actual Docker daemon.

## Local evidence — 2026-10-24

RED: `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml --test claude_live_e2e dc1_silent` failed because the disconnected silent process was still present after the three-second test deadline. The fixture's exact owned executable is killed on assertion failure; RED does not require a real account.

Fix: the Claude reader selects on its active sender's receiver closing, in addition to existing stop/first-request cancellation. Installing a continued-user or tool-result sink notifies the reader, so a previously idle reader observes the new receiver before another stdout line. Completed turns clear the sink and retain existing idle/tool reuse behavior. The sender snapshot only lives for one reader iteration.

Observed44new disconnect cases:6fresh Claude stream/collect requests across3APIs;2silent reused Claude turns (user/tool);24HTTP cases (3APIs ×2upstream formats ×stream/collect ×headers/body);12fake Cursor cases (3APIs ×stream/collect ×before/after output). Claude and Cursor cases also verify a replacement request succeeds with one run slot. Existing nine Claude session/reuse tests remain green. Exact process-reaping checks use procfs on Linux; HTTP uses source-drop notifications. Fake Cursor uses an owned PID plus a named cleanup-call witness, not a Docker daemon.

```sh
cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml
cargo +1.99.0 fmt --manifest-path gateways/pokercase/Cargo.toml --check
cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings
python3 scripts/check_project_success.py
python3 scripts/check_indexes.py
git diff --check
```

Final observed:134tests pass on Linux;fmt/clippy warnings-as-errors pass;43project contracts and6llms navigation files pass;diff passes. Shared Cargo cache used. An earlier134-test run preceded the explicit Linux gate and remains historical evidence. Independent source review PASS. Publication results follow in [BOARD](BOARD.md#t-0404--client-disconnect).

Limits: no real provider/login/Docker smoke; unchanged session retention, termination grace period, accounting, retries and permission model. Production code changes only Claude request-sink monitoring; HTTP and Cursor receive regression coverage.
