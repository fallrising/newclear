# M2 integration contract

Revision 1 · base `b8dae76034caf63bf7d0721cba99a58a0586ae85` · scope AC-09–12、AC-21–23

This contract fixes the shared boundary for the M2 self-service and governance implementation. The SDD remains authoritative; this document records the concrete integration choices used by the implementation tasks.

## Persistence and identity

- M2 uses seed version `dim-gate-m2-v1`. An M1 snapshot is incompatible and must enter the existing explicit recovery flow without rewriting the original bytes.
- Requests, catalog revisions and jobs use the existing session-local snapshot, command queue, optimistic version checks, idempotency records, audit events and scope guards.
- A request keeps one `requestId`, `correlationId`, deterministic `environmentId` and deterministic planned CI IDs across failed provisioning retries. Every retry creates a new job with `attempt + 1`; it never creates a second active environment or duplicate placement.
- Catalog requests persist an immutable template snapshot and revision. Publishing or disabling a later catalog revision cannot change submitted history.

## Capacity and provisioning

- `used` is derived from active compute CIs. `reserved` is derived from queued/running provisioning jobs plus explicit demo scenario reservations. Approval checks and writes the reservation in the same serialized command transaction.
- Approval allocates the environment identity, planned CI identity and queued job. Provisioning changes the same job to running and schedules `validate → allocate → configure → register → verify`, one logical tick per step.
- A configure failure marks the job/request/environment failed, releases reservation and creates no active CI or placement. Retry rechecks current scope, template snapshot and capacity, then reuses the environment and planned CI identities.
- Success creates exactly one active provisioned compute CI and placement, marks the environment ready, converts reserved capacity to used through the CI projection, and updates request/job/audit atomically.

## Governance

- Assignment/user changes increment `policyVersion`; stale dialogs are rejected by the handler. Self-modification and disabling or revoking the last enabled Admin remain forbidden.
- Navigation configuration may change only label/group/order/enabled for registered route keys. Required recovery entries cannot be disabled and permission requirements never come from configuration.
- Published catalog revisions are immutable. Editing a published item creates or targets a draft revision; publishing changes the current visible revision in one command; disabling blocks new drafts/submission while existing submitted requests retain their snapshot.
- CMDB custom fields are optional-only. Keys are unique and cannot use core CI identity fields; an existing key/type cannot be changed.

## Task boundaries

- `T-014`: shared schemas, seed, engine, handlers, typed client and domain/contract tests.
- Follow-up RD/Ops UI: catalog wizard, request detail, approvals, capacity and job views.
- Follow-up Admin UI: access, navigation, catalog, CMDB model and audit views.
- Final M2 integration: production browser flows, independent fixed-commit review, full local gates and remote synthetic-merge CI.

No task may directly mutate snapshot state from React, call a real provider, weaken M1 scope isolation, or expose a blank route as implemented.
