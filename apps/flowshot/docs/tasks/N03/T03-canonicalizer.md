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

# T03 — Canonical prose/code/NFC semantics

Owner: T-008 isolated worker; root accepts. Budget: 15–90 minutes bounded slice within worker total45min.

Allowed paths: src/lib/document-model/**. Other T-008 paths remain governed by parent assignment. No delegation or commits.

Outcome: Canonical prose/code/NFC semantics. Dependencies: T02.

BDD/oracle: see 01-test-plan requirement mapping and unchanged SPEC/ADR rules. Begin with failing behavior; preserve red/green evidence.

Verify independently: `npm test -- src/lib/document-model` under shared launcher/Docker.
