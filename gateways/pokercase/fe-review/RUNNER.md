# Bounded original Round2 runner

Only the parent launches this runner inside the approved nonroot, network-none container. Source/tools/binary are read-only; state is new0700 and run output private/ignored. Root provides the exact built binary, unique run ID, Playwright/Chromium/axe paths and explicit data directory. No existing HOME/state/credential mount or provider import/login/refresh is allowed. Shared capture tooling is unchanged.

**Always specify the phase. The historical default is `repair`; after the later CSS change its old hash guard deliberately fails. It is not a default command for reproducing the latest packet.** Do not weaken the old guard or overwrite its receipts.

Parent launcher positional form is `launch.py <new-run-id> <mode>`; it exports `FE_REVIEW_MODE` and invokes `node gateways/pokercase/fe-review/run-review.mjs` in the container. The private launcher itself is parent-owned, not supplied as a public standalone deployment tool.

| Mode | Actual coverage / use |
| --- | --- |
| baseline | Original28custom measurements, before corrections. Historical source only. |
| presentation | Original24shared +22strict companions +firstTUI measurements. Original oneunlocated404FAIL preserved. |
| continuation | Historical renderer/CDP/contrast/journey candidate; original early-login FAIL and oldTUI clipping retained. |
| repair | Historical TUI-normal-name repair+14journeys under its pinned pre-width-fix CSS. Do not run against later CSS. |
| visual | Latest native binary:18affected table custom screenshots/actual row+column geometry/axe/currentcontrast+14journeys. Skips TUI/shared/CDP. Reuses six unchanged shared views and12terminal captures only through source/artifact guards. |
| contrast-desktop | Same visual binary/fresh real API seed; exactly the single pinned visual-001 Usage desktop incomplete node at1440×900. No matrix/journey/TUI/CDP rerun. |
| tui-only / journey-only | Historical bounded source-specific phases, never a complete acceptance claim. |

Latest observed parent runs are `visual-001 visual` (PASS50.369s) and `contrast-desktop-001 contrast-desktop` (PASS3.002s). The latter corrects only a helper viewport error; all12other currentcontrast sets retain their original valid dimensions. Mode/source/native/artifact hashes and original failures are in the [report](tasks/round2/report.md) and [machine index](tasks/round2/result.json).

Main450s, launch30s, resource drain35s, independent bounded context/browser/capture/TUI/service/mock/listener cleanup and outer600s remain mandatory. Terminal capture uses only its uniquely claimed socket and explicit pane/server/process group; q/Esc restoration and positive absence are recorded. One-time key is RAM-only and ordinary list is loaded before screenshots.

True new-document navigation waits are armed before Enter; exact POST status, new document status and finalURL remain required for redirects and sameURL400/403/200. Unknown health events fail. The original shared console404 is unlocated; separate CDP evidence corroborates a favicon404 without identifying that same event. Current controlled400/403 remain visible, not erased as zero health.

The final width repair changes only `.table-scroll` selectors. Actual18view maximumrow128.984375px replaces the measured >1000px collapsed-row regression. Local horizontal scrolling is intentional and Actions keyboard access is verified.13contrast-incomplete sets remain;520computed pairs plus representative image inspection are not exhaustive manual accessibility certification. PR603 passed required current CI, normal merge and fetched scoped equality; see [delivery receipt](tasks/round2/evidence/delivery.json).
