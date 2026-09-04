---
document_type: evidence
node_id: N00
task_id: T05
title: Build-info vertical-slice evidence
recorded_at: 2026-07-29
result: pass_with_platform_gate
---

# T05 build-info vertical-slice evidence

## Red

The targeted frontend test did not exist before implementation:

```text
$ npm run test -- src/App.build-info.test.tsx
No test files found, exiting with code 1
```

The Tauri adapter also had no command module or invoke registration.

## Implemented slice

```text
React App
  -> generated getBuildInfo()
  -> generated "get_build_info" manifest name
  -> registered Tauri command
  -> flowshot_core::contracts::{EmptyRequest, BuildInfoDto, AppErrorDto}
```

The Rust build script injects version-control revision and Cargo profile at
compile time. `FLOWSHOT_GIT_SHA` can be provided by CI; a checkout-derived SHA
or controlled `unknown` fallback avoids an undeclared runtime dependency.

The command accepts the frozen single `request` object and returns the shared
`Result<BuildInfoDto, AppErrorDto>`. No duplicate DTO, filesystem, database,
clock, network, or raw command string was added to feature code.

The React shell now has typed loading, success, and safe error states. Tests
inject a typed loader, while production defaults to the generated wrapper.

## Green local checks

```text
$ npm run lint
success

$ npm run test
Test Files  2 passed (2)
Tests       4 passed (4)

$ npm run build
20 modules transformed
success

$ cargo test -p flowshot-core
5 passed; 0 failed

$ cargo run -p flowshot-xtask -- contracts --check
contracts are current in src/generated/contracts
```

The core serialization golden proves the exact JSON shape used by the command.
The native adapter unit test asserts the same shared DTO fields at its boundary.

## Native host gate

The newly authored adapter test was explicitly attempted:

```text
$ cargo test -p flowshot-tauri --no-run
error: failed to run custom build command for `glib-sys`
The pkg-config command could not be found.
```

This is the same prepared-host prerequisite recorded in T01 and T03. T07 must
run this test on Ubuntu after installing Tauri dependencies and on macOS.

## Result

T05 passes its executable local vertical-slice gate: generated frontend
consumption, loading/success/error behavior, frozen-contract drift, and shared
serialization are green. Native adapter compilation remains an explicit T07
runner gate rather than an unverified success claim.
