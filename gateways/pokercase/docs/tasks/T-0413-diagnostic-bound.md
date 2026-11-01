# T-0413 Bounded HTTP diagnostics

Demand: [desk T-0413](https://github.com/fallrising/desk/tree/main/tasks/T-0413-thinrouter-diagnostic-bound). Contract: [DG-1–DG-3](../../SUCCESS.md#t-0413--bounded-http-diagnostics).

## Verification — 2026-10-25

RED: `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml dg1_dg2_http_diagnostics -- --nocapture` timed out after2s when a400upstream sent65537bytes and stayed open. Existing resp.text waited for EOF instead of enforcing a bound. One product correction makes the initial216HTTP cases pass. Original RED retained.

New diagnostic collection checks each actual chunk before copying, retains at most65536raw bytes, accepts exact-limit bodies at EOF and ignores Content-Length. Oversize replaces the entire body with `upstream error body exceeds 64 KiB`; no partial prefix is returned. Owned source and partial input drop before result delivery. Read failure still yields an empty diagnostic; text decoding uses the existing UTF-8-lossy behavior. Raw limits do not cap decoded/escaped/parsed output or allocator/transport memory.

Three forwarding branches use cancellation-aware diagnostic reads before generic failure, borrowed401 reread or importedOAuth401 refresh. Cancellation is499/non-retryable, matching pre-header send cancellation; original HTTP statuses and retryability/fallback/cooldown/refresh control remain otherwise unchanged. An oversize400 stays400 and does not fall back;401/429/500 can still recover. Borrowed credentials are still owned by the CLI, reread only and retried at most once.

xAI/Google refresh failure uses the same bounded reader and keeps401 plus existing provider prefix. SIWC non-success token responses are bounded before JSON error-code selection; oversize uses the fixed diagnostic after its existing status prefix. Valid small/exact string/nested codes, malformed/invalid-UTF8 unknown_error fallback and successful token parsing retain their behavior. This shared SIWC token failure path also serves authorization-code exchange; no interactive login or real token endpoint was exercised.

Added285scenario iterations across5tests:13collector cases (10empty/small/limit-1/limit/limit+1 ×single/fragmented boundaries,2UTF8 cases,1partial read failure);2pre/mid diagnostic cancellations with drop witnesses;10xAI/Google failure-helper cases;14SIWC loopback token cases;246gateway HTTP cases. Gateway matrix is216status/body/client/auth/stream cases plus12fallback,9borrowed stale/rotated/twice-rotated and9silent diagnostic client-disconnect cases. HTTP statuses400/401/429/500, allthree clientAPIs, streamfalse/true and generic/GrokOAuth/SIWCOAuth forwarding are exercised. Imported OAuth fixtures lack refresh tokens; they prove failed-refresh return behavior, not a live successful OAuth rotation. Existing stale-caller rotation and source review cover unchanged refresh control.

The expanded recovery fixture initially used auth.json without its required .grok parent and therefore correctly failed the borrowed-login hint assertion. Corrected only the synthetic fixture path to .grok/auth.json; no product rule or assertion was weakened. This failed run is retained. Corrected246HTTP matrix passed0.92s. Oversize and silent sources remain pending; drop notifications must arrive within2s. Borrowed rotation verifies one recovery retry; repeated rotation verifies the two-attempt ceiling and preserved hint; the synthetic refresh token remains unchanged.

```sh
cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml
cargo +1.99.0 fmt --manifest-path gateways/pokercase/Cargo.toml --check
cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings
python3 scripts/check_project_success.py
python3 scripts/check_indexes.py
git diff --check
```

Full native suite177tests/18groups,0failed/ignored;fmt/clippy warnings-as-errors,43contracts/6llms indexes and diff check PASS. Existing172tests remain green. Initialclippy rejected a new test err().expect assertion; changed it to expect_err and the targeted cancellation test plus finalclippy pass. Originallint failure retained; no product behavior or validation relaxation. Independent source/final-document review PASS with no unresolved blocker; requiredCI/merge/readback remain publication gates.

Limits: raw diagnostic input only; transport chunks, decoded text/JSON expansion, allocator/RSS and successful token response parsing remain separate. Existing within-bound diagnostic text/error codes can still contain upstream content; this change does not claim universal error redaction. No new auth/lock/deadline/retry budget/dependency/permission/provider/Docker/login/release/deploy behavior or whole-product acceptance.

Next separately scoped step: assess successful token-endpoint response collection bounds; not started.
