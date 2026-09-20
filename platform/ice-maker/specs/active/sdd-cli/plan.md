# Deterministic SDD lifecycle CLI implementation plan

## Scope and design

Implement a constrained front-matter parser and validator, then a thin
`argparse` CLI, then wire active-SDD validation into the existing offline gate.
File creation is staged in a temporary sibling and atomically renamed only after
all outputs are ready.

## Requirement-to-evidence mapping

| Requirement | Change | Verification | Rollback |
|---|---|---|---|
| FR-1, FR-2 | lifecycle CLI | temporary-repository CLI tests | revert Phase 1 checkpoint |
| FR-3, FR-4 | parser, validator, status | validator and CLI tests | revert Phase 1 checkpoint |
| FR-5 | Makefile/workflow gate | CI contract tests and `make check` | revert Phase 1 checkpoint |

## Risks and dependencies

- Constrained YAML could silently accept ambiguity: reject unknown syntax and test boundaries.
- File creation could be partial: stage outputs and refuse existing targets.
- Workflow is protected: T-007 uses the Phase 0–2 authorization and may only strengthen checks.

## Migration and rollout

None; this is a new local CLI. Existing `specs/active/full-build` must validate
before the phase is accepted.

## Review gate

The orchestrator reviews each diff and reruns the focused and repository gates.
