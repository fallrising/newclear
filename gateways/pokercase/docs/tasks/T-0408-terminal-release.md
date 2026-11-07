# T-0408 Terminal release

Demand: [desk T-0408](https://github.com/fallrising/desk/tree/main/tasks/T-0408-thinrouter-terminal-release). Contract: [TR-1–TR-3](../../SUCCESS.md#t-0408--terminal-release).

Release sources before final recognized terminal/EOF output. Preserve finish_reason-only usage tails, existing terminal/error semantics, CR lookahead and reusable Claude sessions. Opaque passthrough gains no terminal parser. No broader framing/deadline/collector/provider changes. Publication follows in the task board after source merge.

## Verification — 2026-10-24

RED: `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml tr1_terminal_releases -- --nocapture` failed because the native Responses success frame arrived while its source remained owned. Focused GREEN passed after the fix. Converter completion is now exposed through a read-only state query (both stages for chains); it is not inferred from finish_reason. Native/converted final frames and observed EOF drop the source before yielding. Trailing records after the first recognized terminal are no longer read.

Added85scenario iterations across five tests:42recognized terminals (seven paths ×three outcomes ×intact/one-byte chunks);21EOF cases (seven paths ×empty/partial/buffered-final input);6Chat usage-tail cases (two targets ×[DONE]/EOF/stall);1opaque byte/EOF case;15actual loopback HTTP terminal cases (five interpreted paths ×three outcomes). A custom stream retains its witness even after returning None, so EOF assertions establish actual adapter ownership release. Assertions inspect ownership at final-frame receipt before another consumer poll. HTTP sources remain permanently pending after final output, and the reply matrix must complete within3s against60s idle timeout, with source-drop notifications. No fixture completion or injected error stands in for terminal cancellation.

```sh
cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml
cargo +1.99.0 fmt --manifest-path gateways/pokercase/Cargo.toml --check
cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings
python3 scripts/check_project_success.py
python3 scripts/check_indexes.py
git diff --check
```

Observed:148tests/14groups pass;fmt/clippy warnings-as-errors pass;43project contracts and6llms navigation files pass;diff passes. Existing11Claude live-fixture tests, including idle/tool reuse and disconnect release, remain green. Existing CR-only terminal, read-error, stall and EOF semantic tests remain green. Original RED retained; one product fix, no repeated unchanged failure.

Limits: HTTP fixtures supply Chat/Responses upstreams; Anthropic-source conversion is adapter-tested. Opaque Chat/Messages do not gain a terminal parser, so bytes after a terminal-looking record still pass through until EOF. A native CR-only terminal still uses existing lookahead/idle handling. All processing remains consumer-poll-driven; this is not an independent background deadline or a real provider/Docker cancellation guarantee. No new dependency, permission, session-retention, retry/accounting, collector or framing policy. General buffering limits remain outside scope.

Independent source review and final documentation readback PASS with no blocking rework. Required CI, normal merge/readback and ledger publication remain separate gates.
