# Reproducible publication compiler implementation plan

## Scope and design

T-021 builds a pure, immutable compiler for strict JSON values, assembly,
cross-references, bibliography, Markdown, and HTML. T-022 adds the no-follow
filesystem and all-or-nothing two-format publication boundary. T-023 supplies
two tracked manifests sharing one synthetic Phase 5 pattern and proves deletion
plus byte-identical rebuild through the public CLI. Outputs remain ignored under
`.ice-maker/publications/`.

## Requirement-to-evidence mapping

| Requirement | Change | Verification | Rollback |
|---|---|---|---|
| FR-1–FR-3 | pure manifest/source compiler and renderers | compiler unit tests | revert T-021 |
| FR-4, FR-5 | confined loader and atomic build boundary | filesystem fault tests | revert T-022 |
| FR-6 | two manifests, one source, CLI rebuild journey | publication E2E test | revert T-023 |

## Risks and dependencies

- Generated views drifting from knowledge: every build consumes exact tracked
  bytes and embeds the caller-supplied source commit SHA.
- Path/symlink escape: resolve only validated relative components with no-follow
  descriptors and reject any source beneath the generated output root.
- Half-published formats: stage and validate both outputs before replacing a
  complete pair; failure retains the previous pair or publishes neither.
- HTML injection: render only compiler-owned structure and escape all source
  text and attributes.
- Evidence overclaim: the shared fixture retains an explicit synthetic marker in
  source, rendered output, tests, and runbook.

## Migration and rollback

No production migration. Generated output is disposable and rebuildable. A
rollback reverts Phase 6 code and tracked fixtures, then removes only the ignored
publication output directory.

## Review gate

The orchestrator reviews every diff, runs focused/full gates, independently
deletes and rebuilds outputs twice, compares bytes and commit markers, verifies
source SDD hashes, and confirms no output or source symlink escapes the roots.
