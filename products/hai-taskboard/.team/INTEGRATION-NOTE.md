# Monorepo integration: 2026-09-22

The HAI task ledger from `agent/hai-taskboard-p0a@0f79b146a0d2c287a91b2c9db27cf18b4fc499f0`
was moved byte-for-byte from repository-root `.team/` to `products/hai-taskboard/.team/`.
The root ledger belongs to dim-gate and remains unchanged.

Within these historical HAI plans, tasks and reports, `.team/` means this HAI-local directory.
Other repository-relative paths such as `products/hai-taskboard/backend/` retain their original meaning.
Report bytes and recorded hashes were preserved. This relocation does not accept new milestones,
change Fake-only runtime scope or imply previously NotRun checks have passed.

Current entry: `products/hai-taskboard/AGENTS.md` and `products/hai-taskboard/docs/HANDOFF.md`.
