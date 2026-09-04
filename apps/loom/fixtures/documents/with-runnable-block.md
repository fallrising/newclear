---
title: Loom test plan
run_in: term-claude
---

# Loom test plan

A short plan with a block-id so it can be cited elsewhere. ^plan-2026-q2

The build step below is a runnable block (C2 surface renders the ▶ button).

```bash run cwd=/Users/me/path/to/loom
cargo test -p loom-contracts
```

Backlink demo: this references the result section of another note:
[[result-summary.md#^last-build]]

After the agent runs the build, C2 should drop the output snapshot into a
"output" section beneath the block. The snapshot edge type is `feeds_output_to`.

Static (non-runnable) code block, for contrast:

```rust
fn main() {
    println!("not a runnable block — no `run` after the language tag");
}
```
