---
document_type: test-plan
node_id: P05
status: done
derived_from:
  - P05-vps-deployment-bundle.md
  - P05-implementation-plan.md
owner: codex
---

# P05 test plan

## BDD mapping

| BDD | Level | Oracle |
|---|---|---|
| P05-BDD-01 | shell contract | fake Docker log has ordered `config`, `pull app`, and health-waiting `up` commands |
| P05-BDD-02 | shell contract | invalid cases exit non-zero with an empty fake Docker log |
| P05-BDD-03 | shell contract | injected `up` failure propagates and success text is absent |
| P05-BDD-04 | Compose/static | resolved model has bind data, no published ports, required Traefik labels, and external edge |
| P05-BDD-05 | shell/static | commands are service-scoped; forbidden global mutations are absent |

## Red state

| Test | Initial failure |
|---|---|
| Bundle syntax | `ops/compose.yml` and `ops/deploy.sh` are absent |
| Input isolation | no versioned entrypoint enforces app or tag validation |
| Health gate | old runbook snippet uses plain `up -d` |
| Production scope | old runbook snippet runs host-wide `docker image prune -f` |
| CI regression | workflow does not execute deployment-bundle tests |

## Automated local verification

`tests/ops/deployment_bundle_test.sh` must:

1. syntax-check itself and `ops/deploy.sh`;
2. resolve `ops/compose.yml` with `ops/.env.example` using real Compose;
3. run the deploy entrypoint against a fake `docker` executable;
4. assert the exact successful command sequence;
5. assert unknown app, wrong arity, mutable/short/uppercase/malicious tags, and
   a missing app directory fail without Docker invocation;
6. inject Compose validation, pull, and health-wait failures and assert every
   failure propagates without a success message;
7. inspect the resolved model and source for the persistence, ingress,
   hardening, and forbidden-operation contracts.

The same test script runs before Docker build in both P04 workflow build paths.

## Main-agent smoke verification

1. Build the production image with a local verification tag.
2. Start it with a read-only root filesystem, noexec general `/tmp`, a bounded
   executable SQLite-only tmpfs, and a temporary bind-mounted data directory.
3. Wait for Docker health and request `/api/health`.
4. Confirm SQLite writes persist through a container replacement.
5. Stop only the named verification containers; retain no test process.

## Review gates

- Review every delegated line against the frozen allowed paths.
- Run `actionlint .github/workflows/deploy.yml`.
- Run `git diff --check`.
- Search the P05 diff for credentials and forbidden Docker operations.
- Open a pull request and require the online validation job to pass.

## Exit criteria

Repository P05 is complete only after automated tests, local smoke checks, and
the pull-request workflow pass and a verification report is committed. Actual
VPS installation, DNS, secrets, and enabled SSH deployment remain explicitly
pending Phase 6 evidence.
