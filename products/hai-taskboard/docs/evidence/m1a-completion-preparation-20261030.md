# M1a completion preparation evidence

T-0339 / HM1A. Baseline `6b7bf17c010f6a354f7abf3676f994f7ae2d19ec`;
documentation-first commit `c651b83f59cab40cfa8f7f6cdfcd92265800d7ab` precedes integrated code.
Owner approved C01/C02/C06 and requested current designs. At intake remote main's HAI tree still
matched PR799; no open HAI design PR. The remaining-work plan already accounts for the Kanzo
follow-up design. Proposed Kanzo/Decision/ledger features remain unaccepted and unimplemented.

## Scope and acceptance

The [accepted contract](../sdd/completion-preparation.md) adds a read-only authenticated GET of exact
completion material, distinguishes incomplete current policy from stale identity, and retains the
transactional command Done gate. C01 aligns SDD/ADRs/HANDOFF to BOARD authority, preserving the
archived ledger; C06 aligns immutable preflight wording. No migrations, dependencies, runtime
permission changes, UI, M1b/M1c/M2, real adapter, release or deployment.

| AC | Evidence | Current result |
| --- | --- | --- |
| PREP-AC-01 | HTTP auth/project denial before reader calls; canonical/resource paths, no-store, strict scope; existing runtime Host/session gates retained | Focused passed |
| PREP-AC-02 | Actual application + SQLite Review/QA candidate, two HTTP reads and store reopen; exact response/fences/subject; byte comparison of every table's rows | Focused passed |
| PREP-AC-03 | Missing rule/environment versus stale policy/recipe/approval/base/rule fields/adapter/scenario; corrupt persisted input; changes during artifact I/O; wrapped-error classification; command classification unchanged | Focused passed |
| PREP-AC-04 | All required nested members absent/null, unknown/duplicate data, false booleans, digest/scope/phase, numeric limits, preparation1024-rule boundary plus shared0/1024/1025 collection guard, text bytes, unavailable reader and sanitized dependency errors | Focused passed |

Independent native contract review T-001 ACCEPT includes OpenAPI; native implementation review T-003 ACCEPT covers the seven frozen files and focused evidence. No Claude call is claimed in this milestone (the earlier remaining-work plan has its own
Claude review evidence). Unit response fixtures test transport adversarial cases; actual SQLite
integration uses explicit repository/artifact/session fixtures with real public application ingress
and real HTTP adapter, not a substitute preparation implementation. Reopen is SQLite Store reopen,
not a whole operating-system or browser restart.

## Commands and failures

- Worker retained meaningful compiled Red: missing route returned404 and incomplete policy returned
  stale. The first Red attempt could not access the Docker socket in the sandbox; it is an environment diagnostic,
  not the semantic Red. The subsequent authorized isolated execution compiled and exposed the expected failures. Original logs remain intact.
- Pinned Go1.27.1 focused service/httpapi packages passed. Root integrated seven Go files with baseline
  guards and recorded SHA-256 manifest. An initial root full gate was stopped during race tests
  (exit137, logs retained) after the final dot-ID correction changed two files; it is not a final pass.
  Final frozen-source `bash scripts/check-backend.sh` passed exit0: pins/modules/format/vet,
  all package tests, race tests and compile gate. All185 recorded runtime/API/tool inputs remained unchanged.
- `bash scripts/check-web.sh` passed formatting, lint,30tests, TypeScript and Vite build under
  Node24.20.0/pnpm11.25.0. Initial network-none dependency install lacked metadata (EAI_AGAIN), was
  stopped, then one frozen-lockfile preparation succeeded and the original network-none gate passed.
  The existing jsdom canvas diagnostic remains visible; no new dependency or lockfile change.
- Redocly CLI2.51.2 at the documented immutable image digest: `lint /spec/openapi.yaml` passed,
  zero warnings, network-none/read-only source.
- `python3 scripts/check_project_success.py` passed47contracts;
  `python3 scripts/check_indexes.py` passed8indexes/zeroerrors.
- Task/report validators and scoped local Markdown link/anchor checker pass at their recorded
  snapshots; final document count and staged scope verification follow final evidence integration.

Exact Docker argv, command results, source hashes, original worker/reviewer reports and failures
are retained in the private persistent evidence bundle `hai-m1a-20261030`. Local derived Go/web
images match toolchain pins; they are not claimed byte-identical to CI base images. All source mounts
are read-only during backend/API verification; caches are shared. No runtime credential/state is retained.
Git SSH diagnostics (timeout and untrusted443 host key) were resolved via existing HTTPS credentials
with per-command settings; no host-key bypass or global configuration change.

## Limits and delivery

The whole product stays incomplete: SUCCESS AC-02/03/04 pending and usable_tag none. The new GET
prepares material only; it does not supply human reports, coverage, a complete UI, or prove Done.
M0's browser capture remains historical at its original source/date; this backend/API slice does not
claim a new browser run. Both independent reviews and local gates have passed; required exact-head CI, merge and remote
readback must still be recorded before this milestone is delivered. BOARD carries its current status.

Accounting: one native contract reviewer, one bounded native backend writer and one final reviewer
completed; external provider launches0. Actual provider requests/tokens/cost and aggregate tool counts
unknown/null. Focused execution durations are logged; root active-vs-wait is estimated rather than
instrumented. Initial estimate60–90root active minutes,20minute checkpoints; worker budget30minutes,
reviews10minutes each, CI round20minutes. These are bounds/estimates, not measured provider usage.

Machine-readable source/log receipt: [M1a JSON](m1a-completion-preparation-20261030.json).
