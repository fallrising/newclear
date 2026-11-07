# Quickstart — HAI Taskboard

> Portfolio doc tier **A**. Authoritative loopback recipe:
> [local-development.md](local-development.md).
> Policy: [portfolio-doc-tiers.md](../../../docs/portfolio-doc-tiers.md).

## What you can try now

This starts the local **Fake/SQLite development runtime**, not a real coding-agent workspace.
The minimal commands below start the API/health surface. To open the connected React board, also
build and serve the frontend through the same runtime using the
[connected-browser recipe](local-development.md#connected-browser-foundation), including its pinned
frontend prerequisites. A successful health response alone does not demonstrate a usable board.

The bounded browser path covers login, project/Draft, explicit specification/AC acceptance,
Ready and Fake dispatch, original-result recovery and reconnect. Fake success remains Developing;
full Candidate/Review/Evidence/QA/Done operation and restore are unfinished. See
[current usability](../README.md#current-usability) and [SUCCESS](../SUCCESS.md).
Do not expect Codex/Claude execution or an MCP endpoint from this quickstart.

## Prerequisites

- Go toolchain matching `products/hai-taskboard/backend/go.mod`
- Private absolute data root (mode `0700`), not under the git tree
- Run builds from `products/hai-taskboard/backend`

## Minimal path (Fake/SQLite runtime)

```sh
cd products/hai-taskboard/backend
go build -o /tmp/hai-taskboard-local ./cmd/taskboard

umask 077
taskboard_private_parent="$(mktemp -d /tmp/hai-taskboard.XXXXXX)"
export HAI_TASKBOARD_DATA_ROOT="${taskboard_private_parent}/runtime"
export HAI_TASKBOARD_LISTEN_ADDR=127.0.0.1:8080
export HAI_TASKBOARD_ORIGIN=http://127.0.0.1:8080
export HAI_TASKBOARD_SESSION_ACTOR=local-operator
export HAI_TASKBOARD_SESSION_TOKEN="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
/tmp/hai-taskboard-local &
taskboard_pid=$!
curl --fail-with-body http://127.0.0.1:8080/healthz
```

Authenticated command examples (exact Origin + `__Host-hai_session` cookie) are
in [local-development.md](local-development.md). Do not enable shell tracing
when expanding the session token.

Stop in the same shell with `kill -TERM "$taskboard_pid"` followed by `wait "$taskboard_pid"`.
Keep the private data parent to resume, and reuse the same data-root configuration instead of
running `mktemp` again. Follow the authoritative recipe for session setup; unset the session token
when finished. These are operation instructions, not a new execution record for this document.

## Verify

```sh
cd products/hai-taskboard/backend
go test ./...
```

Frontend checks (when working the UI tree) follow the component’s package
scripts; see README / docs handoff.

## Status note

Automatic Pending Fake execution and persisted board/SSE reads are implemented.
The authenticated API now supports explicit initial acceptance followed by current-head
Ready/dispatch. The connected browser supports login, project/draft creation, explicit specification
acceptance, Fake dispatch, original-result recovery and reconnection. Serve the built frontend
through the same runtime using the [browser setup](local-development.md#connected-browser-foundation).
Full detail/attention/impact, evidence-to-Done operation and backup/restore remain unfinished.
See [current work](tasks/BOARD.md) and [SUCCESS](../SUCCESS.md).

## Authoritative longer docs

- [README](../README.md)
- [local-development.md](local-development.md)
- [SDD.md](SDD.md)
- [HANDOFF.md](HANDOFF.md)
- [Kanzo-inspired follow-up design](sdd/kanzo-inspired-usability.md) — planned features and oracles;
  no new executable commands or real-agent capability are supplied by that document.
