# Workflow lint verification — issue #525

Candidate base: `11931293eb7318f1380d4f62df8e805da2b9441e`.
Worker implementation is uncommitted; the parent owns independent review, commit,
PR, hosted final-head CI and merge. This document does not claim those occurred.

## Results

- Regression suite was written before the checker: seven failures because the
  entrypoint did not yet exist. After implementation, all seven tests pass.
- Real negative fixture: exit1 at
  `invalid-runner-job-env.yml:7:22`, with
  `context "runner" is not allowed here`.
- Legal step env, GITHUB_ENV and matrix/hosted-Intel-Mac fixtures pass.
- Default root scope covers both YAML extensions and excludes dormant nested
  component workflows. An empty root fails, rather than reporting success.
- Altered release archive fails its SHA256 check before extraction/execution.
- Every current enabled root workflow passes:37 files including the new gate.
- Fresh-cache shared entry downloaded the official1.7.12 archive, verified it
  and passed all37 files; it follows the same download/check path as hosted CI.
- Existing project-success checker passes42 contracts/navigation/index.
- Whitespace check passes. Existing workflow files and product source are
  unchanged; only a new path-scoped validation workflow is added.

The official checksum list and independently computed Linux amd64 archive digest
agree: `8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8`.
Other supported platform hashes come from the same official list; their native
binaries were not executed in this Linux verification.

## Commands

All test/download commands were launched through the required shared workspace
launcher, with separate task IDs and output saved in protected evidence. The
commands inside those launcher runs were:

```sh
ACTIONLINT_ARCHIVE=<verified-archive> python3 -m unittest discover -s .github/scripts/tests -v
python3 .github/scripts/check_workflows.py --archive <verified-archive>
python3 .github/scripts/check_workflows.py
python3 .github/scripts/check_workflows.py --archive <verified-archive> .github/scripts/tests/fixtures/invalid-runner-job-env.yml
python3 scripts/check_project_success.py
git diff --check
```

The deliberately invalid fixture returns1; its harness asserts that exit and
diagnostic as the expected passing regression. The failed1.7.7 compatibility
attempt is preserved: it rejected a currently valid `macos-15-intel` label.
The final1.7.12 pin accepts the label with no ignores or custom-runner exceptions.
This is static Actions validation, not execution of product jobs or proof of
runtime matrix values. ShellCheck/Pyflakes are optional separate integrations
and are explicitly disabled.
