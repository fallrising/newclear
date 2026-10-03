# Local development

The current executable is a loopback-only Fake/SQLite integration runtime. It accepts and persists
commands; automatic Run execution and board/SSE projections are intentionally unavailable.

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

Readiness is public but reports the unavailable runtime surfaces explicitly:

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

Stop cleanly and wait for the process to close HTTP before SQLite:

```sh
kill -TERM "$taskboard_pid"
wait "$taskboard_pid"
```

Starting the same binary again with the same exported data root reopens the persisted command
result. Remove the task-owned private parent only after all runtime processes using it have stopped.
Unset the token when finished:

```sh
unset HAI_TASKBOARD_SESSION_TOKEN
rm -rf -- "$taskboard_private_parent"
```
