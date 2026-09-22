# Local Fake Runtime

Status: bounded P0-A runtime design for T-091.

## Purpose and boundary

This runtime turns the accepted command, SQLite, deterministic Fake, and HTTP adapters into a
developer-startable process. It is a local integration checkpoint, not a production deployment.
The runtime may accept HTTP commands and durably replay their canonical command results. It does
not run the outbox, execute Fake scenarios automatically, or materialize board/SSE projections.

## Inputs

The process reads configuration before opening SQLite or a listener. Unsupported command-line
arguments are rejected; configuration is supplied by these environment variables:

| Variable | Required | Contract |
| --- | --- | --- |
| `HAI_TASKBOARD_DATA_ROOT` | yes | Absolute, clean, private task directory owned by the process effective UID with mode exactly `0700`. `/`, the platform temporary directory, directories with any other mode/owner, symlinks, and other broad/uncontrolled roots are rejected without mutation. A missing child may be created only below an effective-UID-owned `0700` nonsymlink parent. Runtime-created components use mode `0700`; an existing accepted root keeps that mode unchanged. |
| `HAI_TASKBOARD_LISTEN_ADDR` | no | Defaults to `127.0.0.1:8080`. It must be byte-for-byte `net.JoinHostPort(parsedIP.String(), decimalPort)`, with an explicit loopback IP and non-zero port. Empty hosts, hostnames, wildcards, leading-zero ports, IPv4-mapped aliases, expanded/noncanonical IPv6, and non-loopback IPs are rejected. |
| `HAI_TASKBOARD_ORIGIN` | yes | Byte-exact `http://` plus the canonical listen address, with no aliases or additional URL fields. TLS termination is not part of this local runtime. |
| `HAI_TASKBOARD_SESSION_TOKEN` | yes | Canonical unpadded base64url encoding of exactly 32 decoded bytes (43 characters). Obvious low-entropy or repeated/periodic material is rejected. It is accepted only through the `__Host-hai_session` cookie and is never logged or returned. |
| `HAI_TASKBOARD_SESSION_ACTOR` | no | Defaults to `local-operator`; must be a bounded printable token. It is the sole local command principal. |

No flag accepts a session token because process arguments are commonly observable. Environment
variable names may appear in diagnostics, but values and request cookies must not.

## Exposure and session security

Configuration validation is fail-closed and completes before storage creation or `net.Listen`.
Binding is restricted to canonical explicit loopback IPs such as `127.0.0.1` and `::1` with a
canonical decimal port; `0.0.0.0`, `[::]`, empty-host shorthand, hostnames, textual IP/port aliases,
and non-loopback addresses are invalid. Origin is exactly `http://` followed by that same canonical
listener spelling. Command requests require exactly one
`__Host-hai_session` cookie whose value is compared to the configured token in constant time.
The resulting session has the configured actor and access only through that authority. Mutating
requests additionally require exactly one `Origin` header byte-equal to `HAI_TASKBOARD_ORIGIN`, as
enforced by the accepted HTTP adapter.

The token decoder accepts one representation only: unpadded base64url that round-trips canonically
to 32 bytes. Repeated-character, repeated-byte, short-period and similarly obvious predictable
values are invalid. After authority construction the runtime retains only the fixed-size SHA-256
digest used for constant-time comparison; it does not retain or log the configured raw token.

## Storage layout and confinement

After validating the root and its existing ancestors, the runtime creates private directories:

```text
<data-root>/
  state/taskboard.sqlite
  artifacts/sha256/<lowercase-sha256>
```

SQLite is opened through `OpenAtRootWithClock` with the controlled root. On the pinned Linux target,
validation binds an existing directory's owner to the process effective UID and requires mode
exactly `0700`. It never chmods or otherwise repairs a caller-supplied path. Missing task-owned
children are created at mode `0700` below an effective-UID-owned `0700` parent.

Artifact identities are lowercase SHA-256 digests only. Absolute names, separators, dot segments,
alternate encodings, and symlinked roots or objects are rejected. At construction the artifact
store opens and retains an `os.Root` descriptor and binds it to the configured path identity. Every
operation rechecks that the configured path is still the same nonsymlink directory, then performs
temporary creation, hard-link publication, object open, directory sync and cleanup relative to the
retained descriptor. A root rename or symlink replacement before an operation fails; a replacement
racing after the identity check cannot redirect descriptor-relative I/O. Writes hash the bytes
written to the opened staging descriptor, sync and close it, then publish without overwriting an
existing digest. Existing objects and reads are hashed and validated through the exact opened file
descriptor returned to the consumer, so a pathname swap cannot substitute unvalidated content.
Successful publication is directory-synced. The runtime does not accept caller-selected artifact
paths.

## Composition

The runtime supplies the accepted composition root with:

- the controlled SQLite store;
- a UTC system clock and cryptographically random application IDs;
- the accepted `fake/v1` adapter with a deterministic built-in scenario declaration;
- the confined immutable artifact store;
- the single-token local session authority;
- a specification policy that fails closed because accepted repository bindings are not available;
- a projection source that always fails closed as unavailable.

The Fake adapter is declared and accepted by commands, but no persistent worker claims or executes
outbox work in this runtime.

## HTTP and readiness

`GET /healthz` is the only unauthenticated runtime-owned route. Once configuration, directories,
SQLite migration, dependency composition, and the listener are ready it returns HTTP 200 with the
stable bounded body:

```json
{"status":"ready","commands":"ready","persistence":"ready","automatic_execution":"unavailable","projections":"unavailable"}
```

Other methods on `/healthz` are rejected. Every other path is delegated unchanged to the accepted
HTTP API. Board and SSE reads therefore return the accepted stable unavailable/not-found response
from the fail-closed projection boundary; health never describes them as ready. Draft-to-Ready
transitions also remain unavailable because this local checkpoint cannot validate accepted
repository specification bindings.

## Lifecycle and restart durability

Startup order is: validate all configuration and paths, create confined directories, open/migrate
SQLite, construct local dependencies, compose handlers, then bind the loopback listener. Failure
closes any acquired resources, returns non-zero from the process, and does not expose the token.

SIGINT, SIGTERM, or parent-context cancellation stops accepting HTTP, performs bounded graceful
HTTP shutdown, waits for handlers, closes SQLite, and closes the retained artifact-root descriptor.
Startup failures close every artifact/SQLite/listener resource already acquired. A forced HTTP close
is used only if the grace period expires. A clean signal-driven shutdown exits zero. Restarting with
the same data root opens the same database; canonical command-result bytes and idempotency records
remain authoritative, so replay cannot create a duplicate mutation.

## Explicitly unsupported

This checkpoint does not supply an automatic or persistent outbox worker, Fake dispatch polling,
persisted board/SSE projections, backup/restore, browser or live UI, root CI acceptance, real
providers, credentials, agents, shell execution, ambient network execution, deployment, or release.
Those surfaces remain unavailable until separately designed, implemented, and accepted.
