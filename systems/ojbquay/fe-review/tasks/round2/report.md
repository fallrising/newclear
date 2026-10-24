# Ojbquay approved R2 M1–M4 report

The approved R2 implementation has its required local evidence. Independent final
acceptance, exact-head CI and publication remain root-owned gates. This is one
fresh, owned stack with explicitly approved bounded continuations, not eight
fresh environments or one uninterrupted passing run. Existing mainline/usable
qualification is unchanged; complete Round3 acceptance is not claimed.

## Scope and outcome

| Requirement | Observed result | Evidence |
| --- | --- | --- |
| M1 isolation/auth/seed | Eleven unchanged services, zero host publications, fresh credentials/resources, exact ownership; real UI ADMIN login/session/CSRF; REST topic/three groups/PUSH/PULL, actual message/DLQ, existing ProduceDelay RPC and authenticated readback | [Isolation](../../ISOLATION.md), [environment receipts](evidence/environment/publication-index.json), [attempts](evidence/attempts.json) |
| M2 states |42 unique states across1440/834/390 light viewports, including real preview, missing delay and bad-password401; empty/500 are explicitly controlled supplements | [Capture index](evidence/accepted-captures.json) |
| M3 drawer bounds | Unchanged CSS: DLQ834 computed/client/scroll/document834; group768 computed/client/scroll/document768. No CSS change justified | [Verification](evidence/verification.json) |
| M4 chart | ResizeObserver observes actual container, callback resizes, cleanup disconnects/disposes; fixed1440 same-document sidebar248→72→248 and canvas/container663→780→663 | [Verification](evidence/verification.json) |
| Route mapping | Nine real routes × three viewports: exact final URL/heading/content, HTTP200, document overflow0 and pageerror0 | [Derived health](evidence/browser-007-derived-health.json) |
| Resource cleanup | All tool containers removed; exact16 owned stack resources removed with positive absence. No retained service or permission to restart | [Cleanup](evidence/environment/stack-cleanup.json) |

Production changes are only DashboardPage's ResizeObserver effect and its focused
regression test. Backend, API/auth/proto, production Compose, dependencies/locks,
CI and styles remain unchanged. Review-only overlay/proxy/observers are bounded by
[the approved task](task.md) and [isolation contract](../../ISOLATION.md).

## Validation

- Full `./gradlew build --no-daemon --no-parallel`: exit0,102.356s. Reports contain
  153 cases/54 suites, zero failures/errors/skips;28 tasks executed and16 came
  from cache. This does not claim every Java test was freshly run.
- Final `pnpm test`: four files/six tests passed,11.304s. `pnpm build` passed
  TypeScript7 `tsc -b` and Vite; existing large-chunk warning remains.
- `make validate-deploy` passed6.519s. Original mock Playwright journey passed
  one test/9.8s, outer10.833s, with positive container removal; it is separate
  from the real-stack evidence.
- Focused actual-component RED/GREEN: initial invocation unexpectedly ran all
  four files; intended missing-observer RED plus unrelated preview5s timeout were
  retained. Corrected focused command passed two tests. Actual image build then
  exposed test-only TS callable/null typing errors; corrected focused two tests
  and build passed. Five-image build then passed4.977s. No validation weakened.
- Pure ownership/private-CLI7, proxy3, lifecycle4, health5, resume2, read-only API1,
  child-outcome1, naming1 and observer/PNG3 tests have recorded passing runs.
  They are separate focused commands, not a fabricated single aggregate run.
  Root subsequently ran the final combined focused checks: Python7 passed0.364s
  and Node20 passed0.466s; [receipt](evidence/native/root-final-checks.json).
  Lifecycle tests cover stalled/rejected close, late acquisition after cancellation
  and unknown acquisition; cleanup bounds remain truthful on timeout.

[Native publication index](evidence/native/publication-index.json) preserves
original/published hashes and normalization. [Verification](evidence/verification.json)
pins current sources, each tested-driver version and13 immutable manifests.
Reproduction commands and prerequisites are in [RUNNER](../../RUNNER.md).

## Actual failures and bounded continuations

| Attempt | Original outcome and disposition |
| --- | --- |
| Config/image setup | Actual resolved Compose extension initially rejected before resources; allowed only exact run/source extension. Initial image build TS test errors failed, then corrected build passed. |
|001 | PULL400 after topic/three groups/two PUSH. Fixture maxBatch16 exceeded concurrency1; corrected to1, preserving successful resource IDs. |
|002 | PULL/message/DLQ/delay succeeded; harness rejected omitted proto3 default OK=0. Existing RPC was never resent. A transient missing-subscription progress404 is retained; source supports a timing inference, not a blanket exception. |
|003 | Exact same-resource, prior-RPC-hash and delay read-only proof passed; drawer icon-name selector timed out before measurement. Corrected to existing source-equivalent selectors. |
|004 | Both M3 measurements passed; chart timed out waiting for expand. |
|005 | Same-document fixed-window collapse663→780 passed; after full-page PNG expand timed out. No navigation/reload observed; screenshot cause was a hypothesis. |
|006 | Viewport-only chart PNGs preserved state; full663→780→663 passed.41 state captures completed; mobile Logout had no accessible name. Child180s deadline interrupted the wait; cleanup.children=false/forced kill retained even though root removed the tool container. |
|007 | Only missing mobile negative state plus27 loaded routes/shared captures ran. All cleanup passed. Original FAIL was the exact axe-preload warning classification; immutable rows were subsequently classified offline, never rewritten as original PASS. |
|008 | Only six token-bearing drawer retakes and three audit-privacy checks ran;22.403s PASS, all cleanup and outer removal positive. No other states/routes/chart/drawers rerun. |

The final state union is006's41 minus six superseded images, plus008's six and
007's one mobile bad-password image =42. Selected artifacts total72:42 states,
27 routes and three chart images;84 raw PNGs remain private. M3 numeric proof is
retained independently of original screenshot privacy. Old images/source hashes
are never retroactively attributed to a corrected driver.

## Privacy and remaining findings

006 mobile-group visibly exposed a synthetic token during a drawer transition;
that image is privacy-failed. Five other original token-bearing drawer images are
redaction-unverified, not automatically declared exposed from zero mask pixels.
All originals remain private. The six replacements require stable visible token
rectangles, disabled screenshot animation, deviceScale1, unchanged geometry and
actual PNG mask coverage: all six measured100%. Audit desktop's four token
rectangles in the original007 image also measured100%; tablet/mobile Detail
rectangles are outside the current viewport width, with no retrospective
historical-exposure claim. No audit retake was required. [Redaction evidence](evidence/redaction.json)
and [008 receipt](evidence/browser-008.json) preserve exact bounds/hashes.

Existing findings remain unresolved and visible:

- Google Fonts is an external source dependency, blocked by the observer's exact
  loopback HTTP/WebSocket policy; no dependency or product font change was made.
- Exact AntD React compatibility and Modal destroyOnClose deprecation warnings
  remain classified by full source-confirmed text/hash, with console.error method
  recorded. Other console/request/HTTP failures are not silently accepted.
- Nine desktop axe preload runs were incomplete because of blocked font assets.
  Actual findings remain: nine serious color-contrast entries, one moderate
  missing-h1 entry and two minor empty-table-header entries. No axe-zero/full
  Round3 pass is claimed.
- Mobile CSS hides Logout text and icon spans, leaving no accessible name. It was
  not changed outside the production allowlist. Desktop/tablet logout passed;
  required mobile bad-password evidence uses a real anonymous context and401.

PNGs, raw API/audit payloads, generated credentials, session state and console
logs are ignored/private and archived by root. Public evidence contains sanitized
summaries, synthetic resource IDs and hashes, not those private contents.
