# ADR-001 — Linux development and Mac release acceptance

Status: accepted, 2026-10-23, direct owner instruction.

The previous process made all development depend on access to a controlled Mac. Linux Docker can validate Rust, SQLite, frontend contracts and the real Linux Tauri application. SPEC §13.1 now requires that evidence for N00 development completion and permits subsequent nodes and milestone PRs. The dependency graph is unchanged.

Controlled macOS launch under 1500 ms remains a release/usable gate tracked in SUCCESS AC-02. Hosted timing remains diagnostic; Linux evidence cannot substitute for Mac evidence. Historical T08 failures remain intact. Other performance, safety and real dogfood requirements remain unchanged.

This is a scheduling correction, with no change to product scope, schema, commands, security invariants or target platform.
