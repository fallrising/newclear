STATUS: DONE

## Summary

W2 provides Back media/relation pickers, media management, publish requests, saved-work preview/revision restoration, and the album, schedule and board workflows. Album pointer dragging and menu actions now use one atomic changed-row batch; board moves send only a versioned status patch and restore the previous card position on failure. Schedule ranges use the browser's local day. This closes C-08/C-09/C-10/U-03 and the W2 UI portions of G-03/G-09/G-10.

Implementation is incremental on merged BW2 PR235, preserving P0 form dirty/version protection, BW1 validation/pagination and BW2 CAS behavior. Complete album/project/photo selectors remain complete; batches above100 changed rows fail locally before any write. Selected media changes stay local until form save; untouched expanded media values retain their representation. Principal references remain read-only as specified. Owner explicitly approved core6.3.1/sortable10.0.0; no existing locked package version changed.

Independent reviews resolved the media-object clone PATCH defect, insufficient private-byte mock authorization, and responsive picker/tab layout problems before acceptance. T705 completes both formerly deferred drag cases, including release-click protection and disabled dragging during writes or without update capability. T706 provides final independent source/evidence review. Publication follows the owner's standing authorization after this local acceptance; no deployment is included.

## Verification

- `npm ci`: root clean install using the approved lockfile, exit0; `w2-drag-npm-ci.log`. Exact dependency delta is [recorded](../evidence/w2-drag-dependencies.json) — passed
- `npm run lint && npm run typecheck && npm test && npm run build && npm run test:bundle`: root final chain exit0;395 tests (API32/auth43/fields61/mocks92/UI18/Admin7/Back133/Front9), all three applications built and passed bundle checks; `w2-accepted-{lint,typecheck,web-test,build,bundle}.log` — passed
- `CI=true npm run e2e:mock` using the existing Chromium font/library environment: all39 tests passed in2.0m, no grep exclusions or retries; `w2-accepted-e2e.log` — passed
- Bounded drag Red→Green: the two retained pointer journeys first failed with no batch/no card move, then both passed; release-click regression verifies an accidental release click is suppressed and a fresh click remains usable. T705 records133 Back tests plus lint/types/build — passed
- `CMS_EVIDENCE_DIR=./w2-browser/accepted/ node .team/evidence/w2-browser-capture.mjs` with the documented local browser environment: eight final desktop/mobile captures, zero browser errors or horizontal overflow. Root visually reviewed all eight; [browser summary](../evidence/w2-browser/accepted/summary.json). Full E2E also retains critical/serious axe0 and mobile picker/tab geometry checks — passed
- 403 final source hashes equal the gate-launch manifest;229 protected source/build/dependency files match BW2. Only Back package.json and the npm lockfile are excluded for the approved dependency additions; all pre-existing locked versions unchanged — passed
- Java/PostgreSQL evidence reuse: backend source/build dependencies remain identical to merged BW2, whose complete remote CI37146275424 succeeded with254 Java/120 PostgreSQL baseline. No W2-local backend command is claimed. The W2 PR must additionally pass its required remote backend jobs before merge — passed
- Runtime OpenAPI byte-equals BW2; API freshness tests passed. Immutable snapshots412/449/468/566/602 and the original468-file integration tree remain intact — passed
- `python3 "$W2_DOC_CHECK"`: all six task/report pairs, delivery reports,33 changed/new relative links, diff/new-file whitespace and snapshot/source checks passed; `w2-final-doc-validation.log`. Raw local Playwright trace artifacts are outside publication scope — passed
- Independent T701/T704/T705 scoped reports and root diff review accepted; T703's historical findings resolved, T706 final review accepted without unresolved defect — passed

Source, protected files and logs are bound by [verification summary](../evidence/w2-verification-summary.json), [final source manifest](../evidence/w2-final-source-manifest.json), [protected manifest](../evidence/w2-protected-manifest.json) and [log manifest](../evidence/w2-log-manifest.json). Complete logs and raw Red traces remain local; compact hashes and browser screenshots are reviewable repository evidence. The earlier [PARTIAL checkpoint](W2-PROGRESS.md) and worker histories are retained as historical records, not current acceptance status.

## Documentation

W2 section0 was written before implementation and amended before review corrections. The PLAN records bounded isolated Codex workers, a cheaper independent Codex reviewer, dependency authorization and root acceptance. README, roadmap and readiness identify LOCAL_VERIFIED separately from remote publication. Task/report contracts, changed/new document links, source protection and whitespace are checked before commit.

Historical failures remain explicit: missing-wrapper/mocks Red, fixture/version assumptions, media-clone Red, private-byte permission Red, mobile picker/tab geometry Red, and both drag Red journeys. Final gates resolve them. The initial dependency install was invoked one directory above the npm workspace and failed before changes; the component install and clean npmci succeeded. Automatic review rejected broad copying into a dirty worker; a new clean worktree preserved the old worker and safely isolated T705. The initial delivery-report list marker failed validation and was corrected; raw generated Playwright failure Markdown is retained unmodified locally and excluded from publishable-document hygiene. No product test or source check was weakened to manufacture acceptance.

## Risks and Follow-ups

The unchanged dev-transitive brace-expansion high advisory remains: `npm audit --json` exit1, recorded in `w2-drag-npm-audit.json`. It was already documented in W1/readiness and is outside this scoped dependency addition; no audit fix or unapproved upgrade was performed. Small-touch-target advisories and existing build chunk notices also remain visible.

Browser evidence uses MSW placeholder media and does not establish real-API media behavior. BW4 application/DataSource wiring, real-API browser journeys and backup/restore/seed/media-index operational acceptance remain open. This local verification does not establish production readiness. W2 publication requires successful remote CI and exact-head merge; no later milestone, release or deployment is included.
