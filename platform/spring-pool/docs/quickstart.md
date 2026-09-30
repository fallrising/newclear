# Local quickstart

Status: development checkpoint. The dependency installation and toolchain commands below were executed during preparation; API/frontend/runtime tests are not yet complete. Do not treat this page as proof of a deployed service.

From `platform/spring-pool`, use Node 24.18.0, Rust 1.98.1 and the wasm32 target:

```sh
rustup target add wasm32-unknown-unknown
cargo install worker-build --version 0.8.7 --locked
npm ci
npx playwright install chromium
```

`worker-build` requires OpenSSL development headers on Linux. Preparation used a dedicated tool cache with matching distro headers/static libraries because the host did not have them; no system package was changed. `npm install --ignore-scripts --no-audit --no-fund` and Wasm target/worker-build installation passed. Chromium installation completed, but normal sandbox launch failed on this development host; no browser pass is claimed. `npm ci` remains to be verified on this checkpoint.

The planned local checks are:

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

These are pending implementation, not passing results. `test:local` runs dedicated local D1 migrations and starts two local Workers on loopback ports 8817 (web) and 8818 (API), then executes contract/integration tests and browser journeys. It refuses occupied ports and only stops processes it created. Local synthetic state persists under `.wrangler/test-state`; no cloud credentials are passed. A user running `dev:tests` can inspect the local app until stopping the command.

`npm run test:local:api` starts only the API Worker and runs the same API contracts plus seed→restart→verify persistence checks. It does not start the frontend or browser and cannot establish service-binding or UI behavior. This mode has a child-process fixture regression; real Workers execution remains pending.

Cloud staging is a separate operator action after independent review and evidence checks. Never place an API token in Worker configuration, application code or model input. The API must have no public route, workers.dev endpoint or preview URL. Access identity verification remains fail-closed until the operator supplies the staging team domain, audience and owner identity.

No deployment, release, acceptance or automatic recovery is established by these commands. Runtime receipts, exact revisions and open findings will be added after execution.
