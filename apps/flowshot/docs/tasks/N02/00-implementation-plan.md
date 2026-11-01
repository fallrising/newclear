---
generated_at: 2026-10-23T04:18:40Z
document_type: implementation-plan
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
# N02 implementation plan

Implement ADR-003 with typed native commands and a standalone injected lazy tree. M0 is accepted; immutable SQL stays unchanged. No App/N03/N04 edits.

## Inputs, outputs and invariants

UUID/string-token Rust DTOs generate TypeScript and serialization goldens before persistence/native implementation. Nine bounded commands, raw binary assets, exact-source UTF-8 open, stable document IDs. PathGuard alone opens source paths: no-follow component capabilities; stable identity/size/mtime checks; limit+1; at most two retries. Ignore every ancestor/target; no recursive enumeration/body reads for tree. SQL stays in DB crate; writer owns mutations.

## Slices and ownership

T01 contracts/generator/goldens/locks; T02 safe handles and pure path rules; T03 additive DB/root lifecycle; T04 streaming bounded selection/cursors; T05 original-source stable open; T06 exact links/MIME binary assets; T07 standalone accessible tree; T08 adversarial/performance/regression evidence. Shared registry/native registration/config files have this one worker owner. Root integrates App and accepts full native delivery.

## API details

list_workspaces accepts optional cursor/limit ({} remains valid), returning bounded joined workspace/root rows. Consumers merge by workspace/root UUID. Empty workspace has a row without root; no tenth command or unbounded nested roots. Directory ordering key is directory-first then Unicode scalar name and relative path; cursor binds root/path/policy/fstat identity+mtime+ctime. DB adds bounded workspace/root/recent queries, identity ensure and optional mtime observation.

## Dependencies and failure injection

Exact native pins: rustix1.1.5 fs, ignore0.4.33, dialog2.7.3; reuse sha2/uuid/percent-encoding/base64 pins. Inspect downloaded APIs. Hooks deterministically replace intermediate/final entries. RED covers traversal/symlink/ignore/overlap and missing runtime behavior. Detect stale cursors; preserve metadata on detach/missing. Unsupported platforms fail closed.

## Verification and rollback

Run shared launcher n02-worker/Docker focused Rust tests/fmt/strict Clippy, real generator+lock/boundary checks, frontend tests/build. Benchmark real 5000-file first-page<500ms and trace zero child/body reads. Root reruns full CI/native. Preserve RED and all logs under AGENT_EVIDENCE_DIR. Revert source changes only before real data migration; there is no migration/down/purge. No commits. spec_defects: none after ADR-003; report new contradictions immediately.
