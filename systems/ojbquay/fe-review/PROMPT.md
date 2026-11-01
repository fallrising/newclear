# FE Review Prompt — ojbquay console

Read the component AGENTS/SUCCESS, [approved DESIGN](DESIGN.md),
[protocol](../../../docs/fe-review/PROTOCOL.md), [current REVIEW](REVIEW.md) and
[R2 report](tasks/round2/report.md) before further work. The owner approved R2
M1–M4 plus its bounded review-only isolation/gRPC addendum. Required local evidence
is assembled; independent final acceptance/CI/publication remain root-owned.
This is not permission for a new milestone, full Round3, backend/API change,
production deployment or dependency upgrade.

The UI is the existing light/en-US React19/Vite8/AntD5/ECharts SPA. Nine routes are
verified through the real stack and exact loopback frontend/proxy. Raw `pnpm dev`
is insufficient without the approved harness. Use [RUNNER](RUNNER.md) and
[ISOLATION](ISOLATION.md); never adopt a default retained Compose project or delete
resources without fresh exact-ID/label/membership proof. The historical measured
stack has been removed and must not be silently restarted.

The relevant flows include actual ADMIN login/session/CSRF, topics/groups,
PUSH/PULL subscriptions and preview, actual DLQ, ProduceDelay with REST readback,
missing delay and wrong password. Empty/500 route overrides are supplemental.
42 states/27 route images/three chart images are indexed with source hashes;
private PNGs and raw state are never public output.

Retain the original failures and current limitations: source Google Fonts,
AntD warnings, actual axe findings/preload incompleteness and inaccessible mobile
Logout. Six drawer images were replaced after pixel-mask verification. A clean
HTTP response or screenshot alone is not evidence of a real authenticated page.
No full Round3 or new mainline/usable qualification is claimed.
