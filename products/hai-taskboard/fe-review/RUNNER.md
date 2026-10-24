# ConnectedApp review runner

`capture-connected.mjs` exercises the real mounted ConnectedApp against the existing Go runtime. Run it only inside the dedicated network-none namespace prepared under DESIGN; no standalone Vite or stub backend is used.

Required existing inputs: pinned Node24.20.0/pnpm11.25.0/Playwright1.62.1 toolchain, current web dependencies, root-built backend binary `/opt/hai/taskboard`, validated prebuilt `/opt/hai/web`, and caller-owned nonsymlink0700 `/state` outside the checkout. Optional `HAI_REVIEW_BINARY`, `HAI_REVIEW_WEB_ROOT`, `HAI_REVIEW_STATE` select those nonsecret paths. Default execution creates a fresh child; explicit root-approved continuation may reuse only the same generated synthetic scenario, never existing user repositories/tokens/state.

From the component root in that isolated environment:

```sh
node --test fe-review/safety.test.mjs
node fe-review/capture-connected.mjs
```

The token is generated internally and passed to the child environment, never arguments. Do not enable shell tracing, browser traces, storageState or request-body logging. Artifact JSON and screenshot DOM pass the secret guard before persistence; password values must be empty. Synthetic Git init/commit occurs only under the private scenario directory, using no global config or network. A graceful stop/restart loads the explicit approval after real UI IDs exist. Only the runner-owned child receives SIGTERM; state stays available for root-owned retention/cleanup after all children stop.

Positive flows use real UI/backend data. Review-only faults are clearly labeled: dropped mutation response plus unavailable automatic lookup, held real snapshot after a reset event injected into the browser EventSource, offline/reconnect and removal of this browser's cookie. No fault response is counted as a real successful domain result. Fake success must remain Developing, and current product gaps remain open.

Each run emits a redacted `runs/<id>/capture.json`; screenshots are ignored. Failure manifests remain evidence. Explicit continuation controls: `HAI_REVIEW_PRIOR_CAPTURE=<run-id>` reuses the verified initial18screenshots; `HAI_REVIEW_RESUME_STATE=<run-id>` resumes the exact stopped synthetic scenario with a new memory token and verifies the original accepted command/project via real result GET. `HAI_REVIEW_REMAINING_FAULTS=1` additionally requires an actual Developing/Succeeded subject and skips completed Ready/Fake/captures. Each receipt distinguishes fresh and resumed state. These controls require a documented bounded reason; they do not relabel a failed run as success. Context/browser/runtime cleanup stages are independently attempted and errors remain explicit.
