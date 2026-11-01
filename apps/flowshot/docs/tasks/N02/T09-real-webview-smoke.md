---
generated_at: 2026-10-23T04:18:40Z
document_type: task
node_id: N02
id: T09
status: done
owner: orchestrator
derived_from:
  - ../../../SPEC.md
  - ../../nodes/N02-workspace-lazy-tree.md
  - ../../adr/ADR-003-workspace-boundaries.md
source_version: 1.0.2
source_sha256:
  SPEC.md: b569c2181559270221de3e81ce1d59fad136932299629f805fb10155938357b0
  N02: e1994e03209cb624d5430169d6866b63884712917f04841d8c1416a06b227f2e
  ADR-003: 5e929e434782cd8650641994555fc6eec5036530fac72ba4777308e447352f66
---
# T09 — Real picker, tree and binary asset WebView smoke

Goal: exercise the standalone N02 component and native commands inside an actual Linux Tauri WebView without claiming N03/N04 or M1 acceptance. This uses an artifact-only frontend bundle and isolated synthetic app-data; the product App remains unchanged.

Scope: `src/features/workspace/native-smoke.tsx`, `scripts/n02-native-smoke.py`, task/verification documentation. Root owns shared test integration; no worker delegation. All generated HTML/config/builds, 5000-file fixture, DB, screenshots and logs stay in shared task artifact/evidence directories.

RED: run the driver with no test entry and preserve failure. GREEN: real system directory picker grants the synthetic root; first expansion reaches500 real rendered file buttons under500ms; opening preserves original BOM/CRLF/source hash; asset response is actual ArrayBuffer, Blob URL decodes as an image and is revoked; unknown root admission is rejected without picker grant. Capture PID-owned visible window and screenshot. Do not weaken CSP or add a network report channel; the harness writes bounded synthetic result metadata through existing workspace commands, and the driver reads only its isolated test DB.

Measure first tree expansion through WebView rendering, separately from dialog/setup time. Use original500ms oracle. Native first-page debug timings alone do not establish this check. Preserve failures; no production shortcut, fake directory picker or mock native command.

The test configures the real dialog’s initial directory to its synthetic fixture, then confirms it through X11 keyboard input. The dialog and its native grant remain real; no scope is injected. This avoids dependence on recent-directory history and long-path typing in a window-manager-free Xvfb session.

Executed: the missing-entry RED and two harness failures (window-manager activation, then unconfirmed path-entry navigation) are retained. The third native run passed: 179ms, 500 rendered file buttons, denied ungranted root, unchanged BOM/CRLF/hash, raw ArrayBuffer, decoded/revoked Blob and all5001 fixture files unchanged. See `evidence/real-webview.json` for immutable log hashes. This completes only the bounded Linux smoke task.
