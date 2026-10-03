# Agent-facing capability files (`llms.txt`)

## Context

This monorepo holds 23 in-scope projects (excluding `refs/` and retired code). Their external interfaces are HTTP APIs, CLIs, wire protocols, MCP servers, desktop apps and specification packs. Machine-readable contracts already exist for some of them, but under five unrelated paths: `platform/dim-gate/docs/openapi.json`, `products/kith/contracts/*.json`, `systems/ojbquay/proto/`, `systems/mkfk/api/schemas/`, `specs/fleet/schemas/`. An agent that wants to know what a project can do before using it has no single entry point, and the root `README.md` catalog names technologies rather than interfaces.

OpenAPI cannot serve as that entry point: roughly a third of the projects expose no HTTP surface at all. `AGENTS.md` cannot either — by its own specification it carries instructions for agents *working on* a project, not a description of the interface its consumers call.

## Goal

Give every project one file, at a predictable path, that an agent can fetch on its own to decide whether and how to use that project, and a root file that indexes all of them in a single fetch.

The format is [`llms.txt`](https://llmstxt.org/). Its path rule is the reason it fits a monorepo: a file may sit at the root or at any subpath, it covers the paths under it, and where more than one applies an agent uses the most specific. Its `## Optional` convention marks links an agent may skip when context is short, which is the property this repository actually needs as it grows.

## Non-goals

Replacing `README.md`, `AGENTS.md`, SDD documents or existing contracts; generating OpenAPI; documenting internal module structure; teaching complete usage. An `llms.txt` answers *should I use this, and where do I go next* — not *how do I use every feature*.

## File shape

Required by the upstream specification: an H1 project name, then an optional blockquote summary, then optional prose without headings, then zero or more H2 sections whose list items each begin with a markdown hyperlink.

There are two kinds of file. A **project capability file** sits in a project directory and describes that project. The **root index** at `llms.txt` describes no single project; it names every project and links each one's capability file where it exists. The keys below are required of a project capability file and forbidden in the root index, whose own obligation is to link every project file that exists.

A project capability file additionally requires, in the prose block between the blockquote and the first H2, these lines in this order, one per line, each `Key: value`:

| Key | Value |
| --- | --- |
| `Status` | `production`, `partial`, `spec-only` or `retired`. `spec-only` means the specification is written and the code is not usable yet. |
| `Interfaces` | comma-separated from `http`, `cli`, `mcp`, `grpc`, `wire`, `library`, `desktop`, `spec` |
| `Entrypoint` | how a caller reaches it: listen address and base path, binary name, or transport |
| `Auth` | what a caller must present, or `none` |
| `Spec` | repository path of the machine-readable contract, or `none` with the reason |

`Status` is not optional. Several projects here are approved specifications with no runnable code, and an agent that cannot tell those apart from shipped services will call something that does not exist.

Prose after those lines should state what the project is for and what it is not for. Absolute `https://github.com/fallrising/newclear/blob/main/...` URLs are used in links so that a file stays resolvable when an agent fetches it on its own.

Section names: use `## Interface reference` for what a caller needs, and `## Optional` for design documents, roadmaps and history. Anything an agent can skip belongs under `## Optional`.

## Acceptance Criteria

Scenario: A project declares its capabilities
  Given a project directory with an `llms.txt`
  When the validator runs
  Then the file has exactly one H1 on its first line
  And the five required keys are present, in order, with accepted values
  And every H2 list item starts with a markdown hyperlink
  And every link that points inside this repository resolves to a tracked file

Scenario: The root index stays truthful
  Given the root `llms.txt`
  When the validator runs
  Then it declares none of the five project keys
  And every in-repo link resolves to a tracked file
  And every project that has its own `llms.txt` is linked from the root index

Scenario: A project has no capability file yet
  Given a project directory without an `llms.txt`
  When the validator runs
  Then the validator reports no error for that project
  And CI does not fail

Scenario: A declared contract path is wrong
  Given an `llms.txt` whose `Spec` names a path
  When that path is not a tracked file
  Then the validator fails and names the file and the path

## Rollout

Adoption is per project and deliberately incomplete. The validator checks the files that exist rather than demanding coverage, so a project gains a capability file when someone has reason to write one. Requiring `llms.txt` in every project directory is a separate decision, to be taken only after the format has survived contact with several project types.

The pilot set is `systems/clarkq` (HTTP plus three SDKs), `products/kith` (MCP, HTTP and WebSocket, specification-only), `systems/snail` (wire protocol, nothing HTTP to describe) and `products/goku` (four interfaces, no project README). They were chosen because they fail differently; a format that holds for all four is likely to hold for the rest.

## Non-normative notes

`llms.txt` was proposed for websites. Nothing in the specification is website-specific except the examples, and the subpath rule maps onto a monorepo without modification. If this repository is ever published as a documentation site, the same files serve both readers.
