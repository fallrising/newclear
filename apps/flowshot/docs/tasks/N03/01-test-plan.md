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

# N03 test plan

| Requirement | Level/fixture | RED | GREEN oracle | Negative |
|---|---|---|---|---|
| BDD1 deterministic | unit, four synthetic fixtures | stub throws | 100 builds byte-identical HTML/model | lock/source tamper rejected |
| BDD2 large model | production Node benchmark, exactly1048576 UTF8 bytes mixed GFM/CJK/code | missing implementation | every measured model <300ms; source-hints <=2x baseline, valid ranges | report failed timing unchanged |
| BDD3 sanitize | unit+real jsdom, malicious fixture | missing sanitized output | no executable/embed/style/event/URL loading, controlled callbacks only | encoded/control/unknown schemes, hidden and forged metadata |
| BDD4 whitespace | unit+DOM, Unicode/code fixture | missing canonical text | prose horizontal/soft collapse, hard newline, code whitespace, NFC across inline markup | malformed surrogate rejected |
| DOM map | jsdom each final leaf | missing wrappers | UTF8 slice equals leaf text; UTF16 offset converts actual leaf text | split surrogate offset rejected |
| Reader | React Testing Library | missing component | click callbacks, stable caption, Blob replacement/unmount revocation | stale promise disposal and unsafe MIME rejected |
| Contract | Node built-in tests/checker | copied tamper | exact source/metadata/authority drift rejection | extra/missing files, altered hash/version/commands |

Commands: shared launcher + scripts/linux-docker-check.sh with npm run check:n03-contract, npm test, npm run lint, npm run build, npm run benchmark:n03. Exact commands/logs and hardware go to candidate verification. Full native/CI integration is root responsibility.

Root T010 correction: final DOM leaf traversal order must equal segment order, in addition to each canonical slice matching text. Cover captions before/after rows, multiple captions, stripped section wrappers, thead/tbody/tfoot, multiple caption paragraphs and nested tables. Exact canonical strings prove retained content is not dropped; 100-repeat determinism remains unchanged. RED artifact red-table-dom-order2.log; authority-hash gate refusal retained in red-table-dom-order.log.
