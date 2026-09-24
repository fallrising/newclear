STATUS: DONE

## Summary

T-049 is an uninvolved, read-only W5 review of fixed product commit `7ab67ce5eb99967b820fa59df44c31808a40d631` against W4 base `55ce00a`, AC-WS-13–18 and W5 integration contract revision 2. **No confirmed source finding remains in the reviewed commit.** This is a reviewer conclusion, not W5 acceptance or a claim that the full browser and PR-head CI gates passed. The detached review checkout is `/home/ckc/test/codex/newclear-dim-gate-w5-review`. I did not implement source, delegate, change product/tests/config/docs/PLAN, commit, push, merge, deploy or send an external message. This report is my only authored checkout file. The available route was built-in Codex; the exact runtime model slug is not independently exposed. I make no Claude or multi-model claim.

The initial fixed candidate `1d4db07bf4d7494a63d256edb4ebe8ee2ea499bb` exposed F1: an Ops user with a pool grant could list, detail-read and audit-read another Ops recipient's notification attempts in the same pool. `b5ea07a8b8764c9511041b805cfc9945d93c38fe` added the recipient-ID check. On the final SHA, `canReadAttempt` requires current organization, recipient identity, retention and current source scope; list, detail, retry and notification-attempt audit use that guard. Domain and HTTP tests exercise two same-pool Ops recipients in both directions, failed retry as a new attempt, and readback disappearance after pool revocation.

The correction from `b5ea07a` to `5cb17dd5fd0b6a7f4a8668c1653972c494c9cc2a` closes F2–F6. Direct RD delivery/traffic and monitoring reads now use underlying route grants while cohort filtering remains on navigation and new commands; running delivery readback survives disabling the cohort. Route diagnostics, active notification templates and current recipient/channel checks select by organization, closing the cross-organization F3 scope issue. Feature policy's `everActivated` marker keeps a first draft/validation at default availability and a restored draft after disable unavailable until reactivation (F4). The last-Admin predicate now counts only effective same-organization Admin grants (F5; the earlier global predicate was inconsistent but a last-Admin loss was not reachable through the existing self-disable-protected API). The RD subscription form submits the currently displayed available channel rather than a stale fixed default (F6). The migration preflight now runs W4 invariants on the original parsed W4 snapshot before W5 data is added, classifies extra valid legacy identities as `demo`, and selects/sizes seeded notification defaults for the appropriate organization. Focused tests cover these changes.

The final `5cb17dd..7ab67ce` correction closes F7. `/session.featureKeysByProject` evaluates the same domain cohort for each readable project; monitoring and service-delivery creation/detail controls consume that project result. A user included for Store but excluded for Payments sees the Store actions and only readback in Payments; the domain's project-specific 403 remains authoritative. The global feature keys still govern project-free navigation. I inspected the complete 10-file correction delta, its contract/OpenAPI changes, domain assertion and Store/Payments Chromium regression source.

The full W4-to-W5 diff includes identity and grants, policy/version and idempotency, feature cohort, route registry, notification attempts, migration, API/runtime contracts, UI and focused regressions. Existing Demo users remain a fixed authentication allowlist; Team membership does not grant actions. New User/Team commands and replay preparation recheck current Admin identity and scope. No dynamic API route, external adapter, real message or cloud operation is introduced. The reviewed W4 native/migration/controller checks pass.

## Verification

- `git rev-parse HEAD` exactly `7ab67ce5eb99967b820fa59df44c31808a40d631`; detached checkout clean before this report — passed
- Full `55ce00a..HEAD` source/spec/test diff and each correction delta inspected; `git diff --check 55ce00a..HEAD` — passed
- Review checkout frozen install with Node 24.18.0/pnpm 11.18.0 at the initial W5 commit; lockfile and dependency manifest unchanged through final SHA — passed
- Independent final-SHA focused W5/W4 Vitest command: 14 files, 97/97 tests, exit 0 — passed
- Independent final-SHA `pnpm typecheck`: exit 0 — passed

The focused command was `pnpm exec vitest run src/domain/w5-*.test.ts src/demo/w5-*.test.ts src/domain/w4.test.ts src/demo/w4-migrations.test.ts src/demo/migrations.test.ts src/demo/w3-migrations.test.ts src/demo/controller.test.ts`. It covers identity, feature, route, notification domain and HTTP, versioned migrations and W4 regression. The lead reported final-SHA 426/426 native, lint/typecheck/contracts/docs/CI/architecture/demo build and focused real-Chromium Store→Payments/reload regression. I did not independently reproduce those complete gates or inspect their final logs; they are lead-reported, not my verification. I did not run an independent browser, performance, full Chromium, Firefox/WebKit, benchmark, isolation or PR-head CI job because the lead's full browser and CI work was concurrent with this review.

## Documentation

Read `platform/dim-gate/AGENTS.md`, `.team/tasks/T-049.md`, W5 integration contract revision 2 and affected SDD 01–07/09–14, latest dim-gate PLAN block, W4 baseline and W5 correction diffs. The SDD/validation links now identify revision 2; the contract records first-draft eligibility, readback after cohort disable, original-W4 migration preflight, and per-project session keys. This report records the initial F1 and later F2–F7 findings with their closure evidence without rewriting product history.

## Risks and Follow-ups

No open confirmed source finding remains on fixed SHA `7ab67ce`. The lead must bind the complete final-SHA Chromium, Firefox/WebKit, benchmark, isolation, unchanged-budget checks and exact latest PR-head CI evidence before its separate acceptance and normal merge decision. Any later product/test/config change requires independent review of that delta. This reviewer neither self-accepts W5 nor infers gate success from source inspection.
