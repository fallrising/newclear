# T-0428 — Buffered cost completeness

Desk: [T-0428](https://github.com/fallrising/desk/tree/main/tasks/T-0428-thinrouter-cost-completeness). Claim PR253 merged `cca63e755a8c23a3e657ba888c30bf14f0afb663`. Baseline `98dbeaf35ba92d51e31df315939e271db6bb35e3`. Started 2026-10-27T16:48:22Z.

## Fixed acceptance

- CE-1: Given buffered Chat/Responses fake HTTP responses with absent, null or invalid token counts, when any of the three client APIs records usage, then SQLite and per-event JSON/CSV preserve unknown counts and estimated cost as null/empty; rendered event cost is unknown. Observe raw upstream usage before client conversion. Prove baseline persistence with isolated synthetic data before changing runtime. Antigravity raw-count parsing is covered offline; its HTTP persistence remains unverified after the explicitly recorded validation-method correction.
- CE-2: Given the existing two-rate estimator, when either count or configured rate is absent/invalid, then no complete estimate is recorded; when both counts and both finite nonnegative rates are explicit, including zero, preserve the existing arithmetic and known-zero value. Caller response conversions/content/status, dispatch counts, failed-attempt nulls, fallback and native streaming remain unchanged. No historical-row migration.
- CE-3: Given the bounded final diff, then focused RED→GREEN, full locked Rust1.99.0 tests/fmt/Clippy, repository contracts/indexes, independent source/evidence and ledger review, required CI, normal merge/readback and board/journal/desk/verified-backup/cleanup pass. Preserve original failures and unexecuted boundaries.

## Data flow and design

`forward_chat_completions` owns the raw body kind; `read_forward_body` validates/reassembles native Responses before conversion. The three buffered forwarding branches currently extract usage after client conversions that can synthesize zeros. `estimate_cost` also substitutes missing completion/rates with zero. `Store::log_usage` directly inserts nullable fields; recent_usage JSON, CSV and the event cost cell already preserve null. Aggregate totals and token presentation still conflate unknown/zero (D-04), outside this slice.

Retain upstream usage separately before converting response bytes, using each existing wire format's count fields. Do not change caller payload conversions. Preserve missing/invalid nonnegative-integer counts as null. Require both observed counts and both configured finite nonnegative rates, including explicit zero, before the existing f64 calculation; reject nonfinite result. No claim of provider billing completeness, new decimal arithmetic, status/schema, pricing revision or terminal observer implementation. CLI log paths already set cost null and streaming paths are untouched. Existing fallback error recording remains fixed-code D-06.

## Execution and evidence

Estimate60–90 active minutes including integration/review/delivery;20minute checkpoints, up to2 justified correction/diagnosis attempts per initial failure;600s commands/CI bound. Whole-turn active/wait/tool/provider/token/cost metrics unknown unless directly observed. Opus→oneSonnet source analysis (240s, no filesystem/shell access) recommended D-05; lead rejected leaving conversion-zero masking and rejecting explicit-zero prices. Helpers supply advice; root owns integration/delivery.

Planned tests: all3 client APIs × Chat JSON / Responses JSON / forced Responses SSE reassembly; missing/null/invalid and explicit-zero counts; missing/zero/known rates; actual per-event SQLite/JSON/CSV/HTML. Focused numerical validation also covers negative/nonfinite rate and overflow. Full existing fallback/stream/error tests remain required. No private database or real credentials were used. The unintended synthetic Antigravity request and its401 are retained below; no successful model response was observed.

Status: documentation established before runtime edits; baseline126cases completed with82per-surface mismatches (SQLite/JSON/CSV/HTML); same126cases and2unit tests passed after the minimal correction. Full gates and delivery tracked below. Original T-1102 and other milestones' tracked plans unchanged.

## Validation-method correction before runtime edits

The initial OAuth fixture read root id instead of connection.id and failed before completing the matrix. After that correction, the Antigravity fixture returned401: source providers.rs hardcodes its official endpoint and ignores the base override when constructing the forwarding URL. One unintended request carried only synthetic token/content to that endpoint; no real credential or successful model response. This is a retained test-boundary incident, not product RED. No repeat of that route.

To honor the original no-real-provider constraint, Antigravity coverage changes from HTTP persistence to offline body-kind parsing tests; the three other fake HTTP modes retain the full3client×14case persistence matrix. The HTTP fixture now routes shared reqwest through a non-forwarding loopback fake proxy. CE-1's buffered missing-value behavior remains fixed; Antigravity HTTP wiring is explicitly unverified. No URL override/product networking repair is included.

## Local result

CE-1/CE-2:126cases (3fakeHTTPmodes ×14usage/ratecases ×3clientAPIs), baseline82mismatches per SQLite/JSON/CSV/HTML surface, then identical fixture GREEN. The2newunit tests exercise invalid/absent counts, finite/nonnegative prices, overflow, explicit-zero prices and offline Antigravity envelopes. These are3Rusttests, not126separatetests.

`cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml`:250tests/20groups,0failed/ignored (90.282s commandwall). Same manifest fmt -- --check and Clippy --locked --all-targets -- -D warnings passed. `python3 -m unittest discover -s scripts/tests -v`:20passed; `python3 scripts/check_indexes.py`:44contracts/7indexes; `python3 scripts/check_project_success.py`:passed. Rust commands use the existing shared target/sccache with command-local CARGO_CACHE_RUSTC_INFO=0, avoiding replay of the previously observed failed metadata cache; no original EPERM root-cause claim.

Original fixture unwrap, unintended synthetic401, and dead-arm syntax errors remain recorded separately from genuine persistence RED. No claim that Antigravity HTTP, actual billing, aggregate coverage or overall product acceptance passed. Required independent review/CI/publication/ledger gates remain separate from these local results.
