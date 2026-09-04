# Docker Functional Demo

## Context

The repository has a production-shaped Compose stack and a real end-to-end
acceptance test, but a new evaluator has no single documented command that both
proves the golden path and leaves the verified product running for inspection.

## Goal

Provide a repeatable Docker demo that verifies the most important user journey,
keeps the successful stack available through browser and observability
endpoints, and has an exact cleanup command.

## Non-goals

- Production deployment or production-readiness certification.
- Load, capacity, failover, backup-restore, or multi-node chaos qualification.
- Replacing the existing Compose acceptance test.
- Committing generated logs, credentials, message payloads, or machine-specific
  Docker state.

## Acceptance Criteria

- Given Docker with Compose v2 and a clean checkout,
  when a user runs `make demo`,
  then an isolated 11-service stack is built and becomes healthy.
- Given the healthy demo stack,
  when the automated scenario runs,
  then it authenticates through session and CSRF protection, creates a topic,
  group, and PUSH subscription, produces through gRPC, observes a real HTTP
  delivery, verifies the consumer success metric, and finds every expected
  Prometheus target.
- Given a successful scenario,
  when the command returns,
  then the stack remains running and prints the console, Prometheus, and Grafana
  URLs plus local demo credentials.
- Given a retained demo stack,
  when the user runs `make demo-down`,
  then only the named demo Compose project and its disposable volumes are
  removed.
- Given a failed scenario,
  when cleanup runs,
  then the failing step, service state, and bounded relevant logs are printed.

## Constraints

- Reuse `e2e/compose_full.sh` as the executable acceptance path instead of
  duplicating provisioning or assertion logic.
- Use dedicated host ports and the fixed Compose project `ojbquay-demo` so the
  normal local development stack is not modified.
- The bundled `admin` / `local-admin-password` account is for isolated local
  demonstration only.
- The demo is at-least-once, like the product; a repeated run creates uniquely
  named resources.

## Assumptions and Unknowns

- Verified: the existing Compose E2E covers the golden PUSH delivery path and
  all runtime readiness probes.
- Verified: Docker Engine and Compose v2 are available in the authoring
  environment.
- The first run may download base images and build every runtime image, so its
  duration depends on network and machine capacity.
- Pull interoperability, retry/DLQ, delay timing, and administrative failure
  paths remain covered by their focused automated tests; they are not all
  expanded into this short interactive demo.

## Design

Make the existing Compose E2E project name configurable while preserving its
current CI default. A small `demo/run.sh` wrapper selects the dedicated demo
project, retains the verified stack, and prints inspection instructions. A
matching `demo/down.sh` removes that exact project. `make demo` and
`make demo-down` are the public entry points.

The README explains the five-minute evaluation flow. A committed report records
the environment, command, scenario-to-requirement matrix, result, and known
coverage limits from a fresh execution.

## Steps

1. Record this specification and execution-plan entry.
2. Add the configurable E2E project, demo wrappers, Make targets, and user
   instructions.
3. Run the Docker demo from a disposable project and inspect the retained
   services.
4. Publish the evidence report, rerun relevant quality gates, and clean the
   demo project.

## Verification

- `bash -n e2e/compose_full.sh demo/run.sh demo/down.sh`
- `make validate-deploy`
- `make demo`
- `docker compose -p ojbquay-demo -f deploy/compose/docker-compose.yml ps`
- HTTP checks against the retained console, Prometheus, and Grafana endpoints
- `make demo-down`
- `./gradlew build --no-daemon --no-parallel`
