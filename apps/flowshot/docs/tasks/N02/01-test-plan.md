---
generated_at: 2026-10-23T04:18:40Z
document_type: test-plan
node_id: N02
status: ready
derived_from:
  - ../../../SPEC.md
  - ../../nodes/N02-workspace-lazy-tree.md
  - ../../adr/ADR-003-workspace-boundaries.md
source_version: 1.0.2
source_sha256:
  SPEC.md: b569c2181559270221de3e81ce1d59fad136932299629f805fb10155938357b0
  N02: e1994e03209cb624d5430169d6866b63884712917f04841d8c1416a06b227f2e
  ADR-003: 5e929e434782cd8650641994555fc6eec5036530fac72ba4777308e447352f66
owner: codex
---
# N02 test plan

| Requirement | Fixture/oracle | RED then GREEN target |
|---|---|---|
| BDD01 large lazy tree | 5000 synthetic files; first page<500ms, zero child/body opens; bounded retained keys | native workspace tests + release-like recorded timing |
| BDD02 traversal | direct ../absolute/NUL/empty, href one-decode legal parent vs escape/double-encoding | core path table and native integration |
| BDD03 symlink/races | static symlink, intermediate/final swaps; outside bytes never returned; retries<=2 | PathGuard deterministic hooks |
| BDD04 roots | equal/ancestor/descendant/aliases, concurrent admission, detach/reattach identity | native root lifecycle + typed DB tests |
| BDD05 assets | PNG/JPEG/GIF/WebP magic, SVG/remote/data/spoof, 10MiB+1, actual raw transport | native commands and frontend binary wrapper |
| BDD06 ignore | builtins, configured gitignore negation/pruning, document-ID/link/asset bypass attempts | native workspace tests |
| Source authority | strict UTF8, BOM/CRLF unchanged, 20MiB+1, growing target, missing IDs, committed hashes/revision unchanged | native open + DB regression |
| Cursor determinism | stable order, keyset page union, wrong root/path/policy/stamp/tampered cursor reject | native directory tests |
| UI | no collapsed fetch; expand once; pending/error/retry/load-more; injected picker/open; missing rows | Vitest component tests |
| Contracts | Rust JSON goldens, deterministic TS, raw binary framing, both old/new locks and metadata tamper | core/xtask/native tests |

All fixtures are synthetic in launcher temp directories. Exact boundary sizes include the accepted limit and limit+1. Query results are bounded; property tables include CJK/Unicode and URL encodings. Errors/logs exclude source/bodies/absolute paths. Preserve expected failures before implementation and rerun identical tests after fixes. Commands: cargo test -p flowshot-core; cargo test -p flowshot-db; cargo test -p flowshot-tauri; cargo test -p flowshot-xtask; cargo fmt --all --check; strict focused clippy; cargo run -p flowshot-xtask -- contracts --check-determinism --check; boundary checker; npm test/build via task frontend dependencies. No claimed full M1/KB gate.
