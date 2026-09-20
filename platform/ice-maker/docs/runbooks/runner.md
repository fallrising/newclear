# Local runner runbook

## Bootstrap

Install Git, Python 3.11, the local `codex` CLI, and a rootless OCI runtime.
The runtime must be configured by an operator; this repository only constructs a
deny-by-default command and does not claim a real sandbox execution.
Every command construction requires and validates `runner/sandbox-policy.json`;
missing, symlinked, malformed, or weakened policy input fails closed.

Run local checks:

```sh
codex --version
PYTHONPATH=src python3 -m unittest tests.test_runner -v
```

Resolve the trusted `codex` executable during bootstrap and pass that runtime
path to the adapter without persisting it in repository configuration or logs.
The bounded doctor must report a `codex-cli` semantic version and match the
model selected for the `builder_primary` alias before invocation.

## Operational gates

Runner registration, network-egress enforcement, provider access, and scoped
credential injection are external gates. No credential, Docker socket, host-root
mount, or production readiness claim belongs in a job workspace.

## Cleanup and recovery

Each job creates a detached worktree under its caller-owned job root. Always use
the context-managed job boundary (or call `cleanup()` in a `finally` block); it
removes the directory and Git worktree registration. A failed removal leaves
the job object retryable: call `cleanup()` again after correcting the local
condition. Do not run repository-wide `git worktree prune`; inspect
`git worktree list --porcelain` for the specific job registration. If retry
still fails, stop publishing and have an operator recover that one job before
starting another.
