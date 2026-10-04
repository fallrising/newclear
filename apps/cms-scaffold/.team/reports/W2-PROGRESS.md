STATUS: PARTIAL

Historical non-drag checkpoint, superseded by [final W2 delivery](W2-DELIVERY.md) after explicit dependency approval. Its PARTIAL status and skips describe that checkpoint only.

## Summary

BW2 PR235 merged after all remote checks succeeded; see [publication evidence](BW2-PUBLICATION.md). W2's non-drag implementation is integrated and independently reviewed. The milestone remains incomplete: album and board pointer dragging require explicit authorization for the two pinned runtime dependencies. The retained two drag E2E cases were excluded from the selected run, not passed or removed. No W2 commit, push, PR, merge or deployment has occurred.

Implemented media/relation pickers, safe field display, media library/upload/recycle, publish requests, saved-work preview/history/revert, local-day schedule, versioned board actions and atomic album reorder actions. Complete album/project/photo pagination is preserved; changes above the 100-row atomic batch limit are rejected before submission. Existing dirty/version/read-only safeguards remain. Independent review found and resolved cloned media projections producing spurious PATCH values and insufficient private-byte mock authorization. Browser regressions fixed long picker-label overflow and wrapped mobile board tabs.

## Verification

- `npm ci`: clean install exit0; dependency manifests and lock remain unchanged; `w2-npm-ci.log` — passed
- `npm run lint && npm run typecheck && npm test && npm run build && npm run test:bundle`: root full frontend chain exit0; 380 tests (API32/auth43/fields61/mocks78/UI18/Admin7/Back132/Front9); logs `w2-lint.log`, `w2-typecheck.log`, `w2-web-test.log`, `w2-build.log`, `w2-bundle.log` — passed
- `npm test -w @cms/mocks`: final private-media correction adds14 cases, 92/92 green; `w2-mocks-final.log`. Latest per-package evidence totals394, not a separately executed394-test full command — passed
- `npm run lint -w @cms/mocks -w @cms/fields && npm run typecheck -w @cms/mocks -w @cms/fields && npm run build && npm run test:bundle`: final mock/picker delta; `w2-final-{lint,typecheck,build,bundle}.log` — passed
- `npm run lint -w @cms/web-back && npm run typecheck -w @cms/web-back && npm run build -w @cms/web-back && npm run test:bundle`: final local board CSS correction; `w2-back-final-{lint,typecheck,build,bundle}.log` — passed
- `CI=true npm run e2e:mock -- --grep-invert 'dragging a photo|a drag moves'` with documented local Chromium library/font environment: 37 selected tests passed in1.2m, including mobile geometry, accessibility and retained P0/W1 flows; `w2-e2e-final.log` — passed
- Two retained pointer-drag E2E cases: dependency authorization pending; neither executed in the selected run nor accepted — skipped
- `node .team/evidence/w2-browser-capture.mjs`: media/composer/board/picker at1440x900 and390x844, eight final captures, zero console errors or page overflow. Root visually inspected final screenshots; `w2-browser/ready/summary.json`. Browser-evidence skill additionally reports zero blocking findings at both media-library viewports — passed
- Source/protection evidence:403 final source hashes; exactly five files changed since the full380-test gate, covered by targeted tests/build/E2E above;231 protected backend/Front/Admin/auth/generated/dependency files unchanged; runtime OpenAPI byte-equals BW2 — passed
- All five immutable snapshots retain412/449/468/566/602 files; original468-file integration tree is unchanged — passed
- W2-local Java/PostgreSQL rerun: intentionally omitted because protected backend/build/dependency sources did not change. Reuse complete successful BW2 remote CI37146275424 (Java254/PostgreSQL120 baseline); do not represent this as a W2 command run — skipped
- `npm audit --json`: exit1 with the inherited dev-transitive brace-expansion high advisory; unchanged lock and dev:true verified. This is the existing W1/readiness finding, not a new W2 dependency; `w2-npm-audit.json` — failed
- `python3 /tmp/cms-w2-doc-check.py`: task/report validators,25 changed/new relative links, diff/new-file whitespace, final hashes and all snapshots; `w2-doc-validation.log` — passed
- Independent T703 review and T704 correction: no unresolved concrete defect in the implemented non-drag scope; worker reports preserve Red/Green and historical failures — passed

Logs are local ignored evidence; [log hashes](../evidence/w2-nondrag-log-manifest.json), [final source hashes](../evidence/w2-nondrag-final-source-manifest.json), [protected hashes](../evidence/w2-nondrag-protected-manifest.json) and [verification summary](../evidence/w2-nondrag-verification-summary.json) bind these observations. Early fixture/typecheck failures, expected Red regressions and initial browser font/layout failures remain retained; final scoped gates resolve them. Mock placeholder image bytes are intentional and are not proof of real media rendering through the Java application.

## Documentation

W2 section0 preceded implementation and each review correction. PLAN, roadmap, README and personal-use readiness now distinguish verified BW2 publication from partial local W2 work. T701/T702 used isolated bounded Codex workers; T703 used an independent lower-cost Codex review; root owns integration and acceptance. The owner standing workflow authorizes automatic publication after full milestone acceptance; it does not waive runtime dependency approval.

## Risks and Follow-ups

Await explicit approval for `@dnd-kit/core@6.3.1` and `@dnd-kit/sortable@10.0.0`. The prepared drag patch is outside the repository and only dry-run checked; it is not implemented or tested. After approval: record it, install exactly those dependencies, integrate/review drag behavior, run focused/full affected gates and all39 E2E, refresh evidence/docs, then automatically commit/push/PR/CI/merge and verify remote results. Do not publish this partial work as a completed W2 milestone.

Inherited dev dependency advisory and small-touch-target browser advisories remain visible. BW4 application wiring, real-API browser journeys, backup/restore and other operational gates remain open. No production-readiness claim or deployment.
