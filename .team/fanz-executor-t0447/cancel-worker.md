ROLE: WORKER
AGENT: native Rust gateway worker
ID: T-450
Goal: Complete the single bounded cancellation gateway route required by M1 FN-06.
Why: Success path passed one real task; final acceptance found no Web cancellation route.
Inputs: ROOT integrated tree SPEC-M1-isolated-web.md final FN06 addendum; existing isolated.rs and AP api.py actions contract.
Scope (may touch): ROOT platform/fanzloud/apps/control-plane/src/isolated.rs only, plus .team/fanz-executor-t0447/cancel-report.md.
Out of scope: all otherfiles, UI/root-owned, AP, deps, providers, remote, commits, recursive delegation.
Definition of done:
- [ ] exact POST /api/v1/runs/{canonicalUUID}/actions allowlist.
- [ ] beforeforward parsebody onlyactioncancel andexpected_state_version integer1..i64max; refuseanyotherfields/actions/types; exactsame Origin/auth forwarding/unknownno-retry semantics.
- [ ] focused positive/negative/body/route tests, preserve all existing checks; no broad API action exposure.
Verify with: pinned cargo+1.97.1 scoped isolated tests, fmtcheck andclippy scopedpackage. No broad green workspace repeat.
Budget: 10minutes; reportfrozenhash, actualcommands/results; no provider/VM/newdeps/hostactions.
