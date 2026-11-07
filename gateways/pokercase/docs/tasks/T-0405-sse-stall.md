# T-0405 SSE stall

Demand: [desk T-0405](https://github.com/fallrising/desk/tree/main/tasks/T-0405-thinrouter-sse-stall). Contract: [ST-1–ST-3](../../SUCCESS.md#t-0405--sse-stall).

Provide a fixed SSE error at the existing idle deadline for six conversion paths and native Responses, release the source before final delivery, and preserve known terminal outcomes. Opaque passthrough keeps transport failure; no new framing, total/header/collector timeout, provider call or runtime policy. Publication follows in the task board after source merge.

## Verification — 2026-10-24

RED: `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml st1_st2_stalls -- --nocapture` failed with a TimedOut HTTP body error instead of a protocol error. The focused test passed after the fix. Timeout handling now finalizes each converter with a fixed diagnostic while preserving its existing terminal rules, and explicitly drops the source before yielding. Native Responses retains sequence tracking and CR-only terminal lookahead; partial buffered records are not copied into errors.

Final coverage adds77scenarios:21empty/partial/unfinished-record cases across six converters and native Responses;2minimum/reset timing cases;42known terminal cases (seven paths ×success/incomplete/failure ×text/tool);12real loopback HTTP stalls across three APIs and two upstream formats, each with empty-content/partial-content phases. The HTTP matrix also confirms source-drop notifications and preserves opaque passthrough transport failure. Existing client-disconnect, session/reuse, CR-only and completion regressions stay green.

The first full run failed a new test's expectation: a fixture containing tool calls was incorrectly expected to finish with ordinary stop/length. Existing tool_calls/tool_use precedence was inspected, then the test was expanded to explicit text/tool groups with exact established mappings. The original failure is retained; production terminal semantics were not changed to satisfy it.

```sh
cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml
cargo +1.99.0 fmt --manifest-path gateways/pokercase/Cargo.toml --check
cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings
python3 scripts/check_project_success.py
python3 scripts/check_indexes.py
git diff --check
```

Observed:138tests across12groups pass;fmt/clippy pass;43project contracts and6llms navigation files pass;diff passes. Virtual-time tests use existing test features without new dependencies. No real provider/Docker/login smoke; upstream read-I/O errors, non-stream collectors, header waits and total request duration are outside this scope. Idle timing counts every received chunk, including heartbeat bytes, and starts when the downstream body is polled. This does not impose an independent background cancellation timer on a client that stops polling before the deadline.

Independent source review PASS with no blocking rework. HTTP tests use Chat/Responses upstreams; Anthropic-source conversion is covered by adapter tests. Publication and remote readback remain separate gates.
