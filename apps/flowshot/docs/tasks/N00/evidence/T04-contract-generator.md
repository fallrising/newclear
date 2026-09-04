---
document_type: evidence
node_id: N00
task_id: T04
title: Contract authority, generation, and freeze evidence
recorded_at: 2026-07-29
result: pass
---

# T04 contract generator evidence

## Red

Before implementation, the apparent contract command accepted arbitrary
arguments but only printed the T02 placeholder:

```text
$ cargo run -p flowshot-xtask -- contracts --check
Flowshot repository tasks are introduced in N00/T04.
```

The zero exit was itself incorrect: no DTO, manifest, generation, drift check,
or frozen lock existed.

## Rust authority

The platform-neutral core now owns:

- `CommandContract` and deterministic `CommandDescriptor`;
- the single-object `EmptyRequest`;
- `BuildInfoDto`;
- the complete stable `AppErrorCode` set and safe `AppErrorDto`;
- `GetBuildInfo`, with the frozen name `get_build_info`.

Serde goldens prove the JSON names and shapes, including camel-case fields,
SCREAMING_SNAKE_CASE error codes, and omission of absent error details.
`ts-rs` derives TypeScript declarations from these same Rust types.

## Generated artifacts

`flowshot-xtask contracts` writes four files under
`src/generated/contracts/`:

- `types.ts`;
- `commands.ts`;
- `index.ts`;
- `manifest.json`.

The generated wrapper is the only frontend location containing the frozen raw
command string. Every file carries a generated marker where the format permits
one. No output includes an absolute checkout path.

## Freeze

`contracts/locks/N00.json` is frozen with:

```text
generator_version: 1.0.0
source_sha256: 30738b4dda81b4980983894b6ab965194dc995fbbcd482c02670a2beaf809af8
frozen_at: 2026-07-29T17:51:40+02:00
```

The digest covers each declared source path and its bytes in lock order.
`contracts --check` recomputes it and fails if the Rust source, generator
version, lock state, or generated output drifts.

## Green

```text
$ cargo test -p flowshot-core -p flowshot-xtask
flowshot-core: 5 passed
flowshot-xtask: 3 passed

$ cargo run -p flowshot-xtask -- contracts --check
contracts are current in src/generated/contracts

$ cargo run -p flowshot-xtask -- contracts --check-determinism --check
contracts are current in src/generated/contracts

$ cargo clippy -p flowshot-core -p flowshot-xtask --all-targets -- -D warnings
success

$ npm run build
success
```

The generator tests compare two isolated output directories byte-for-byte,
name a deliberately changed file, and reject absolute repository paths.

## Result

T04 passes. The N00 contract is genuinely frozen, Rust-authored, deterministic,
drift-checked, and consumable by TypeScript. Adapter integration remains T05.
