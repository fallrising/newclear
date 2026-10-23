# Quickstart — HAI Taskboard

> Portfolio doc tier **A**. Authoritative loopback recipe:
> [local-development.md](local-development.md).
> Policy: [portfolio-doc-tiers.md](../../../docs/portfolio-doc-tiers.md).

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
curl --fail-with-body http://127.0.0.1:8080/healthz
```

Authenticated command examples (exact Origin + `__Host-hai_session` cookie) are
in [local-development.md](local-development.md). Do not enable shell tracing
when expanding the session token.

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
