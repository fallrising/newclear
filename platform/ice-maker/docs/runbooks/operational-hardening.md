# Operational hardening runbook

This runbook covers local, offline response drills. Local evidence proves only
`DEVELOPMENT_COMPLETE`; it never proves `PRODUCTION_READY`. Production claims
require every external attestation and human approval listed by the readiness
result.

## First response and local verification

Stop new work, preserve the bounded evidence and relevant logs, and avoid
copying credentials or restricted source to a provider. Run:

```sh
PYTHONPATH=src python3 -m unittest tests.test_hardening_e2e -v
make check
git diff --check
```

Record the command, exit code, commit SHA, contract paths, and artifact
digests. A failed local control is an escalation, not permission to bypass a
gate.

## Runner offline or unhealthy

Quarantine the runner from scheduling and inspect its health, queue, cleanup,
and bounded metric results. Do not reuse a persistent or unhealthy worker.
Re-run the local journey above. Escalate to the infrastructure owner for host,
runner service, capacity, and external runner attestation; no local result
represents that attestation.

## Provider authentication, rate limiting, or model removal

Pause affected jobs and preserve the safe provider/model error identity without
logging authorization headers, tokens, or prompt contents. Confirm routing and
retry thresholds locally with `make check`; do not increase retries or select
an unapproved model to force progress. Escalate to the provider and identity
owners for account status, quota, model availability, and external identity
evidence.

## Cost spike or stuck agent

Stop dispatching the affected work and apply the finite ceiling. The local
check is:

```sh
PYTHONPATH=src python3 -m unittest tests.test_hardening tests.test_operations -v
```

Inspect only bounded cost, token, tool, queue, retry, and timeout metrics.
Resume only after the stuck work is cancelled or replaced and the ceiling
passes. Escalate provider billing/usage evidence and human approval; never
claim that a local ceiling is a production alert.

## Secret detected in tree, history, or log

Stop work, revoke the exposed credential through the approved broker, and
preserve the finding location and hash without copying the secret value. Do
not paste it into an issue, test output, or chat. Scan the affected tree and
history using the repository-approved secret scanner, then rotate and verify
metadata locally:

```sh
PYTHONPATH=src python3 scripts/check_repo.py
PYTHONPATH=src python3 -m unittest tests.test_hardening -v
```

Escalate to security for purge/rewrite decisions, incident handling, provider
revocation confirmation, and external credential-rotation evidence.

## Compromised runner rebuild

Quarantine the runner and preserve minimal forensic identifiers. Follow the
only accepted local order: `detect`, `revoke`, `destroy`, `rebuild`, `canary`.
The compromised identifier must not be reused. Verify with:

```sh
PYTHONPATH=src python3 -m unittest tests.test_hardening_e2e -v
```

Escalate for host replacement, image provenance, network isolation, canary
results, and external compromised-runner attestation.

## Knowledge-source takedown or redaction

Stop publication and mark the source unavailable. Preserve source hash,
location, page/chunk, extractor, confidence, and the distinction between
observation and interpretation. Remove or redact only through the approved
maintainer workflow; rebuild generated publications from the remaining
sources. Escalate legal/rights and knowledge-owner review, and retain their
external takedown or redaction evidence.

Verify the local source and publication boundaries with:

```sh
PYTHONPATH=src python3 -m unittest tests.test_knowledge_e2e tests.test_publication_e2e -v
```

## Ledger or object restore

Do not overwrite an existing destination. Use a disposable local directory and
the hash-bound manifest; the restore must publish nothing if any byte is
corrupt, missing, symlinked, or colliding. Verify the complete journey and
inspect the restored bytes before any external action:

```sh
PYTHONPATH=src python3 -m unittest tests.test_hardening tests.test_hardening_e2e -v
```

Escalate to the storage owner for object-version selection, retention/legal
holds, immutable-backup verification, and external restore attestation.

## External evidence checklist

Before any production decision, obtain independent evidence for runner,
short-lived identity, deny-by-default egress, restore target, credential
rotation, telemetry/cost alerting, compromised-runner drill, and human
production approval. Confirm each item is tied to the deployed commit and
environment, with provenance and artifact digests. Local fixtures, synthetic
commits, tabletop drills, and `DEVELOPMENT_COMPLETE` are not substitutes.

## No-production-claim rule

Never report `PRODUCTION_READY` from this repository’s local journey. If any
external gate is absent, stale, unverifiable, or contradicted by a local
failure, report the specific pending/failed gate and keep production disabled.
