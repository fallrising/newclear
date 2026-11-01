# Workflow static validation — issue #525

Scope: one shared local/CI entry using a digest-pinned official actionlint release,
real regression fixtures, a path-filtered root workflow and monorepo maintenance
instructions. No product behavior, dependency, nested-workflow activation or
existing permissions/concurrency/timeout changes.

Acceptance: invalid runner context in job-level env fails before Actions
scheduling and reports its file/position; step-level runner env, GITHUB_ENV and
matrix expressions pass; every enabled root workflow passes. Downloaded verifier
stays outside the source tree and is verified before execution. ShellCheck and
Pyflakes are separately excluded optional integrations, not ignored Actions
validation errors.

Verification: regression RED before checker implementation, GREEN on pinned tool,
current root workflows, existing project-success contract checker, whitespace
and independent parent review. No worker commits or external mutation.
