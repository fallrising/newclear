# Local development

The current executable is a loopback-only Fake/SQLite integration runtime. It accepts and persists
commands, executes durable Pending Runs through the deterministic `local-success` Fake scenario,
and serves persisted board/SSE projections. Explicitly configured local repositories can now
produce durable proposals through HTTP. A proposal is not accepted specification authority;
`MarkReady` still fails closed without an admitted specification. First acceptance and its
current-head consumers are tracked on the [development board](tasks/BOARD.md).

From `products/hai-taskboard/backend`, build the binary:

```sh
go build -o /tmp/hai-taskboard-local ./cmd/taskboard
```

Prepare an absolute private parent, a not-yet-created runtime child, and a canonical 32-byte random
base64url token. The command substitution does not print the token; keep shell tracing disabled:

```sh
umask 077
taskboard_private_parent="$(mktemp -d /tmp/hai-taskboard.XXXXXX)"
export HAI_TASKBOARD_DATA_ROOT="${taskboard_private_parent}/runtime"
export HAI_TASKBOARD_LISTEN_ADDR=127.0.0.1:8080
export HAI_TASKBOARD_ORIGIN=http://127.0.0.1:8080
export HAI_TASKBOARD_SESSION_ACTOR=local-operator
export HAI_TASKBOARD_SESSION_TOKEN="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
test "${#HAI_TASKBOARD_SESSION_TOKEN}" -eq 43
/tmp/hai-taskboard-local &
taskboard_pid=$!
```

The listen address and Origin must use exactly the same canonical spelling. Leading-zero ports,
IPv4-mapped aliases, expanded IPv6 aliases, broad/public roots, roots not owned by the process
effective UID, and roots whose mode is not already `0700` are rejected without chmod before storage
or a listener is opened.

Readiness is public and reports command, persistence, automatic execution and projection availability:

```sh
curl --fail-with-body http://127.0.0.1:8080/healthz
```

Create a project through the authenticated exact-Origin boundary. Keep the token expansion inside
the cookie argument; do not use shell tracing or copy the expanded command into logs:

```sh
curl --fail-with-body \
  --request POST \
  --header 'Content-Type: application/json' \
  --header 'Origin: http://127.0.0.1:8080' \
  --cookie "__Host-hai_session=${HAI_TASKBOARD_SESSION_TOKEN}" \
  --data '{"command_id":"cmd_0123456789ABCDEFGHJKMNPQ","idempotency_key":"123e4567-e89b-42d3-a456-426614174000","project_id":"prj_0123456789ABCDEFGHJKMNPR","expected_version":0,"issued_at":"2026-01-01T00:00:00Z","name":"Local project","repository":{"root_hint":"/workspace/local","approved_ref":"refs/heads/main"}}' \
  http://127.0.0.1:8080/api/v1/projects
```

Use the returned command ID to retrieve the exact stored canonical result:

```sh
curl --fail-with-body \
  --cookie "__Host-hai_session=${HAI_TASKBOARD_SESSION_TOKEN}" \
  http://127.0.0.1:8080/api/v1/projects/prj_0123456789ABCDEFGHJKMNPR/commands/cmd_0123456789ABCDEFGHJKMNPQ
```

Stop cleanly and wait for the process to stop HTTP and join the persistent worker before closing SQLite:

```sh
kill -TERM "$taskboard_pid"
wait "$taskboard_pid"
```

Starting the same binary again with the same exported data root reopens the persisted command
result. Remove the task-owned private parent only after all runtime processes using it have stopped.
Unset the token when finished:

```sh
unset HAI_TASKBOARD_SESSION_TOKEN
```

Keep the private parent when you need to resume: it contains the durable database and artifacts.
For agent build/test jobs, follow the common workspace launcher instructions in the root AGENTS;
put retained state and evidence in its preserve directories rather than disposable build output.

The poller scans at startup and every 250 ms, in bounded batches. Claimed work is never
redispatched after restart. Expired nonterminal claims become `NeedsReconcile` / `OutcomeUnknown`;
no automatic retry or Done transition follows. A worker/storage failure terminates the process.

Authenticated board reads use `/api/v1/projects/{project_id}/board`; durable event replay uses
`/api/v1/projects/{project_id}/events`. The current global event allocator can produce a gap between
project events: replay explicitly requests a fresh snapshot instead of leaking other projects.
Snapshot evidence coverage is conservative (`effective_satisfied=false`, `covered_ac_count=0`):
current-policy evidence evaluation is unavailable here, not proof that no evidence exists.

## Approved local proposal import

Before starting the runtime, set `HAI_TASKBOARD_APPROVED_REPOSITORIES_FILE` to an absolute
operator-owned, nonsymlink regular JSON file with mode `0600`. Its parent path components
must also be nonsymlinks. Maximum size is 64 KiB and maximum repository count is 32.
Unset configuration leaves proposal import unavailable. An empty `repositories` array revokes
all current bindings on the next graceful restart; already committed command replay remains
available. Configuration is immutable within a running process.

The following shape is illustrative; replace private paths with local approved paths and keep
the file outside the repository. `git_executable` is an absolute canonical executable path,
and `git_dir` is the existing `.git` directory or supported bare repository. The existing Git
reader requires compatible filesystem placement for source and runtime scratch. Linked worktree,
symlink, alternate-object and other unsupported configurations are rejected by that reader.
`configuration_id` is an opaque public ID, not a path. The approver must exactly match
`HAI_TASKBOARD_SESSION_ACTOR`. The legacy project's repository hint grants no approval.

```json
{
  "schema_version": 1,
  "repositories": [{
    "project_id": "prj_0123456789ABCDEFGHJKMNPR",
    "id": "local-spec",
    "version": 1,
    "object_format": "sha1",
    "configuration_id": "local-spec-v1",
    "approved_by_actor": "local-operator",
    "refs": ["refs/heads/main"],
    "manifest_paths": ["specification.json"],
    "git_executable": "/absolute/path/to/git",
    "git_dir": "/absolute/path/to/repository/.git"
  }]
}
```

Create the project using the command above, then read
`GET /api/v1/projects/prj_0123456789ABCDEFGHJKMNPR/repository-bindings/local-spec`
with the session cookie. It returns the approved public binding and `binding_digest`; private
paths and executable configuration are excluded. Use that exact digest in a project command:

```json
{
  "command_id": "cmd_0123456789ABCDEFGHJKMNPS",
  "idempotency_key": "123e4567-e89b-42d3-a456-426614174001",
  "operation": "ProposeSpecification",
  "expected_version": 1,
  "issued_at": "2026-10-23T00:00:00Z",
  "payload": {
    "repository_binding_id": "local-spec",
    "binding_version": 1,
    "binding_digest": "sha256:<exact digest returned by the query>",
    "ref": "refs/heads/main",
    "manifest_path": "specification.json"
  }
}
```

POST to `/api/v1/projects/{project_id}/commands` with JSON content type, session cookie and exact
Origin. Use the current project version and fresh command/idempotency identities for a new intent.
The committed manifest must follow [the import contract](sdd/proposal-import-core.md); only
immutable Git objects are read, with no fetch, repository instruction execution or working-tree
input. The result records proposal/graph SHA-256 identities and the format-tagged Git commit OID.
It installs no accepted head, changes no WorkItem phase and starts no Run. On response loss,
query the original command ID or replay the identical request rather than generating a new intent.

## Component verification gates

From `products/hai-taskboard`, use the same entry points as root CI:

```sh
bash scripts/check-ci-pins.sh
bash scripts/check-backend.sh
bash scripts/check-web.sh
```

Use Go 1.27.1 with a working C compiler for the mandatory race suite, Node 24.20.0 and pnpm
11.25.0. The scripts reject version drift before dependency installation; the backend keeps
`GOTOOLCHAIN=local` and enables CGO. The web gate uses the existing lockfile and disables install
lifecycle scripts. Dependency downloads require network access unless the caches are populated.
The gates cover the current backend and web tests/build. Actual browser workflows, backup/restore
and full product acceptance require separate checks.

## Browser session and static hosting

The local runtime now exposes POST/GET/DELETE `/api/v1/session`. POST accepts only a JSON
`token` field under the configured exact Host and Origin, and establishes the existing
`__Host-hai_session` Secure/HttpOnly/SameSite=Strict cookie. GET returns authenticated actor
status; DELETE with exact Origin clears this browser cookie. This remains the single configured
local operator token, not production account authentication. Do not put it in URLs, storage,
logs or built assets. Current Chromium loopback login/send/logout has been verified; other
browsers have not been accepted.

Optional `HAI_TASKBOARD_WEB_ROOT` selects an absolute clean prebuilt web directory owned by
the runtime UID, without symlinks or group/world write permissions. Keep it separate from the
private data root, including ancestor/descendant paths. Startup verifies and loads `/index.html`
and its directly referenced finite `/assets/` files into memory. Files must be regular, owned,
single-link and bounded (index256KiB, each asset4MiB, total16MiB, at most64 references).
Only explicit loaded routes are served; unknown API/assets never fall back to HTML. The current
single Vite bundle fits this contract; nested dynamic imports/CSS resource discovery is not
implemented. With no web root the API remains available and health reports UI unavailable.

The initial hosting/session evidence used a public test shell. The later connected browser flow
below exercises actual project/admission/dispatch operations; detail/attention and Done workflows
remain tracked separately in [BOARD](tasks/BOARD.md).

## Connected browser foundation

Build the frontend with the pinned toolchain and component commands documented above, then set
`HAI_TASKBOARD_WEB_ROOT` before starting the Go runtime to the absolute built `web/dist` directory
(or the common workspace's retained equivalent). Open the exact configured loopback Origin.
The runtime validates the finite asset list and serves it from that same origin. If the variable
is absent, the API still runs and the UI is unavailable. This is a local single-operator runtime.

Sign in with the configured session token using the password form. The connected entry reads
actual projects, creates an empty Draft and shows the durable board. Use the explicitly configured
repository binding to propose specifications, review the prepared acceptance and supply exact AC
bytes before accepting. The repository's manifest must name the created project and WorkItem IDs;
project repository hints alone do not authorize import. Accepted Drafts can become Ready and be
dispatched through the deterministic `local-success` Fake scenario. A successful Run remains
Developing until the separate completion gates succeed.

The UI retains an uncertain command's identity and offers original-result lookup after response
loss. It displays connection state and revalidates board authority on reconnect/reset; it never
reposts uncertain work automatically. Token values are cleared after sign-in and are not stored
in URL/localStorage/sessionStorage. Logout clears the browser cookie.

The currently connected surface ends before candidate selection and human review/evidence/QA/Done.
Detail, attention and impact workflows and backup/restore are still tracked as incomplete. The
runtime now uses the explicit `local-policy-v2` human-independent verification profile; old accepted
bindings under the previous policy cannot authorize new work, while committed result replay remains
available. See [the policy contract](sdd/connected-local-runtime.md#usable-local-verification-policy-accepted-locally).
Actual Chromium evidence is described in [traceability](traceability.md); it is not full UI or Done
acceptance. Synthetic human fixture tests do not certify real-world task completion.
