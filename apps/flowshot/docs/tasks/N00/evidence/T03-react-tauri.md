---
document_type: evidence
node_id: N00
task_id: T03
title: React, Vite, and Tauri scaffold evidence
recorded_at: 2026-07-29
result: pass_with_platform_gate
---

# T03 React, Vite, and Tauri scaffold evidence

## Red

Before the scaffold:

```text
$ npm run build
npm error code ENOENT
npm error path /home/ckc/test/codex/flowshot/package.json
npm error enoent Could not read package.json
```

The first implemented test/build run then exposed missing `jest-dom` and Vite
CSS type declarations. Those dependencies and declarations were added before
the green run.

## Implemented boundary

- React 19.2.8 with a single accessible foundation shell.
- Vite 8.1.5 and TypeScript 6.0.3 with strict checking.
- Vitest 4.1.10 and Testing Library with one component test.
- Tauri CLI 2.11.4, Rust crate 2.11.5, and build crate 2.6.3.
- One main window and `core:default` capability only.
- A restrictive local-content CSP and no filesystem or HTTP permission.
- No remote runtime asset, product feature, database schema, Markdown parser,
  annotation UI, or legacy command.

The exact npm dependency graph is committed in `package-lock.json`; the Rust
dependency graph is committed in `Cargo.lock`.

## Green frontend and neutral Rust checks

A clean lockfile install and required frontend gates passed:

```text
$ npm ci --no-audit --no-fund
added 239 packages

$ npm run lint
success

$ npm run test
Test Files  1 passed (1)
Tests       1 passed (1)

$ npm run build
vite v8.1.5
16 modules transformed
success
```

The Rust workspace resolves four members. Format, core/db/xtask tests, and
Clippy pass when excluding the native desktop adapter:

```text
$ cargo metadata --no-deps --format-version 1
success (4 workspace packages)

$ cargo fmt --all --check
success

$ cargo test --workspace --exclude flowshot-tauri
test result: ok. 1 passed; 0 failed

$ cargo clippy --workspace --all-targets --exclude flowshot-tauri -- -D warnings
success
```

## Native host gate

The native adapter check was attempted rather than reported as green:

```text
$ cargo check -p flowshot-tauri
error: failed to run custom build command for `glib-sys`
The pkg-config command could not be found.
```

`tauri info` also reports `webkit2gtk-4.1` and `rsvg2` absent. This is the
environment limitation recorded in T01, not an application compile result.
Ubuntu CI must install the official Tauri prerequisite packages and compile the
adapter. macOS CI must compile the target platform; a real Mac launch remains
the T08 acceptance gate.

## Result

T03 passes its local scaffold gate. The locked frontend test/build and
platform-neutral Rust checks are green. Native compilation is explicitly
unverified until T07 CI runs on prepared Ubuntu and macOS hosts.
