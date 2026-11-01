# Local quickstart

The Rust/Wasm API, Hono SSR and real local D1/service-binding checks pass on the
reconciled candidate. Browser/visual evidence and CI status are recorded in
[the reconciliation report](evidence/pr196-reconciliation.md); staging and owner
acceptance are separate. These commands do not deploy a service.

From `platform/spring-pool`, use Node24.18.0, Rust1.98.1 and the wasm32 target:

```sh
rustup target add wasm32-unknown-unknown
cargo install worker-build --version 0.8.7 --locked
npm ci
npx playwright install chromium
```

`worker-build` requires OpenSSL development headers on Linux; Chromium requires
its platform libraries and a usable sandbox. The current development host lacks
both. Matching distro headers in shared user cache allowed worker-build to compile
without a system install. Local Chromium still reports no usable sandbox; do not
disable it to turn a required check green. The existing CI runner installs browser
dependencies and runs the same sandboxed tests.

Run the component checks:

```sh
cargo test --manifest-path api/Cargo.toml --locked
cargo fmt --manifest-path api/Cargo.toml --check
cargo clippy --manifest-path api/Cargo.toml --locked --all-targets -- -D warnings
npm run lint
npm run format
npm test
npm run build
npm run test:local
```

`test:local` applies migrations to dedicated local D1, starts loopback Workers on
8817(web) and8818(API), runs API/web contracts, restarts the API to verify exact
persistence/export, then runs desktop/mobile browser journeys and responsive
list/detail/step-editor evidence at1440,768,390px. It refuses occupied ports,
strips Cloudflare credential environment variables, and stops only its own
processes. Synthetic state persists under `.wrangler/test-state`; logs and
PNG/browser-health JSON are under `artifacts/`, browser failures under
`test-results/`. Inspect PNGs as well as deterministic browser-health results.

Useful narrower modes:

- `npm run test:local:integration`: both Workers, all API/web contracts and persistence; no browser claim.
- `npm run test:local:api`: API-only contracts and persistence; no web/service-binding claim.
- `npm run test:local:e2e`: both Workers, original browser journeys and responsive evidence.
- `npm run dev:tests`: keep the synthetic local pair available for manual inspection until interrupted.

For ordinary `npm run dev`, copy `web/.dev.vars.example` to the ignored
`web/.dev.vars` and set an explicit local owner identity. Local auth works only
with local environment and a loopback URL; never reuse it for staging.

Cloud staging is a separate operator action after review and evidence checks.
The earlier time-limited grant has expired. The API must have no public route,
workers.dev endpoint or preview URL. Access verification remains fail-closed
until the operator supplies the staging team domain, audience and owner identity
and protects the dedicated hostname. No token belongs in committed configuration.

Local tests and code merge do not establish live Access interoperability,
deployment, release, automatic recovery or owner acceptance.
