# Mini-SDD: P0-A UI information architecture and interactions

Status: Accepted for P0-A implementation
Parent: `../SDD.md` clauses HAI-UX

## Alternatives

### A. Board-first project workspace — recommended

Project navigation and the six phase lanes are primary. Selecting a WorkItem opens a detail panel on
wide layouts and the same full detail route at 320px. Attention and Impact Preview are explicit
secondary routes. This keeps flow/WIP visible without turning activity or notification volume into
the product center.

### B. Attention/detail-first workspace — rejected for P0-A

Attention is the landing surface and selected detail is central; Board is secondary. This is useful
during incident-heavy operation but hides delivery flow and incentivizes notification-driven agent
theater before real operational evidence exists.

Decision: Alternative A was accepted after independent T-003 review and an interactive comparison
rendered at 1024px, 736px and 360px. This is an information-architecture decision, not a claim that
the production frontend or its WCAG checks exist.

## Navigation and hierarchy

P0-A has four routes/surfaces only: Project list/Board, WorkItem detail, Attention and Impact Preview.
Runs, Review/Evidence and Audit are tabs/sections inside WorkItem detail.

Detail order is identity/goal/conditions; next eligible action and exact guard; AC coverage plus
candidate/revision subject; blockers/questions/ownership/dependencies; Runs and recovery; Review and
Evidence per AC; immutable artifacts and audit.

## Board projection

Primary lanes are Draft, Ready, Developing, Review, QA and Done. An optional Blocked projection lane
takes precedence when a WorkItem has one or more active blockers; each card appears once while its
stored phase remains unchanged. Within lanes, explicit ordering is presentation state only.

Cards show title, human owner, phase text, effective validity, required AC coverage, active blocker
count, current Run/last observed heartbeat and one pending action. They do not show ungrounded
percentages or agent self-reported progress as fact.

## Shared movement contract

Drag, keyboard move controls and `Move to…`/previous/next buttons submit the same transition command
with expected version and idempotency key. The authoritative lane stays visible while pending. On
acceptance, command result/SSE moves the card, announces success and focuses the updated heading.

On rejection, the card remains in the server lane; the origin control retains/recovers focus and an
associated message names unmet guards and next action. Version conflicts preserve the intended
target for review but are never silently retried. Timeout shows “result pending verification” and
re-queries the original command ID instead of inviting a new submission.

## Required states

- Disconnected: persistent label and last cursor; cached read allowed, risky action revalidates.
- Stale: baseline revision and cause path; publish/Done unavailable.
- Version conflict: changed version/fields and explicit refresh/review.
- OutcomeUnknown: affected Run and side-effect uncertainty; no retry/publish/Done.
- CancelRequested: stop unconfirmed; no new dispatch.
- Done · Stale: historical CompletionRecord retained, current effective satisfaction false.

## Accessibility acceptance

All actions work without drag and without keyboard shortcuts. Native controls, visible focus,
programmatic labels, polite live announcements and non-color text/icons are required. At 320px the
board becomes lane lists and selection navigates to detail. Critical flows are checked at 320px,
zoom, keyboard-only, coarse pointer, light/dark and disconnected conditions.

## Named tests

- `board-transition-accessibility.spec.ts`
- `board-transition-guard-rejection.spec.ts`
- `work-item-detail-subject-gate.spec.ts`
- `attention-recovery-states.spec.ts`
- `impact-plan-stale.spec.ts`
- `responsive-theme-zoom.spec.ts`
