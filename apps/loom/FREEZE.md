# Contract Freeze Notice — A0

> Status: **frozen** as of A0 completion.
> Any change to anything listed below requires a **Contract Change RFC**
> (`01-collaboration-protocol.md` §6) approved by the Contract Steward.

## What is frozen

| Path | Why frozen |
|---|---|
| `contracts/src/**` | Single source of truth for Rust↔TS. Drives every B/C/D track. |
| `src/contracts/**` | Generated; never hand-edit. Drift caught by `cargo test`. |
| `schema/sqlite.md` | Concept schema. Column-level details belong to B1/B2; the table-level role (main vs cache) is frozen. |
| `schema/canvas-sidecar.md` | v1 sidecar shape. `version: 1` is the migration anchor. |
| `schema/source-of-truth.md` | Main-vs-cache assignments. Changing this changes recovery semantics. |
| `fixtures/**` (loader-relevant fields) | Each fixture is the contract-shape ground truth for one downstream track. |

## What is **not** frozen (and never was)

- Anything under `src-tauri/` — populated by B1/B2.
- Anything under `src/surfaces/` — populated by C1/C2/C3/C4.
- Anything under `src/plugins/` — populated by D1/D2.
- Implementation logic. The shapes are frozen; the behaviour behind them is each track's job.

## Why this is strict

A0 is the only task whose output flows to every other task. If `WriteCommand`
quietly grows a field, seven other Claude Code sessions silently drift.
Changing the contract has to be a **deliberate event**, not a side effect.

## How to propose a change

1. Open a `contract-change RFC` (format in `01-collaboration-protocol.md` §6).
2. The Steward evaluates: can this be solved without changing the contract?
3. If accepted, the Steward:
   - Edits `contracts/src/**`.
   - Re-runs `cargo test -p loom-contracts` to regenerate `src/contracts/**`.
   - Updates affected fixtures in the same commit.
   - Notifies every active track to rebase.
4. Affected tracks pause until rebase completes.

## Drift checks already in place

| Check | Where |
|---|---|
| Rust ↔ TS type drift | `cargo test -p loom-contracts` runs 26 ts-rs export tests; CI should `git diff --exit-code src/contracts/` after. |
| Origin presence on all `WriteCommand` variants | `contracts/tests/origin_invariant.rs::every_write_command_carries_origin` (A0-3). |
| Fixture / contract drift | `contracts/tests/fixtures_load.rs` deserializes every contract-shaped fixture into the live types (A0-7). |

If any of the three fails, the contract surface is unstable — block all
downstream merges until it's green again.
