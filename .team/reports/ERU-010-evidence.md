# ERU-010 local slice evidence gate

## Decision

PASS for the reviewable local fresh-cleanup and replacement candidate. This
gate does not complete formal ERU-010, change the fixed task count, accept the
active V11 run, or authorize deployment. The authorized PR, GitHub CI, merge,
and local-main fast-forward remain the delivery steps after this local gate.

## Scope and requirements

The candidate implements only the continuation prompt's local/fake-fixture
slice: a fresh exact-ID cleanup plan after partial worker-loss dissociation and
a fresh hash-bound replacement wrapper using sequential ERU-012 children. It
adds the private lifecycle, five CLI routes, operator documentation, and
regression coverage. It does not remove the lost node, resume the target,
repair quota, select a different destination, touch provider APIs, or connect
this implementation slice to a VPS.

## Evidence map

| Required gate | Visible evidence | Result |
| --- | --- | --- |
| Applicable instructions, baseline, main/PR/CI, and active-soak boundary inspected | Continuation prompt and required ERU documents were read; `.team/PLAN.md` ERU-D001–D003 records the reconciled baseline and read-only V11 boundary | PASS |
| Red before Green | `.team/PLAN.md` ERU-D004 records the focused import failure for the intentionally missing `execute_fresh_cleanup` API before implementation | PASS |
| Fresh partial subset, no replay, drift/tampering, replacement/readiness, private-path, duplicate, and redaction scenarios | `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_worker_loss*.py' -v` — 30 tests, `OK` | PASS |
| Reused ERU-012 child lifecycle remains intact | `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_app*.py' -v` — 55 tests, `OK` | PASS |
| Full repository regression | `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v` — 413 tests in 62.187s, `OK` | PASS |
| CI parity source/document/private-file/diff validation | Exact `Validate sources, documents and private-file exclusion` Python block from `.github/workflows/eru-vps-mvp-ci.yml` — exit 0 | PASS |
| Independent architecture and regression audits | `teamctl.py validate-report` passed for `.team/reports/T-101.md` and `.team/reports/T-102.md` | PASS |
| Independent final diff review | `.team/reports/T-104.md`; joint source rehash and parent-directory symlink findings are closed, no open findings; `teamctl.py validate-report` passed | PASS |
| Orchestrator diff/scope review | Product source, new replacement orchestrator, private lifecycle, CLI, tests, and docs reviewed; `labs/eru-vps-mvp/prompts/` remains untracked and untouched | PASS |

## Failures and skips

No required local candidate check failed or was skipped. The optional report
contract path referenced by the evidence-gate skill is absent from the local
skill package; all three worker reports nevertheless satisfy the explicit
skill headings/status/evidence contract and pass the repository `teamctl.py
validate-report` validator.

## Residual risks and limits

- Provider/network fencing is still a reviewed caller attestation, not a
  provider-API observation.
- Destination capacity is authoritative only when ERU creates the child
  revision.
- Replacement recovery rechecks exact identities read-only and deliberately
  does not repeat HTTP probes; completion remains proven only by the original
  completed wrapper journal plus matching current identities.
- The active V11 run remains independent and incomplete until its documented
  end time and collection/report/manual-review gates.
