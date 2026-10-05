# Explicit GitHub result export (M4 slice)

Status: implemented and locally verified; the contract was recorded before implementation. Synthetic GitHub acceptance covers this slice; live activation remains separate. This slice depends on immutable result archives. It does not merge or deploy changes and uses fake GitHub for acceptance; no live credential is needed during development.

## User flow and authority

The selected historical run offers a preview for one administrator-allowlisted repository/base branch. Preview reads the immutable archive and validates its SHA, identity, nonempty bounded text patch and file paths. It shows the fixed base commit, artifact digest, generated destination branch, verification status, files and exact archived diff. It has no remote write. A second explicit operator action authorizes that exact preview. Authenticated session, existing Origin/CSRF checks and Idempotency-Key apply. No run completion, retry, UI load or SSE replay can enqueue an export.

The approval binds run, archive UUID/hash, target repository/base branch, original base SHA and generated branch through a canonical digest. The branch is deterministic for the approved tuple, under agent-platform/export-; it never replaces an existing arbitrary branch. Duplicate requests, even under different command keys, refer to one durable operation. The original run/archive is never rewritten. Unknown/failed verification remains visible and never becomes a tests-passed claim.

## API contract

- GET /api/v1/export-targets returns {items:[{repo,base_branch}]}; empty means disabled. Public configuration contains no credentials.
- POST /api/v1/runs/{run_id}/exports/preview accepts {artifact_id,artifact_sha256,target_repo,base_branch}; returns those fields plus run_id,base_sha,branch,approval_digest,verification_status,files (path strings),diff (exact archived patch text). Preview is authenticated and CSRF protected, but creates no operation and needs no command key.
- POST /api/v1/runs/{run_id}/exports accepts {artifact_id,artifact_sha256,target_repo,base_branch,base_sha,branch,approval_digest,approved:true}. Returns the durable operation (202); missing/changed approval is rejected before any job/write.
- GET /api/v1/runs/{run_id}/exports returns {items:[operation]}. Operation fields: id,run_id,artifact_id,artifact_sha256,target_repo,base_branch,base_sha,branch,state,reason,pr_url,created_at. States queued/exporting/succeeded/failed/uncertain. Internal stage/identifiers need not be exposed.
- POST /api/v1/runs/{run_id}/exports/{operation_id}/reconcile with {} and a command key requests bounded read-only reconciliation. It cannot authorize a replacement mutation. Cross-run IDs fail.

## Worker and remote contract

An independent export-worker CLI owns the GitHub credential, read from an explicit private file using the existing bounded private reader. API, normal run Worker, guest and browser receive none. Public target allowlist is explicit in API settings and independently rechecked against the worker private config; no ambient gh/git credential or proxy is used. Production HTTP is fixed to https://api.github.com, normal TLS, no redirects, 15-second socket timeout and response-loop deadline (a blocked read may consume one additional socket timeout; DNS uses system resolver behavior), bounded bodies, sanitized errors. Tests inject a local HTTP transport with synthetic tokens only.

The worker reads Git objects through the REST API and prepares a bounded patch as data. It runs no repository code, git hooks, filters, tests or shell. Support regular UTF-8 text file additions/modifications/deletions with exact context/hunk/count/newline validation. Reject binary/rename/copy/symlink/submodule/mode-only patches, unsafe or duplicate/overlapping paths, .git paths and workflow/config paths (.github, .gitmodules, .gitattributes). Preserve regular file modes. Limit 32 files, patch 256 KiB, individual source/output 1 MiB, combined source/output 4 MiB, recursive tree/response 8 MiB; reject truncated trees and malformed remote identity/data. Existing source blobs must match their Git SHA. Other patch formats remain downloadable but are not exportable in this slice.

Before remote writes, target base must equal the archive base exactly; conflicts/drift fail without writes. Recheck before branch/PR creation; a concurrent change can still occur after the final read because GitHub offers no transaction across refs. No automatic rebase, force update, branch deletion or merge. Create a tree from the exact base, a commit with its sole parent, a new branch, and a Draft PR with an operation/approval marker. Never update existing refs. PR identity/base/head/marker must match before success; derive the displayed github.com URL from verified repo/PR number, never trust an arbitrary returned URL.

Commit each external mutation intent before sending it. Only one worker can dispatch an operation; a restart or lost response never blindly repeats a mutation. Confirmed intermediate results are durable. Unknown tree/commit creation can leave unreachable Git objects and an uncertain operation; there is no automatic cleanup. If branch/PR creation succeeded before disconnect, bounded read-only reconciliation verifies the saved expected commit, parent/tree and exact branch/PR marker (including closed PRs) and recognizes the original result. Missing or conflicting evidence remains uncertain/failed and never creates another branch/PR. A branch-only result may remain uncertain rather than creating a PR after an ambiguous dispatch. Record an audit entry for approval/reconcile; expose bounded reason codes, never remote response bodies or secrets.

## Validation and scope

Use Red/Green native PostgreSQL/API tests and a fake GitHub HTTP service for unauthorized/CSRF, stale approval/hash, duplicated/concurrent commands/workers, corruption, patch attacks, base drift, 429/5xx/timeout, crash/restart and remote-success disconnect. Chromium uses real API/DB and fake GitHub to approve the selected run and observe one Draft PR. Root reruns platform-check/web-check/browser-test and independent review before delivery. No live GitHub, KVM, provider or whole-M4 acceptance is claimed. Backup/restore/GC, arbitrary artifacts and deployment remain later work.

## Protocol sources

GitHub REST documentation checked 2026-10-04: [trees](https://docs.github.com/en/rest/git/trees), [commits](https://docs.github.com/en/rest/git/commits), [refs](https://docs.github.com/en/rest/git/refs), [pull requests](https://docs.github.com/en/rest/pulls/pulls). Use an explicitly pinned supported API version. New tree entries use base_tree and content or deletion SHA; new refs are create-only; PR creation sets draft=true.

## Operator configuration (development delivery, not activated)

Export is disabled until the API has an explicit public allowlist and a separate worker is started. After draining services and backing up the database, apply migration 015 with the existing migrate command. API example (no secret):

```sh
APP_EXPORT_TARGETS='[{"repo":"example/repo","base_branch":"main"}]' agent-platform api
```

Give only the independent export worker access to a private directory owned by its process user (0700), a JSON config (0600), and the token file (0600). Both files must satisfy the existing no-symlink/no-hardlink/private-parent checks. Example config contents:

```json
{"targets":[{"repo":"example/repo","base_branch":"main"}],"credential_file":"/private/export/github-token"}
```

Start `agent-platform export-worker --config /private/export/config.json`, or add `--once` for one bounded pass. The token needs repository contents and pull-request write permissions for only the allowlisted repository. Do not give it to the API or ordinary run worker; do not use ambient gh credentials. A future live smoke requires an explicitly designated test repository and its credential through this private channel. No such setup or live smoke was executed for this slice.

One approved tuple stays one operation, including failed/uncertain outcomes. The UI can ask for read-only reconciliation; it cannot reset dispatch state or authorize a replacement under a fresh command key. An unresolved partial export therefore requires operator inspection before a later separately designed recovery action. Saved artifacts remain downloadable throughout. Approving a patch is also an approval to submit those contents to the selected repository; repository-side automation remains governed by that repository.
