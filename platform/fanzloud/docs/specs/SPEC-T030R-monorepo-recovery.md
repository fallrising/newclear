---
id: SPEC-T030R
title: Monorepo recovery of accepted SQLite append and replay
status: verified
contract_units: [CU-EVT-01, CU-EVT-02]
module: repository
milestone: P1
depends_on: [SPEC-T030A, SPEC-T030B]
adr_refs: [ADR-0001]
risk: medium
---

# Responsibility and preserved contract

Recover archived commit `0a47dcd` into `platform/fanzloud` without changing the production
contracts in `SPEC-T030A` and `SPEC-T030B`. Those documents continue to own input bounds,
typed errors, security, E1 append, E0 replay, cancellation, retry and restart behavior;
this record introduces no additional runtime semantics. Snapshot-save atomicity remains
the unresolved T030D gap.

The event-store crate, Cargo manifest and lockfile, T030 task documents, specifications and
historical acceptance reports MUST match the archived source bytes. TD decomposition MUST
also match, except the seed table's T030 label may clarify that parent acceptance is pending
its children; this changes no graph edge, dependency or Contract Unit.
README, HANDOFF and traceability MAY change to distinguish historical acceptance from
current recovery evidence. Existing legacy-vnc_lab and fe-review files MUST survive.

# Test-first and provenance

Restore the normative specifications/task decomposition before production source. Retain
the substantive original skeleton failures and subsequent contract tests recorded in
`ACCEPT-T030A` and `ACCEPT-T030B`; do not invent a fresh red-green algorithm history.
Before restoration, invoking the focused package command must fail because the package
is absent from the monorepo workspace. Record the actual diagnostic externally.

# Root CI interface

`.github/workflows/fanzloud-ci.yml` MUST trigger for component/workflow changes on pull
requests and pushes to main, and support manual dispatch. It MUST use read-only contents
permissions, disabled checkout credential persistence, existing reviewed action SHA pins,
and `platform/fanzloud` as the run working directory. Pin Node `24.18.0`, Rust `1.97.1`
with rustfmt/Clippy, and cargo-deny `0.19.4`. Run the commands below. Cargo operations that
resolve dependencies MUST use the existing lockfile with `--locked`; rustfmt and Node do
not resolve dependencies. Installing the policy checker also uses `--locked`.

# Machine acceptance

From `platform/fanzloud`, with the specified toolchain:

```text
cargo test --offline --locked -p codebox-event-store --all-features
node --test --test-isolation=none apps/control-plane/web/p0-client.test.mjs
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
cargo test --locked --workspace --all-targets --all-features
cargo build --locked --workspace --bins --all-features
cargo deny --locked check
git diff --check
```

Acceptance also requires byte comparison to archived source, preservation checks for
monorepo-only files, root workflow inspection, and fresh-context review. Worker-focused
checks precede orchestrator full gates. Loopback/filesystem sandbox restrictions may
require an explicitly approved unrestricted rerun; retain both results. Do not weaken
tests or treat skipped/failed required gates as accepted.

# Evidence and acceptance boundary

`ACCEPT-T030R` records current integrated-tree evidence and the independent verdict.
Historical provider and hosted CI results remain historical. Root hosted CI is not
required before local acceptance, but its not-yet-run status MUST remain explicit.
Live provider smoke is outside this recovery; P1 foundation cannot depend on P0 provider
availability. T030R acceptance does not accept T030 parent or snapshot persistence.

TD §0.3 automated rustdoc/spec drift checking remains an existing project-wide gap. This
recovery preserves rustdoc and does not add or claim that generator/comparison gate.

Current local verification and independent acceptance are recorded in
[`ACCEPT-T030R`](../acceptance/T030R.acceptance.md) on 2026-10-04.
