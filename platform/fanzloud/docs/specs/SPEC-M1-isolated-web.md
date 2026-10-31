# M1 isolated Web route — T-0442 with approved dependency T-0447

Authority: approved SDD / ADR-0008; existing subscription, one operator, one4CPU/4GiB
VM, one coding invocation at most10min. EX02 now has real KVM boundary evidence.
This specification changes validation ordering: qualify VM/tools without a provider,
then use one browser submission to produce EX03 and M1 evidence together.

## Contract units

- M1-WEB-01: explicit CODEBOX_MODE=isolated starts a separate Rust composition;
  original P0 Cloud route and its exact CLI pin remain intact. Reuse accepted visual
  styles; add only functional isolated-task login/selection/submission/status/diff.
- M1-WEB-02: Rust gateway forwards a bounded allowlist of AP operator API requests
  to one explicitly configured literal loopback SocketAddr. It never holds provider,
  node or connector credentials. Same-origin AP operator authentication, Secure cookies,
  CSRF/origin checks and idempotency remain authoritative. Never forward arbitrary
  destinations, redirect responses, unbounded streaming or hop-by-hop headers.
- M1-WEB-03: page logs in via AP session; selects preconfigured project, fixed base
  and actual claude-subscription profile. One click creates one UUID idempotency key.
  On lost submission response, disable resubmission and show uncertainty; no automatic
  retry. Page polls the returned AP run ID; UI status cannot initiate work.
- M1-WEB-04: show actual backend states and verification result; download exact final
  diff through authenticated result.diff. Failed/unknown never displays success.
  Persist the current non-secret run ID and pending submission key in sessionStorage.
  Reload retains refusal to submit while the outcome is unknown; confirmed terminal
  cleanup of the associated run reopens the form. This local refusal marker is not
  M3 durable intent recovery, cross-device reconciliation or native session resume.
- M1-WEB-05: fixed assets use existing style, no inline scripts/eval/HTML rendering
  of agent output; no-store, nosniff, same-origin and restrictive CSP. Auth/provider
  values are never stored in browser storage or logs.

## Machine acceptance and boundaries

Rust tests cover route/method/upstream/response bounds and transport failures; existing
P0 checks remain applicable. One real Chromium journey must log in, submit through
actual Rust to AP/Connector/VM and pinned Claude CLI, observe real status changes and
retrieve matching diff plus passing fixed checks. Inspect its init/tools/model/exit,
sequential-workspace isolation, canary/egress and observed cleanup.

Operator creates only the preapproved fixed catalog/profile through normal AP APIs.
The browser cannot choose a host path, image, runtime command or arbitrary repository.
The private test listener uses HTTPS termination; no public deployment or paid API.
No live Cloud submission, second vendor, two simultaneous tasks, review handoff or
restart/replay acceptance is claimed. M2/M3 and FN01–07 whole-MVP remain unfinished.

## Archetype answers

Security: AP auth/CSRF and VM secret boundary remain enforced. Atomicity: AP command
transaction owns submit and job; Fanzloud has no second job queue. Retry: unknown stops,
no automated retry. Recovery: existing AP read/reconcile authority, no CLI restart;
M3 durable product intent remains future work. Cancellation: backend capability only;
M1 page need not invent pause/resume. Failure: preserve status/result/cleanup separately.

## M1 FN-06 completion after success-path review

M1-WEB-06: show a bounded reason message separately from state and cleanup. Deadline,
operator cancellation, failed checks and uncertain agent/provider output remain distinct;
unknown never means stopped. Add one exact POST /api/v1/runs/{UUID}/actions gateway
route accepting only {action:"cancel",expected_state_version:positive integer}; reject
other actions/fields before forwarding. AP still owns authentication, CSRF, idempotency,
state-version fencing and stop proof. Web sends one cancellation intent and never retries
an uncertain reply; polling observes whether stopping actually completed.

Acceptance uses real Rust/AP unauthenticated and unregistered-target rejection and one
queued task cancelled before allocation (no worker/VM/provider). Existing actual VM
cancellation receipts prove running-work cleanup. A separately labelled intercepted
browser projection covers timeout/provider-unknown/check-failure/cancel reasons; real DB
subscription recovery and actual watchdog subprocess tests establish failure semantics.
No extra coding invocation is required or allowed by this follow-up. The live success
source remains versioned; final-source read-only replay must still download the same diff.
