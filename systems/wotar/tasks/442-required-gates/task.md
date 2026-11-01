# 442 — Wotar required gate repair

Issue: https://github.com/fallrising/newclear/issues/442
Component: systems/wotar
Requirement: T-0368 (desk PR99 merged)
Source: 0e76de010ab8c42dbf597c30e14d555c0755fffb
Start: 2026-10-21T17:27:10+00:00
End: 2026-10-21T17:44:00Z
Last_activity: 2026-10-21T17:44:00Z

Outcome: lint fixed and original required checks rerun without overwriting existing credentials/config.
Inputs: SUCCESS, AGENTS, secure-mqtt-e2ee README/Makefile/pyproject, progress/requirements, integration fixtures.
Scope: systems/wotar/**; .github/workflows/wotar-ci.yml; PROJECTS.md; .team/PLAN.md;
docs/project-success/evidence/wotar-repair/**; docs/project-success/qualifications/wotar-repair.md.
Exclusions: other products, existing secrets/config/certs, dependencies, deployments, paid/live models, existing tags.

## Definition of done

- [x] Preserve baseline I001 then minimum import fix; lint/type/unit/security/property/doctor/coverage pass.
- [x] Fresh synthetic cert fixture eliminates all three prior skips; real local EMQX TLS/ACL/E2EE/replay/rotation/recovery checked.
- [x] Public broker opt-in synthetic smoke tried without modifying user data; failures remain explicit and prevent unsupported tag.
- [x] Docs, independent review, necessary CI, normal PR merge and remote readback; owner acceptance separate.

## Verify with

In isolated secure-mqtt-e2ee fixture: make lint typecheck doctor test coverage test-integration;
SECURE_MQTT_RUN_PUBLIC_SMOKE=1 .venv/bin/pytest -m public_smoke.
Root: python3 scripts/check_project_success.py; python3 -m unittest discover -s scripts/tests -p test_project_success.py -v; git diff --check.
Runner copies only tracked source to a new fixture, generates owned certs/keys and uses dedicated container/loopback only.

## Budget and authority

30-minute checkpoints; at most two diagnostic retries per unchanged failure before reassessment.
Owner authorizes necessary code/tests/docs, commit/push/PR/CI/review/normal merge/readback and conditional NEW annotated usable tags.
No recursive workers, no runtime dependency/permissions/deploy/real users/models. Unknown provider requests/cost remain null.
Refs only; issue remains owner acceptance pending. Technical delivery may complete with explicit unqualified mainline gaps.

PR443 merged9b3d4242; required CI/review passed. Annotated usable/wotar/v0.1.0 remote object/peeled commit verified. Final metadata PR pending; owner acceptance remains separate.
