# T-0414 Successful token response bounds

Demand: [desk T-0414](https://github.com/fallrising/desk/tree/main/tasks/T-0414-thinrouter-token-bound). Contract: [TK-1–TK-3](../../SUCCESS.md#t-0414--bounded-successful-token-responses).

Design: xAI/Google currently deserialize a reqwest body directly; SIWC first deserializes to Value and then TokenResponse. All token persistence follows successful parsing. Introduce a separate bounded raw token collector and preserve those parse/update boundaries.1MiB is a conservative local choice, not copied from the diagnostic/model collectors or inferred from measured providers. Count the entire response including ignored fields and trailing whitespace. Fixed overflow error keeps provider context and existing failure classification (xAI/Google Internal; SIWC error, mapped to401 by refresh_connection).

Expected effort45–60active minutes including delivery;20minute checkpoints, initial failure plus at most2reasoned corrections per issue, eachCI≤10minutes. Source review8+3minutes; ledger review4+1minutes. Unmetered tool/provider/token/cost/active-wait totals unknown/null. No realprovider/login calls. Original failed checks retained. Native verification and independent source/final-document review passed; publication gates pending.


## Verification — 2026-10-25

RED: `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml tk1_tk2_successful_token_http_bound -- --nocapture` failed after2seconds: a successful SIWC response contained valid token JSON plus whitespace beyond1MiB and stayed open. The prior reader waited for EOF. After the bounded collector was wired, all14HTTP cases passed, covering refresh_token and authorization_code request shapes, small/exact/over, optional/missing fields, malformed JSON and invalid UTF-8. Oversized HTTP sources are observed closing within2seconds.

Added48scenario iterations across6tests:12collector boundaries/fragmentation/UTF-8/read-error cases,2pending-future drop cases,16xAI/Google success-helper cases,3direct store preservation/rotation cases,14SIWC HTTP cases and1SIWC read-error helper case. The collector retains ownership after EOF in its witness, proving destruction before return. Exact-limit sources that remain open still wait for EOF; dropping their future frees the source. Oversize sources remain open, proving rejection does not drain them. Helper Responses declare a misleading Content-Length=1, while the collector counts actual chunks. This is an in-memory header-independence test, not malformed HTTP-wire coverage.

xAI/Google share the same typed parser as before after collection; token fields/optional values and expiry arithmetic are preserved. Parse/read failures keep Internal classification and existing provider context; detailed parser/transport messages are replaced with fixed safe reasons. SIWC keeps its Value-to-TokenResponse conversion and read/malformed fallback through Null. Non-success diagnostic branches are unchanged and their existing tests pass.

Token update evidence: inspection of refresh_connection shows every provider's fallible read/parse completes before the single update_oauth_tokens call, while holding the existing connection lock. Therefore an overflow/read/parse error returns before writing credentials. The new store regression directly verifies rotation together and preservation of absent/empty refresh tokens and absent expiry; the existing stale-caller test verifies reuse of already rotated credentials. These are not an integrated fake-provider failed-refresh persistence test. ensure_fresh still falls back to existing credentials, and401 recovery/borrowed credential rules are unchanged. Rejecting a response leaves local credentials unchanged but cannot undo any rotation already performed upstream; no live rotation recovery is claimed.

```sh
cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml
cargo +1.99.0 fmt --manifest-path gateways/pokercase/Cargo.toml --check
cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings
python3 scripts/check_project_success.py
python3 scripts/check_indexes.py
git diff --cached --check
```

Results:183tests/18groups,0failed/ignored;all6focused tests;fmt/clippy,43contracts and6navigation files with0errors PASS. Original RED retained. A test insertion path error initially ran zero matching tests (not counted as RED); a moved-Bytes test compile error was fixed by cloning the test input without weakening the content assertion. An attempted HTTP read-error fixture failed before headers because hyper aborted the send: that case was replaced by a deterministic Response-body error against the extracted production SIWC success parser, preserving the valid-partial-JSON rejection assertion. The14HTTP cases remained. Internal reviewer assignment ID was corrected to the validator's3digit format. All failure evidence is retained; full-suite and final lint passed without failure.

Independent source/final-document review PASS with no unresolved blocker. RequiredCI/merge/readback remain publication gates. No liveprovider/login/Docker/release/deploy, no new dependency/permission or auth/deadline/retry/lock policy. The1MiB bound is retained raw input, not transport/RSS or parsed/decoded output. Whole-product acceptance and owner done remain separate. No additional milestone is started.
