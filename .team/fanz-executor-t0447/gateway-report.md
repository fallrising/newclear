STATUS: DONE

## Summary

Bounded T-449 worker assignment delivered only the three assigned Rust files:
`apps/control-plane/src/main.rs`, `lib.rs`, and new `isolated.rs` under Fanzloud.
Root-owned HTML/JS were copied unchanged for compilation. Do not copy this worker's
older Agent Platform files back over the root's accepted live/review repairs.

`CODEBOX_MODE=isolated` selects the explicit Rust gateway. Unset or `p0` retains the
old P0 composition and pinned CLI contract; an unknown mode refuses startup.
Required configuration:

- `CODEBOX_LISTEN_ADDRESS`: listener SocketAddr for existing private HTTPS termination.
- `CODEBOX_PUBLIC_ORIGIN`: existing P0PublicOrigin HTTPS validation/canonicalization.
- `CODEBOX_AGENT_PLATFORM_ADDRESS`: literal127.0.0.1 and nonzero port only; no DNS,
  arbitrary host, IPv6 fallback, credential URL or redirects.

Exact proxy routes: session GET/POST/DELETE; projects/agent-profiles/runtime/tasks GET;
tasks POST; canonical UUID run detail/result.diff GET. Queries/absolute URI targets,
additional mutations, encoded path alternatives and arbitrary run suffixes refuse.
Only Content-Type/Cookie/Origin/X-CSRF-Token/Idempotency-Key are forwarded. Origin is
mandatory and exact for mutations; supplied GET Origin must also match. AP remains
auth/CSRF/idempotency/queue authority. No provider/node/connector secret is read here.

Request64KiB/response2MiB/header16KiB limits;5s request-body timeout;2s connect and
10s total upstream transport deadline. Blocking std TCP transport runs in spawn_blocking.
Duplicate/conflicting framing, transfer/content encodings, redirects and nominated
hop-by-hop response headers refuse. No retries. Unknown mutation responses return
502 `upstream_outcome_unknown`; read transport failures return `upstream_unavailable`.
AP Set-Cookie headers are preserved separately, including valid204 logout without
Content-Length. Root assets reuse existing CSS/favicon and receive no-store/nosniff/CSP.

## Verification

All final commands explicitly used the project-pinned Rust1.97.1 from repository root:

- `cargo +1.97.1 test --locked --manifest-path platform/fanzloud/Cargo.toml -p codebox-control-plane isolated --lib`:7 passed,0failed,0.05s — passed
- `cargo +1.97.1 clippy --locked --manifest-path platform/fanzloud/Cargo.toml -p codebox-control-plane --all-targets -- -D warnings` — passed
- `cargo +1.97.1 fmt --manifest-path platform/fanzloud/Cargo.toml --all -- --check` — passed
- `git diff --check`; copied HTML and JS byte-equal to root-owned assets — passed

Tests include actual local TCP request/response exchange (synthetic AP), exact cookie/
CSRF/idempotency forwarding, omission of unrelated authorization, duplicate Set-Cookie,
truncated mutation reply with zero second connection, response bounds/framing, HTTPS/
loopback configuration and asset security headers. No browser/provider/VM acceptance
is claimed by these tests; root owns the actual integration.

Preserved setup/RED history: first command lacked manifest-path (no build); restricted
sandbox denied shared sccache IPC (no test); approved local execution produced intended
RED because allowlist stub refused session. Initial stable toolchain7GREEN was not
accepted as pinned evidence; final tests/lint/format used explicit1.97.1. First Clippy
reported two collapsible-if findings, corrected before final pinned pass. Initial fmt
showed expected formatting differences; final formatted source passed. No dependency,
manifest, toolchain pin or safety check was weakened.

## Documentation

Root owns SPEC-M1-isolated-web.md, acceptance evidence, user operating steps and board.
Public Rust module/serve docs specify configuration, authority and secret boundaries.
`/api/v1/runtime` is the actual AP endpoint; nonexistent `/settings` is not admitted.

Frozen source SHA256:

- main.rs:cdb7436c02e047be91d27456d26ba5a872321a43d6a470ce550d93ce40b70b5f
- lib.rs:199e3724c59999d11e8136cc41ef505aa4eec5e381a07adea8b00a15457b4cdb
- isolated.rs:fcfd93937e6266f870969bdf2d9659cf5958f9f3547fc66798f90a5e3d4f2f39

## Risks and Follow-ups

Only fixed-length JSON/text AP responses and204 are supported; chunked/SSE/redirects
are deliberately refused. This is the agreed M1 composition, not a general reverse
proxy. TLS termination and AP origin must use the same configured public origin.
The gateway does not establish live task success, provider compatibility, VM isolation,
cleanup, durable intent recovery, or whole-platform completion. Root retains integrated
checks, independent review, real browser→Rust→AP→CLI→VM→diff evidence and Git delivery.
No provider invocation, host change, commit, push or nested agent was performed here.
