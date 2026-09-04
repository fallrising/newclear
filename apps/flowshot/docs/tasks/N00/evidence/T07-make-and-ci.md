---
document_type: evidence
node_id: N00
task_id: T07
title: Make and CI gate evidence
recorded_at: 2026-07-29
result: pass
---

# T07 Make and CI gate evidence

## Red

Before implementation:

```text
$ make ci
make: *** No rule to make target 'ci'. Stop.
```

This demonstrated that the repository had no single mechanical gate and no
shared local/hosted-CI command surface.

## Gate design

The Makefile now owns these focused entry points:

- `make bootstrap`: installs the exact npm lock and fetches the Cargo lock;
- `make gen-contracts`: generates Rust-owned TypeScript contracts;
- `make check-contracts`: checks isolated deterministic generation and drift;
- `make check-boundaries`: enforces the transitive core dependency policy;
- `make ci`: runs SDD integrity, contracts, boundaries, Rust, frontend, and
  every native check supported by the current host.

GitHub Actions calls `make bootstrap` followed by `make ci`; it does not
maintain a second, weaker list of project checks.

## Local green

The documented bootstrap and repository gate were run with Node 24.18.0 and
Rust 1.97.1:

```text
$ make bootstrap
success

$ make ci
4 frontend tests passed
11 Rust/contract/boundary tests passed
lint, format, Clippy, production frontend build, contract drift, and SDD passed
native-ci: skipped; install the documented Tauri platform prerequisites
Flowshot CI passed
```

The local Linux host has no WebKitGTK development package, so the skip is
explicit rather than a fabricated native result. Native coverage comes from
clean hosted runners with the required platform libraries.

## Clean-checkout native green

[GitHub Actions run 4](https://github.com/fallrising/flowshot/actions/runs/30471328129)
completed successfully for all required jobs:

| Job | Result | Native coverage |
| --- | --- | --- |
| Ubuntu 24.04 | pass | Tauri test, strict Clippy, debug application build |
| macOS 15 Apple Silicon | pass | Tauri test, strict Clippy, debug application build |
| macOS 15 Intel | pass | Tauri test, strict Clippy, debug application build |

The workflow pins `actions/checkout@v6.0.2`,
`actions/setup-node@v6.4.0`, Node 24.18.0, and Rust 1.97.1.

## Failure-led corrections

Clean CI exposed issues that the local dependency-limited host could not:

1. an ignored Finder metadata file had entered the SDD inventory;
2. the native scaffold lacked generated application icons;
3. Tauri command registration crossed a macro visibility boundary;
4. strict native Clippy required a documented panic contract.

Each issue was corrected in its own pushed checkpoint. Run 4 proves the final
state from a new checkout on Linux and both supported Mac architectures.

## Result

T07 passes. The repository has one reproducible gate shared by local and hosted
execution. GUI launch and interactive cold-start timing are intentionally not
claimed here; they remain required target-Mac evidence for T08.
