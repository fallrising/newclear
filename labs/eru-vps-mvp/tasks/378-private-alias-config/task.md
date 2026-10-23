# Issue 378 — private alias configuration

Issue: https://github.com/fallrising/newclear/issues/378
Component: labs/eru-vps-mvp

Outcome: Resolve SSH aliases through the existing explicit private inventory and
hash-bound plan/key inputs while preserving logical node IDs and authorization guards.

Scope: scripts/tests directly coupled to alias defaults; SUCCESS scope/evidence;
necessary operator configuration documentation and this task/report directory.
No AGENTS, other components, historical evidence documents or real private inputs.

Acceptance: neutral offline fixtures demonstrate injected inventory, missing or
invalid configuration fails before operations, and existing plan/hash/generation/
exact-target/destructive authorization checks retain their original meaning.

Verification: red/green focused inventory/recovery/reimage/fresh suites, then the
dependent local slices changed by the implementation; repository index/contracts
and whitespace checks. All checks use the shared workspace launcher. No real SSH,
host/provider action, credential/private-inventory access or deployment.

Authority: parent owns commits and external writes; worker changes local scoped
source/tests/docs only and cannot delegate. Checkpoint after 20 minutes and on
conflicting source facts or unavailable authority. Live AC-04/05 remain pending.
