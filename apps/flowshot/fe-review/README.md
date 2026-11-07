# Flowshot review-only R2

Approved DESIGN M1–M2 supplies the existing foundation shell through its pre-import build-info promise seam. No product/native IPC changes. `run-review.mjs` owns a Vite server and browser in the root-provided isolated namespace; it is not a shared capture hook or native Tauri runner.

Current browser evidence: [flowshot-001](runs/flowshot-001/capture.json), 19 captures (18 three-state combinations plus mobile long metadata), HTTP200/final `/` identity and state assertions, 19 valid PNG hashes, no observed horizontal overflow, no unexpected browser health events; [audit](tasks/round2/evidence/flowshot-artifact-audit.json). All 19 axe scans contain color-contrast incomplete (5 nodes for loading/error, 10 for ready/long-ready), despite zero violations. Full Round3 and product/native/Mac gates are not accepted by these results. Pair/native/publication status is tracked in [report](tasks/round2/report.md).

Use [PROMPT](PROMPT.md) for the actual invocation and boundaries. PNGs/raw logs are ignored and must remain preserved outside disposable caches. The `preload.node.mjs` and `runtime-guards.node.mjs` files use Node's runner, deliberately separate from existing Vitest discovery.
