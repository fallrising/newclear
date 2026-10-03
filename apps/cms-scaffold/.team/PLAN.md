# CMS personal-use delivery

Owner: Codex orchestrator. User authorization: documentation first, then local development with a cost-aware multi-model team. Initial scope was local only. The owner subsequently authorized publishing and merging the P0 PR, then continuing development. Deployment remains unauthorized.

Baseline: newclear 82cd9d8, apps/cms-scaffold. The archived standalone repository is historical. BW0 and W0 exist; other waves are specifications, not implemented features. Preserve all unrelated working trees.

## Sequence and scope
1. Inspect current code and upstream satnaing/shadcn-admin; document an explicit P0 reliability wave and reference mapping before implementation.
2. Review the specification, then dispatch disjoint isolated workers: T-101 content transactions/concurrency (Codex); T-102 form value safety (Codex); T-103 independent document/design review (Grok fast or Gemini Flash).
3. Integrate diffs without commits; independently review and run backend test/integrationTest plus frontend lint/typecheck/test/build/test:bundle/e2e:mock.
4. Record exact evidence, skips, remaining production readiness work. P0 is not completion of all v2 waves or production certification.

## Model routing
Codex primary reasoning and data integrity. Use available CLI model listings, not remembered names. Prefer bounded fast reviews; at most three workers and no recursive delegation. Read-only external reviewers cannot mutate code or call other agents. Initial discovered candidates: grok-4.7-build-fast; agy gemini-3.8-flash-medium; cursor composer-2.5 or claude-sonnet-5-5-medium. Do not use all providers merely to fill seats.

## Acceptance gates
- [x] P0 document ready before implementation; historical/reference assumptions corrected.
- [x] Backend rollback and concurrency regressions pass against PostgreSQL.
- [x] Frontend typed values, clearing fields, conflict retention and pending state regressions pass.
- [x] Required repository checks run and outcomes recorded.
- [x] Independent review resolved; scope/diff reviewed; no unapproved dependencies or external mutations.

## Review-driven P0 correction
Independent code review found media public authorization used the working attachment index without matching publishedPayload media ID. P0-DATA extended before implementation: index work/published union; public authorization exact published media ID and enabled type; lifecycle/revert isolation regressions. No API/dependency/schema expansion.

## Acceptance — 2026-10-03
P0 accepted as LOCAL_VERIFIED only. All four task/report contracts validate. Orchestrator independently reran final integrated Java gates without cache (114 unit/API + 60 PostgreSQL tests), frontend gates (133 tests), mock E2E (17), and Chromium desktop/mobile form checks. Required final checks have no failures/skips. Initial browser missing-library failure was resolved with existing local libraries; Grok review was not accepted and Gemini/Claude supplied bounded independent reviews. Detailed evidence and residual production work: reports/DELIVERY.md. No commits, pushes, deployment, new dependencies, or external mutations.

## Publication authorization
The owner explicitly requested merging the P0 PR, then continuing development. No P0 PR existed, so prepare the scoped commit and PR, wait for CI, and merge it. This session instruction supersedes the earlier local-only boundary. It does not authorize other projects’ PRs or deployment. Machine-specific paths in published evidence are replaced by descriptive environment variables; original raw logs remain local.
