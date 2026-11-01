---
derived_from:
  - ../../../SPEC.md
  - ../../../docs/nodes/N03-markdown-render-model.md
  - ../../../docs/adr/ADR-002-document-model-v1.md
source_version: 1.0.2
source_sha256:
  SPEC.md: b569c2181559270221de3e81ce1d59fad136932299629f805fb10155938357b0
  docs/nodes/N03-markdown-render-model.md: b020fb564f799d0cc5c63869514916d34ffee7ecf5107c6e8532ce385f7fee77
  docs/adr/ADR-002-document-model-v1.md: b378fa3d3408adafd998c5452aff4b42935dfda309605ad9b9c74c4453b6c26c
generated_at: 2026-10-23T03:34:48Z
---

# N03 implementation plan

Objective: produce one deterministic safe Markdown model for reading, selection and later anchors.

Inventory: N00 has React19/Vitest/jsdom/Vite; N01 has accepted persistence but no parser. ADR-002 supplies the missing v1 decisions. Existing App/native/generated contracts are read-only and root-owned. No migration or Rust DTO is needed.

Inputs: valid Unicode source, including original BOM/CRLF. Outputs: frozen DocumentModel, sanitized inert HTML, NFC canonical UTF-8, deterministic TOC and leaf ranges. Source hints are optional and only emitted for exact, honest text mappings. Invariants: no navigation/network/filesystem, every nonempty selectable leaf maps to its exact canonical slice, no duration inside model, original-byte source SHA256.

Data flow: unified parse → GFM/frontmatter → HAST/raw → prune hidden/executable content → narrow sanitizer → explicit local highlight → controlled target metadata → canonical normalized leaves/segments → stringify/hash. Reader receives model and injected callbacks; assets remain stable selectable captions plus nonselectable Blob images.

Contract: types.ts + index.ts frozen by N03 lock and checker before implementation. Checker validates exact metadata, authority hashes and sources; tamper tests exercise real copied input. Dependencies exactly pinned to ADR npm versions; npm generates lockfile.

Ownership: this worker owns only T-008 declared model/reader/fixtures/package/lock/task/candidate verification/report paths. Root owns governance, App/CSS/native/CSP and final CI/acceptance.

Task DAG: T01 → T02 → T03 → T04 → T05 → T06 → T07; tests first for each behavior. T01 contract freeze precedes behavior code. Sequential slices share this isolated worktree.

Risk/failure injection: malformed Unicode, malicious raw HTML/URLs, cross-markup NFC, UTF16 surrogate selection, source/metadata drift, rejected asset promises, stale async asset completions, Blob cleanup. Performance retains 1MiB mixed GFM/CJK/code <300ms and hints <=2x no-hints baseline; record failures without weakening oracle.

Visible interaction fallback (root review before implementation): details/summary interaction is unsupported; sanitized details and summary become ordinary visible div/p blocks, so all retained canonical text is rendered and accessible. This is an inert-reader rendering choice under ADR visible-text policy, with a regression test.

spec_defects: none identified at plan time. Derivation: SPEC allows best-effort source hints; omit ambiguous raw/transformed mappings, always map final DOM. Initial BOM remains in hash and is removed only from parser input per ADR. No independent canonicalizer is introduced.

Rollback: remove only this task's newly added modules/dependencies and restore package manifest/lock as a scoped diff; never reset unrelated work. No DB or source-document mutation occurs.

Non-scope: integration, filesystem/OS adapters, annotations/search/reanchor/Mermaid/wikilinks, native DTOs, governance and release acceptance.

Contract hardening during implementation review: helper re-exports were replaced by explicit typed public wrappers in index.ts and the initial N03 lock re-frozen. Function signatures/behavior did not change; this makes source hashing cover all public signatures without freezing private implementation. No downstream integration existed.

Type-only dependency: @types/hast 3.0.5 is explicitly pinned as devDependency for safe HAST traversal types (previously present transitively through rehype). No extra runtime package is introduced.

Root-approved initial-v1 table validity correction: ADR-002 now requires valid table structure before leaf assignment. Preserve caption nodes through sanitization, lift each caption and any nonwhitespace invalid table-context child into deterministic ordinary visible blocks before its owning table. Keep valid rows/sections/cells intact. Nested tables normalize bottom-up; no retained text may be silently dropped. Tests compare final parsed DOM leaf ID order against segment order and verify canonical slices. Root owns ADR changes; API unchanged.
