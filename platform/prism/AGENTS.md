# Prism implementation instructions

These instructions apply to every file below `platform/prism/`.

## Mission and workflow

1. Read this file and the complete `docs/sdd/` pack before implementation.
2. Follow `docs/sdd/12-IMPLEMENTATION-PHASES.md` in task order, one task at a
   time. Do not expand the task scope.
3. Before editing, restate the task scope, dependencies, allowed paths, and
   acceptance criteria.
4. Preserve existing changes and edit only paths allowed by the current task.
5. Run the stated acceptance commands and report their actual output. Never
   claim a check that was not run.

## Architecture

- `pkg/**` must not import `internal/**` or `drivers/**`.
- `drivers/**` must not import `internal/**` or another driver.
- `internal/compat/**` must not import `drivers/**`.
- Business semantics live in `internal/**`; drivers only store and translate.
- The only backend access path is the `spi.Backend` interface. Concrete driver
  assertions are forbidden except for optional interfaces defined by `pkg/spi`.
- Every feature must have correct behavior on the weakest `memory` driver.

## Engineering and security

- Use only Apache-2.0, MIT, BSD, or MPL-2.0 imported dependencies. Never import
  `grafana/loki`, `grafana/tempo`, `grafana/grafana`, or another AGPL project.
- Treat LogQL as clean-room work: do not read or copy Loki source code.
- Telemetry time conversion goes through `pkg/utm/time.go`; do not perform ad hoc
  timestamp unit arithmetic elsewhere.
- Every I/O path accepts `context.Context` and honors cancellation. Buffers,
  concurrency, scans, and result sets must be bounded.
- Iterators and closers must always be closed. Errors must retain their
  `spi.Error` classification.
- Every store operation is tenant-scoped. Parsed user matchers may not override
  `__`-prefixed system labels.
- Secrets use `internal/secret.String`, support `_file` variants, and must never
  appear in logs, errors, API responses, or serialized configuration.
- New settings update the config type, defaults, `--config-check`, the SDD
  example, and `deploy/prismd.yaml` together.
- New self-telemetry is first registered in
  `docs/sdd/20-SELF-TELEMETRY-REGISTRY.md` with a cardinality assessment.
- Behavior changes require tests; concurrent code must pass `-race`, and
  long-lived goroutines require leak checks.

## Git and completion

- Use one branch per SDD task, never force-push shared history, and reference the
  task ID in the commit message.
- Do not modify `pkg/spi` public interfaces or root workflows unless the current
  task explicitly permits it; SPI interface changes require an ADR.
- Completion reports include the task ID, changed files, commands and actual
  outputs, acceptance mapping, unfinished work, risks, and open questions.
