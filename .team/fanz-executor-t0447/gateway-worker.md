ROLE: WORKER
AGENT: native Rust gateway worker (same bounded implementation slot)
ID: T-449
Goal: Implement explicit isolated-mode Rust HTTP gateway for approved Fanzloud M1.
Why: Real browser submission must traverse Rust control-plane to authoritative AP API, not a Node fixture.
Inputs to read first: Fanzloud AGENTS, SDD, SUCCESS and docs/specs/SPEC-M1-isolated-web.md in root worktree; apps/control-plane existing source/config/Cargo.toml. Parent T-0442 alreadyclaimed; T-0447PR343merged; EX02actualVMpassed.
Scope (may touch): Your existing isolated fanz-executor-worker-20261031 tree only platform/fanzloud/apps/control-plane/src/{main.rs,lib.rs,isolated.rs}; report .team/fanz-executor-t0447/gateway-report.md. Ask root before any other file. Root owns HTML/JS at web/isolated.html,web/isolated.js and docs.
Out of scope (must not touch): AP source alreadyintegrated; oldP0 behavior/frontend; dependencies/Cargo; host/provider; commits; delegation.
Definition of done:
- [ ] CODEBOX_MODE=isolated selects public async isolated::serve or composition using CODEBOX_LISTEN_ADDRESS, CODEBOX_PUBLIC_ORIGIN HTTPS validation and CODEBOX_AGENT_PLATFORM_ADDRESS literal127.0.0.1 SocketAddr. No new runtime dependency.
- [ ] Exact bounded proxy paths: GET/POST/DELETE /api/v1/session; GET /api/v1/projects,/agent-profiles,/settings,/tasks; POST /api/v1/tasks; GET /api/v1/runs/{UUID} and /api/v1/runs/{UUID}/result.diff. No additional mutations or arbitrary target/query. Root UI polls run detail; no SSE needed.
- [ ] Forward only Content-Type, Cookie, Origin, X-CSRF-Token, Idempotency-Key; preserve AP Set-Cookie response headers. AP same public origin handles auth. POST/DELETE require exact Origin in Rust too. Read-only auth/proxy errors typed/sanitized. Max request64KiB response2MiB; no redirects; bounded connect/read/write timeout; singleContentLength and no conflicting framing. AP JSON/text uses Content-Length; refuse unsupportedchunked rather than parseunboundedstream. std::net::TcpStream inside spawn_blocking is acceptable existingdepsonly. HTTP upstreamliteral loopback only.
- [ ] Serve / (root-owned isolated.html), /assets/isolated.js, /assets/p0.css, /favicon.ico with no-store/nosniff/CSP; rootcancreateplaceholderfilesforcompile. PreserveoldP0main behavior otherwise.
- [ ] Focused nativeRust tests proveallowlist/origin/framing/response/errorbounds. No fake E2Eclaims.
Verify with: cargo fmt --check / scoped cargo test -p codebox-control-plane isolated + clippyifappropriate. Sharedcaches,df beforelargebuild. Root ownsfullchecks/browserintegration.
Budget: About30min; oneassignment, noexternalmodel/subagents, oneevidencedrepairperscenario. Report API/config interface early, thenfrozenfilehashes. No write outside scope.
