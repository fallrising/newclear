---
document_type: evidence
node_id: N00
task_id: T08
title: macOS launch and observability evidence
recorded_at: 2026-07-29
result: blocked
---

# T08 macOS launch and observability evidence

## Red

Before T08, `make macos-launch-smoke` did not exist and `get_build_info`
emitted no structured command completion record. T07 proved native build and
test coverage, but did not claim a launched window or cold-start result.

## Implemented oracle

The Mac-only target now:

1. builds an optimized release binary;
2. launches that binary as a child process;
3. compiles and runs a CoreGraphics probe that requires an on-screen,
   layer-zero window owned by the exact child PID;
4. waits for a JSON `get_build_info` completion record containing correlation
   ID, command duration, result code, and build info;
5. fails unless both signals occur in less than 1.5 seconds.

The command record shape has a Rust unit test. The generated command contract
and N00 lock were not changed.

## Failure loop

### Harness compilation

[Run 7](https://github.com/fallrising/flowshot/actions/runs/30473093868)
reached the new Mac target and exposed a Swift 6 CoreFoundation bridge error.
The probe was corrected to bridge the window bounds through `NSDictionary`.

### Acceptance attempt 1

[Run 8](https://github.com/fallrising/flowshot/actions/runs/30473660060)
compiled the release app and probe. Apple Silicon found the required on-screen
window, but no frontend-originated `get_build_info` record arrived before the
deadline. The adapter argument was renamed from `_request` to `request` so it
matches the frozen generated wrapper payload.

### Acceptance attempt 2

[Run 9](https://github.com/fallrising/flowshot/actions/runs/30474307544)
again found the Apple Silicon window but no command record. The probe was
changed to report command and window failures independently. The command log
was changed from buffered `println!` output to a locked write with explicit
flush.

### Acceptance attempt 3

[Run 10](https://github.com/fallrising/flowshot/actions/runs/30474874208)
produced these terminal results:

| Job | Result |
| --- | --- |
| Ubuntu 24.04 | all repository and native build/test gates passed |
| macOS 15 Apple Silicon | on-screen window passed; command record timed out |
| macOS 15 Intel | on-screen window and command record both timed out |

The same Apple Silicon acceptance failure remained after the argument and
buffering corrections. The three-attempt failure-loop limit is therefore
reached.

## Eliminated causes

- The application and optimized Mac release binary compile on both
  architectures.
- Native Rust command tests and strict Clippy pass.
- The production frontend bundle contains `get_build_info` and sends the
  frozen `{ request: {} }` payload.
- The release process remains alive during the probe.
- Apple Silicon proves that the process owns a real on-screen window.
- The command log record is structurally tested and explicitly flushed.

## Remaining hypotheses

1. The WebView invokes the command after the 1.5-second deadline; the current
   hard-deadline probe intentionally kills the process before a late signal can
   be observed.
2. The WebView reports an IPC error that is rendered by React but is not
   captured by the native process logs.
3. The Intel hosted runner does not create the window within the product budget
   even if the application is otherwise healthy.
4. Hosted runner performance/session behavior may not be a valid substitute
   for the required physical target-Mac dogfood measurement.

## Decision required

The acceptance oracle was not weakened and T08 is not complete. The next
authorized step must choose one of:

- add a diagnostic-only Tauri mock IPC test and a longer observation window
  that still fails any result at or above 1.5 seconds;
- collect the required launch/timing record on a physical macOS 13+ machine;
- change the product budget or target environment through the specification
  change process.

N00 remains blocked and no downstream node is unlocked.

## Authorized diagnostic continuation

The user authorized the first option on 2026-07-30 and supplied an independent
CI analysis that identified the 1.5-second hosted-runner timeout as the likely
failure boundary. The diagnostic change deliberately separates two clocks:

- the acceptance budget remains fixed at less than 1.5 seconds;
- the probe may continue observing for 15 seconds to distinguish a late signal
  from a signal that never arrives.

The continuation also adds a Tauri mock IPC test for the frozen
`{ "request": {} }` payload, unit coverage for the timing decision, signal
timestamps, native stdout/stderr artifacts, and a best-effort macOS screenshot.
Any signal at or after 1.5 seconds still fails T08.

### Diagnostic run 12

[Run 12](https://github.com/fallrising/flowshot/actions/runs/30516605709)
proved that both signals eventually arrive and produced screenshots of the
fully rendered `Foundation ready` state:

| Job | Visible window | Command completion | Acceptance |
| --- | ---: | ---: | --- |
| macOS 15 Apple Silicon | 791 ms | 2111 ms | command late by 611 ms |
| macOS 15 Intel | 7141 ms | 10206 ms | both signals late |

Both screenshots show the release build information in the native Flowshot
window, eliminating a permanent IPC failure or rendered error state. The Apple
Silicon result identifies React/module startup before the existing effect as
an actionable critical path. The next implementation invokes build info in a
small module loaded before the React entry point, while preserving the same
typed command and UI error handling.

The new mock IPC test initially failed to compile because Tauri exposes its
test utilities behind the dependency's `test` feature. The dev dependency now
enables that feature; the contract and production Tauri feature set are
unchanged.

### Eager-entry attempt and bundle split

[Run 13](https://github.com/fallrising/flowshot/actions/runs/30523430894)
proved that the mock IPC request succeeds on Ubuntu and Apple Silicon. Strict
Clippy then rejected two generic `Default::default()` calls in the test; those
are changed to the explicit Tauri URL and header-map types.

The first eager-invocation implementation still produced one 192492-byte
JavaScript bundle. Apple Silicon consequently reported the window at 1176 ms
and command completion at 2408 ms. The source-level ordering did not shorten
the browser parse boundary.

The entry is now split at a dynamic import:

1. a 2319-byte production entry invokes `get_build_info`;
2. the 191.6-KiB React render chunk loads afterward.

`scripts/check-launch-entry.mjs` makes this production-artifact property a
repository gate by requiring the typed command name in an entry smaller than
20000 bytes.

### Split-entry attempt

[Run 14](https://github.com/fallrising/flowshot/actions/runs/30524066834)
passed every Ubuntu gate, including the Tauri mock IPC test, strict Clippy, and
the 2319-byte production-entry check. Apple Silicon still reported:

| Signal | Observed |
| --- | ---: |
| On-screen window | 1185 ms |
| Command completion | 2380 ms |

The window met the product budget while the small entry did not execute the
IPC in time. This excludes React parsing and the former monolithic bundle as
the remaining Apple Silicon boundary. The next focused attempt moves the same
frozen `{ "request": {} }` invocation to Tauri's WebView document-start
initialization script. That script runs in the WebView after Tauri installs
its invoke runtime but before HTML parsing; the typed frontend adapter consumes
the injected promise and retains its generated-wrapper fallback.

### Document-start attempt and hosted-CI decision

[Run 15](https://github.com/fallrising/flowshot/actions/runs/30534200633)
passed every Ubuntu gate and every native compile, unit-test, mock-IPC, and
strict-Clippy gate on Apple Silicon. The unchanged launch oracle reported:

| Job | Visible window | Command completion | Command duration |
| --- | ---: | ---: | ---: |
| macOS 15 Apple M1 (Virtual) | 933 ms | 2318 ms | 0 ms |
| macOS 15 Intel i7-8700B | 4583 ms | 6256 ms | 0 ms |

The document-start invocation is valid and the native command itself completes
within the measurement resolution. Apple Silicon improved by only 62 ms from
the split-entry attempt, proving that the remaining delay precedes command
execution inside the hosted WebView. Intel remains outside the budget for both
window and command signals.

The three focused startup attempts—eager source order, a real bundle split, and
Tauri document-start invocation—have now reached the repository failure-loop
limit. Further frontend ordering changes would be speculative.

GitHub-hosted virtual-Mac timing is therefore classified as diagnostic, not as
the final product acceptance environment:

- the smoke test still runs with the exact `< 1.5 s` oracle and uploads its
  structured result and screenshot;
- native tests, strict Clippy, debug builds, and optimized release builds remain
  required on both hosted Mac architectures;
- a hosted timing miss does not hide otherwise valid PR build/test results;
- T08 and N00 remain blocked and cannot use a non-blocking hosted result as
  acceptance evidence;
- closure requires a passing controlled target-Mac run or a formal
  specification/test-environment change.
