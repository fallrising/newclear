# T-0407 SSE read errors

Demand: [desk T-0407](https://github.com/fallrising/desk/tree/main/tasks/T-0407-thinrouter-sse-io). Contract: [IO-1–IO-3](../../SUCCESS.md#t-0407--sse-read-errors).

Redact read-I/O errors, report protocol failures for converted/native Responses, release owned source/error before final delivery, preserve parsed terminals and CR-only lookahead. Opaque passthrough keeps redacted transport failure. No broader framing, deadlines, provider/login or retry/accounting changes. Publication follows in the task board after source merge.

## Verification — 2026-10-24

RED: `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml io1_io2_read_errors -- --nocapture` reproduced a body error containing a synthetic sensitive URL instead of a protocol error. After the fix, `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml read_errors_` passed both focused tests. The source error is no longer formatted; explicit drop of error and upstream precedes final delivery. Converter finalization retains its existing terminal semantics, and native Responses accepts a fully delimited CR-only terminal before generating a read-error diagnostic.

Final coverage adds96scenarios across five tests:21unfinished streams through six conversions/native Responses;3opaque passthrough phases;42known terminal outcomes across text/tool fixtures;18native delimiter cases (three statuses ×three complete/three unfinished line endings);12actual loopback HTTP body failures across three APIs and two upstream formats. Error-format and drop witnesses prove that both owned objects are released before the final frame/error is consumed. HTTP failures are injected after downstream headers, and after observed content for partial-output cases; the five-second test bound is below the configured sixty-second idle timeout. No sleep-based failure injection or live model requests.

```sh
cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml
cargo +1.99.0 fmt --manifest-path gateways/pokercase/Cargo.toml --check
cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings
python3 scripts/check_project_success.py
python3 scripts/check_indexes.py
git diff --check
```

Observed:143tests/13groups pass;fmt/clippy warnings-as-errors pass;43project contracts and6llms navigation files pass;diff passes. Existing EOF/stall/disconnect/session tests remain green. The existing terminal test helper now runs both its original stall case and the added read-error case without changing terminal expectations. Original RED retained; no failed required check remains.

Limits: HTTP fixtures supply Chat/Responses upstreams; Anthropic-source conversion is verified by adapter tests. The upstream HTTP fixture drops after its injected body error; exact gateway source/error release ordering is established by adapter ownership witnesses. Generated I/O diagnostics are redacted, not upstream SSE data/errors that were already forwarded. Opaque partial bytes cannot be retracted. No provider/Docker/login acceptance, collector/header/total timeout changes, new idle policy, or guarantee of background cancellation without downstream polling. Normal non-error terminal/EOF release timing is outside this slice.

Independent source review and final documentation readback PASS; no blocking rework. Required CI, normal merge/readback and ledger delivery remain separate gates.
