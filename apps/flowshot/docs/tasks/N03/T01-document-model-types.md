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

# T01 — Frozen API and executable lock

Owner: T-008 isolated worker; root accepts. Budget: 15–90 minutes bounded slice within worker total45min.

Allowed paths: src/lib/document-model/types.ts; src/lib/document-model/index.ts; contracts/locks/N03.json; docs/tasks/N03/check-contract.mjs; docs/tasks/N03/check-contract.node.mjs. Other T-008 paths remain governed by parent assignment. No delegation or commits.

Outcome: Frozen API and executable lock. Dependencies: none; freeze before implementation.

BDD/oracle: see 01-test-plan requirement mapping and unchanged SPEC/ADR rules. Begin with failing behavior; preserve red/green evidence.

Verify independently: `npm run check:n03-contract` under shared launcher/Docker.
