ROLE: WORKER
AGENT: native inherited
ID: T-442
Goal: Prepare reviewable M2 single-run acceptance setup from retained M1 scripts, without starting services/VM/provider or copying credentials.
Why: Parent finishes protocol security and required checks; reuse accepted M1 runtime.
Inputs to read first: .local/fanz-executor-20261031/handoff.json and scripts setup-live.py,setup-browser.py,live-api.py,live-worker.py,start-node.log,start-connector.log, browser acceptance config field names (never print values/secrets); main platform/fanzloud/acceptance/m1-browser.mjs and M2 spec. .local/fanz-m2-20261101/host-preflight.py and json. Main driver constructor config shape.
Scope (may touch): ONLY /home/ckc/test/codex/.local/fanz-m2-20261101/prep/ (mkdir0700), including scripts and concise findings.md. Read parent and old evidence. No Git or production edits.
Out of scope (must not touch): Launch/restart services, Docker/VM/provider calls, auth reads/exports, remote mutations, new dependencies, existing M1 artifacts, recursive delegation. Read-only SSH allowed via existing private configured alias with host-preflight mechanism; no de-4.
Definition of done:
- [ ] Identify exact existing connector/node service commands/config/runtime source and tunnel; sanitize findings to avoid host/account/secrets.
- [ ] Prepare scripts for parent review: isolated new M2 local Postgres/database/AP profile catalog Claude+Codex, one-shot worker, same HTTPS/Rust/Web stack, using retained pinned dependencies. No execution.
- [ ] Distinguish immutable reused M1 components vs current-source components, max1 VM4CPU4GiB/600s/zero-warm. No repeated coding retries.
Verify with: Python compileall on new scripts; no running setup. Report required parent variables/config and uncertain details.
Budget:15min active, <=2 attempts for same read failure; no delegation. Provider executions0, token/cost unknown.
