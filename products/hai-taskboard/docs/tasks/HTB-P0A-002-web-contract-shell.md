# HTB-P0A-002: Accessible web contract shell

## Goal

Implement the Board-first React/shadcn shell against static typed contract fixtures for Project/Board,
WorkItem detail, Attention and Impact Preview.

## Inputs

- `docs/SDD.md` HAI-UX clauses
- `docs/sdd/ui-interaction.md`
- accepted OpenAPI/JSON schemas and design checkpoint

## Scope

`web/**` and contract fixtures explicitly named by the worker envelope. No live backend integration.

## Acceptance

- Draft/Ready/Developing/Review/QA/Done plus one-card Blocked projection are visible without invented
  progress metrics.
- Drag, keyboard and single-click movement share one command intent; the non-drag paths work alone.
- Guard rejection preserves authoritative position and restores focus with an announced reason.
- Disconnected, conflict, stale, OutcomeUnknown, CancelRequested and Done-Stale are distinct.
- Unit/accessibility tests, typecheck, lint, production build and 320px/light-dark critical fixture
  flows pass in pinned Node/Playwright containers.

## Forbidden

No direct domain-state mutation, chat-first surface, real provider, credentials, backend or deployment.
