# Upstream

Vendored copy of the `use-modern-go` skill from
[JetBrains/go-modern-guidelines](https://github.com/JetBrains/go-modern-guidelines)
(Apache-2.0, see [`LICENSE`](LICENSE)).

| Item | Value |
| --- | --- |
| Upstream path | `plugin/skills/use-modern-go/` |
| Upstream commit | `155dc7ca10da5e1f6c841503086957b1b37f5815` (2026-09-10) |
| CLI version | `v0.1.1` (`scripts/VERSION`) |
| Local changes | none; this file and `LICENSE` were added |

## Where agents find it

`.agents/skills/` is the shared project skill directory read by Codex, Cursor, Grok Build,
Antigravity and OpenCode. Claude Code reads `.claude/skills/`, where
`.claude/skills/use-modern-go` is a symlink to this directory. Agents without skill support are
pointed here by the root `AGENTS.md`.

## Requirements

The wrapper installs the CLI with `go install` into `~/.cache/go-modern-guidelines` (or
`$XDG_CACHE_HOME`) on first use and never modifies the repository. It needs a Go toolchain on
`PATH`; the CLI requires Go 1.25+, which an older Go fetches automatically with the default
`GOTOOLCHAIN=auto`.

## Updating

Copy `plugin/skills/use-modern-go/` from a newer upstream commit over this directory, keep this
file and `LICENSE`, and update the table above.
