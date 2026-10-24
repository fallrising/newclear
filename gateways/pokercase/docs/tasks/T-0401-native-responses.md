# T-0401 Native Responses completion

Demand: [desk T-0401](https://github.com/fallrising/desk/tree/main/tasks/T-0401-thinrouter-native-responses). Contract: [NR-1–NR-3](../../SUCCESS.md#t-0401--native-responses-completion).

Native passthrough currently closes silently at EOF. Preserve complete accepted raw SSE frames and validate the first terminal; emit a fixed error for incomplete streams. Bound pending frames to 16 MiB. No dependency, permissions, login or real-provider changes.

Verification gates: focused RED/GREEN; framing, terminal and local HTTP regressions; full Rust/fmt/clippy/project-success/index; independent review; PR CI/merge/readback. Existing full-client and live-provider gaps remain in SUCCESS.

## Local verification — 2026-10-24

RED: `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml --test responses_e2e nr1_native_eof_emits_error` failed on empty upstream (no error event). After implementation, the regression passes for six missing/malformed-terminal HTTP cases.

GREEN commands (shared Cargo target directory used locally):

```sh
cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml
cargo +1.99.0 fmt --manifest-path gateways/pokercase/Cargo.toml --check
cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings
python3 scripts/check_project_success.py
python3 scripts/check_indexes.py
git diff --check
```

Observed: 122 tests pass; formatting and warnings-as-errors pass; 42 project contracts and navigation/index pass. Eleven new local HTTP cases cover six invalid/missing terminals and five valid/finality cases. Unit coverage verifies LF/CRLF/CR, initial UTF-8 BOM, arbitrary byte fragmentation, multiline data, opaque fields, partial tools, sequence bounds, a 16 MiB pending-event bound and upstream release without waiting for EOF after a complete LF terminal. First terminal wins; complete native upstream errors remain unchanged, while gateway-generated failures use fixed text. No runtime dependency or permissions changed.

Independent source review: PASS after R1 fix and focused reread. Remote CI/publication pending. Source transport errors and stalls still use the existing body error; no real-provider or Docker rerun because this slice changes only HTTP native Responses framing. The whole-product acceptance gaps remain unchanged in SUCCESS.

CR lookahead: retain a pending CR until the next byte or EOF to preserve split CRLF. If the existing idle deadline arrives with a complete valid CR-only terminal, emit that original frame and close rather than returning a stall error. CR-only terminal delivery may therefore wait up to the configured stall window (minimum five seconds); other stalls retain the existing body error. Reviewer R1 reproduced the lost terminal with an upstream that stays pending, then the same body/drop regression passed after this fix.
