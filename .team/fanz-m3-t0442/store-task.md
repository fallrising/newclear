ROLE: WORKER
AGENT: native Codex bounded worker
ID: T-301
Goal: implement the separate SQLite isolated submission/projection store for CU-M3-01–04.
Why: durable admission and readback must not depend on a browser or in-memory mutex.
Inputs to read first: AGENTS.md; platform/fanzloud/AGENTS.md; parent worktree platform/fanzloud/docs/specs/SPEC-M3-durable-intents.md; existing event-store path/sqlite conventions and repository worker skill.
Scope (may touch): in <workspace>/wt/newclear/fanz-m3-store-20261101 only platform/fanzloud/crates/codebox-event-store/src/submission*.rs, src/lib.rs exports and tests/submission*.rs; report <workspace>/.local/fanz-m3-20261101/store-report.md.
Out of scope (must not touch): all other paths, existing event schema/behavior, Cargo deps/lock, gateway/Web/AP, Git commits/push, runtime/provider/VM/network, recursive delegation. No new package dependency.
Definition of done:
- [ ] New independent schema/application identity reuses private path validator, FULL synchronous SQLite transactions and bounded busy wait, fails closed on incompatible/corrupt DB.
- [ ] begin(owner,key,request Value) atomically records unknown before dispatch; Started winner only; duplicate same key returns saved existing record; changed payload Conflict; any unknown for owner blocks new keys. Persist unique run receipt and reject attempts to change bindings.
- [ ] Reopen/list/observe projections persist exact values and bounded history with monotonic cursor, identity/result immutable, stale versions ignored, equal-version cleanup/result advances allowed; errors redacted.
- [ ] Named scenario skeletons precede implementation; red and green evidence; focused tests and formatting pass; report exact API and limitations.
Verify with: timeout 1200 cargo test -p codebox-event-store --test submission_store; cargo fmt --all -- --check (avoid unrelated formatting); test path permissions, reopen, concurrent duplicate claims, payload conflict, unknown barrier, owner isolation, result immutability/stale observations, corrupt schema.
Budget: <=40 active minutes; same failure initial plus max2 evidence-based fixes; no delegation/CLI inference, no global test rerun. Report early if contract/API mismatch. Provider request/token/cost unknown, record observable calls truthfully.

Parent suggested public synchronous API, called from gateway spawn_blocking:
SubmissionStore::open(PathBuf)->Result<Self, SubmissionStoreError> (Clone safe).
begin(&self, owner:&str,key:&str,request:&serde_json::Value)->Result<BeginSubmission,..>;
BeginSubmission::{Started,Existing(serde_json::Value),BlockedUnknown}.
confirm(&self,owner,key,receipt:&Value)->Result<(),..>; receipt is AP {task:{id,project_id,title,..},run:{id,task_id,base_sha,profile_revision,goal,..}}.
reject(&self,owner,key)->Result<(),..>; existing rejected is terminal and never dispatches same key.
list(&self,owner)->Result<Value,..> = {items:[{key,state,request,receipt?}],blocked:bool}; newest first limit100, unknown check across entire history.
observe(&self,owner,run:&Value)->Result<Value,..> = {run:latestProjection,events:[{cursor,state,state_version,cleanup_state,reason?}],cursor,history_truncated:bool}; limit128. Snapshot max2MiB/request64KiB; run UUID/base/profile/task identity validation; known result immutable. Permit reading legacy AP run without creating submit intent.
Use serde_json::Value (existing dependency), no new serde crate required. Tell parent concrete API quickly; retain errors for conflict/invalid/storage separately. You may improve API within this contract, communicate changes before parent integration.
