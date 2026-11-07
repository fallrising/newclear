# T-0403 Direct JSON Responses

Demand: [desk T-0403](https://github.com/fallrising/desk/tree/main/tasks/T-0403-thinrouter-json-responses). Contract: [JR-1–JR-3](../../SUCCESS.md#t-0403--direct-json-responses).

Validate the direct JSON envelope before returning native bytes or converting to Chat/Messages. Preserve successful/incomplete content and explicit native background pending responses. Failed, cancelled and invalid envelopes use fixed errors; only known quota codes survive. Reuse existing error policy; do not change SSE or accounting.

Required evidence: RED/GREEN local HTTP matrix, native tests/fmt/clippy/docs/index/diff, independent review and required CI. No real-provider requests or credential file access.

## Local evidence — 2026-10-24

RED: `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml --test responses_e2e jr1_direct_json_failures_are_not_success` reproduced HTTP200/finish_reason stop with text from a status:failed response. After the common-reader fix, all74 new loopback HTTP journeys pass:54failure/quota cases,12success/conversion cases and8native background combinations. Failures assert one upstream attempt, fixed diagnostics and absence of upstream canaries; known quota codes remain. Native successes compare exact original JSON bytes including whitespace and opaque fields. Text/tool/usage and incomplete finish mapping are checked for converted outputs.

```sh
cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml
cargo +1.99.0 fmt --manifest-path gateways/pokercase/Cargo.toml --check
cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings
python3 scripts/check_project_success.py
python3 scripts/check_indexes.py
git diff --check
```

Observed:130 tests pass, fmt/clippy warnings-as-errors pass,43project contracts/index pass (6llms navigation files,0errors), diff pass. Shared Cargo cache used. Independent source review PASS. Required CI and publication are recorded in the [board](BOARD.md#t-0403--direct-json-responses) after source merge.

Limits: validates the envelope, not every nested output item. Literal background:true in native request and response only preserves a pending response; no background provider validation, retrieval/polling or cancellation endpoint is added. Non-2xx upstream handling, SSE, accounting, retries and timeouts remain outside this change. All tests use synthetic stored credentials and a loopback fake upstream; no actual Grok/OpenAI/Cursor request or host auth file read.
