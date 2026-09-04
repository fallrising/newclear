---
document_type: test-plan
node_id: N00
status: draft
derived_from:
  - ../../../SPEC.md
  - ../../nodes/N00-foundation-ci-contracts.md
  - 00-implementation-plan.md
source_version: 1.0.1
source_sha256:
  SPEC.md: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
  N00: df7ce22a67b3262bc0324b04025fc11723065c03dd8345748f601083a60622be
  plan: bb4a5bdc4a1a100739c266cd342127a5e5dbac93675fae0a2490e65e2a8c5422
generated_at: 2026-07-29T15:47:01+02:00
owner: codex
---

# N00 Test Plan

## 1. BDD Mapping

| BDD | Test ID | Level | Fixture | Oracle | Command |
|---|---|---|---|---|---|
| Clean checkout bootstraps and passes all gates | N00-BDD-01 | integration/manual | fresh clone | zero exit, frontend build, launch evidence | `make bootstrap && make ci` |
| Rust contract drift fails with named files | N00-BDD-02 | integration/negative | disposable changed DTO | non-zero exit and diff path | `make check-contracts` |
| Forbidden core dependency is blocked | N00-BDD-03 | architecture/negative | disposable manifest mutation | non-zero boundary result | `cargo xtask check-boundaries` |
| `get_build_info` uses generated types | N00-INT-01 | contract/integration | golden DTO | Rust JSON equals TS fixture | targeted Rust and Vitest commands |
| Generation is deterministic | N00-CON-01 | contract | two temp output dirs | recursive byte equality | `cargo xtask contracts --check-determinism` |

## 2. Red State

| Test ID | Expected initial failure | Evidence path |
|---|---|---|
| N00-BDD-01 | `make` has no `bootstrap`/`ci` targets | T01 task evidence |
| N00-BDD-02 | no contract generator/check exists | T04 task evidence |
| N00-BDD-03 | no boundary command exists | T06 task evidence |
| N00-INT-01 | no Rust/TS contract or Tauri command exists | T04/T05 task evidence |
| N00-CON-01 | no deterministic generation implementation exists | T04 task evidence |

## 3. Unit / Property

- Core placeholder pure-function unit test proves workspace test discovery.
- `BuildInfoDto`, `EmptyRequest`, and `AppErrorDto` serialization golden tests.
- Command manifest ordering test across deliberately shuffled registration input.
- Generator path-normalization test rejects absolute source paths in output.

## 4. Repository / Transaction

N00 creates no DB transaction or migration. A repository-level test verifies
that `crates/db` compiles without product schema and that no database file is
created by the empty application.

## 5. Component / Integration

- React renders the application shell and build-info loading/error states.
- Typed wrapper invokes the exact manifest command name.
- Rust Tauri adapter directly uses the core DTO.
- Production frontend build succeeds without network/runtime remote assets.

## 6. E2E / Dogfood

- Launch a release/debug minimal Tauri window on macOS 13+.
- Confirm the shell becomes interactive and displays build metadata.
- Record hardware, OS, build profile, command, duration, and log result.
- No broader product E2E is introduced in N00.

## 7. Negative / Failure Injection

- Modify a Rust DTO in a disposable copy without regeneration.
- Add `rusqlite` or `tauri` to a disposable `core` manifest.
- Corrupt a generated TypeScript snapshot.
- Remove a required build metadata variable and verify a controlled fallback or
  compile-time failure according to the frozen contract.

## 8. Security

- Inspect Tauri capabilities: no filesystem or HTTP capability.
- Verify frontend source contains no remote runtime origin.
- Check generated output contains no local absolute path.
- Run dependency audit if the selected tooling is available without weakening
  the mandatory CI gate.

## 9. Performance

| Metric | Dataset | Budget | Command | Hardware record |
|---|---|---:|---|---|
| cold launch to interactive | empty release app | `< 1.5 s` | target-Mac launch harness | required |
| contract generation | N00 contract set | informational, deterministic | `cargo xtask contracts` | CI runner |
| full CI | N00 clean checkout | informational | `make ci` | CI runner |

## 10. Regression Scope

- `python3 scripts/sdd.py verify`
- `cargo fmt --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test --workspace`
- core boundary check
- contract drift check
- frontend lint, test, and build
- documentation graph/front-matter validation

## 11. Exit Criteria

- Every mapped BDD has recorded red and green evidence.
- Local platform-appropriate CI passes.
- macOS build and minimal-window launch evidence exists.
- Contract regeneration produces no diff.
- No unreviewed capability, product schema, or feature implementation is added.
