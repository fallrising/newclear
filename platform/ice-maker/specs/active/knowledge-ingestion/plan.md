# Synthetic knowledge ingestion MVP implementation plan

## Scope and design

Build four dependency-aware slices. Intake owns content identity, quarantine,
privacy, rights, and taxonomy. Extraction independently owns the deliberately
small synthetic PDF/PBM parser and OCR cache contract. After both are accepted,
index/propose composes immutable chunks into SQLite FTS5. The final CLI slice
wires persisted local state and runs both PDF types end to end. Runtime corpus
and databases live only under `.ice-maker/`.

## Requirement-to-evidence mapping

| Requirement | Change | Verification | Rollback |
|---|---|---|---|
| FR-1, FR-2, FR-5 | source store, privacy and taxonomy | intake contract tests | revert T-014 |
| FR-3, FR-4 | text/PBM extraction and OCR cache | extraction fixture tests | revert T-015 |
| FR-5, FR-6 | provenance validator, FTS5 and proposals | search/proposal tests | revert T-016 |
| FR-7 | four-stage CLI and two-PDF journey | subprocess E2E tests | revert T-017 |

## Risks and dependencies

- Synthetic parser overclaim: accept only an explicit minimal format and label
  production PDF/OCR as external-pending.
- Content leakage: runtime source and extracted text stay in ignored local state;
  tracked tests construct synthetic bytes at runtime.
- Cache poisoning: bind cache to source SHA, extractor version, method, and
  canonical evidence digest and reject mismatch.
- Taxonomy drift: parse a constrained canonical taxonomy and reject unknowns;
  no automatic category creation.

## Migration and rollout

No production migration. The CLI creates versioned local state below
`.ice-maker/knowledge`; rollback removes the Phase 4 code checkpoint while an
operator separately decides whether to retain local runtime data.

## Review gate

The orchestrator reviews each diff and reruns focused/full tests, then deletes
runtime output and repeats the two-PDF journey. No production OCR, object store,
credential, or provider call is accepted as local evidence.
