# spring-pool

> **Documentation tier A · Active MVP development.** See the [portfolio documentation policy](../../docs/portfolio-doc-tiers.md). Runtime and staging verification are pending; this is not a deployment or acceptance claim.

A single-owner operations script library. Keep Bash, Python and PowerShell text in immutable revisions, assemble ordered runbooks that pin exact revisions, and export them as Markdown. Script storage and runbook editing do not execute commands.

The web surface is a Hono SSR Worker. A private Rust/Wasm Worker owns the D1 database; the two communicate through a service binding. Staging requires Cloudflare Access and one allowed owner identity.

- [Design and behavior contract](docs/SDD.md)
- [API schemas](contracts/openapi.json)
- [Local quickstart and verification status](docs/quickstart.md)

MVP limits: 64 KiB UTF-8 per script, 30 steps per runbook, one workspace. Archive preserves history and pinned references. Audit records actor/time/action/entity/revision without script content. There is no runner, SSH, scheduling, secret vault, team role management, hard delete or history cleanup endpoint.
