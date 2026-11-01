# Index preflight — issue #526

Scope: a read-only wrapper around existing project-success and llms validators, regression fixtures, the existing project-success CI job and maintenance instructions. No product behavior, dependency, hook installation or automatic index rewriting.

Acceptance: missing inventory entries, stale PROJECTS and missing llms navigation fail with paths and repair instructions; a valid repository passes without file/index changes; both validators report failures. Local and CI use the same entrypoint.

Verification: regression tests first, all scripts/tests, common entrypoint on candidate, whitespace check and independent review. Refs #526.
