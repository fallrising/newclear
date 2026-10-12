# Quickstart

## Requirements

- Python 3.11+
- POSIX host
- official `codex` CLI already installed
- CLI already authenticated to the intended ChatGPT account/workspace

The collector does not install Codex or perform login.

## Offline verification

From the repository root, run the same native checks named in the
[component CI workflow](../../../.github/workflows/codex-usage-ci.yml):

```sh
cd tools/codex-usage
python3 -m unittest discover -s tests -v
python3 -m py_compile codex_usage.py
```

These checks use synthetic inputs and a missing-CLI failure case; they do not collect a live account snapshot
or require an installed/authenticated Codex CLI. Retain command output and exit codes through the configured
shared workspace launcher, outside the source tree. A local pass does not establish a hosted CI pass.

## Delivery report example

Use the [report template](../../../docs/work-tracking/report-template.md) beside the issue's task file.
Replace every placeholder with an observed result and a public-safe evidence reference; preserve failed or
skipped required checks with their reasons. Do not publish account data, private configuration contents,
private paths, or raw snapshots. Restricted logs stay outside the public tree and use abstract references.

```markdown
STATUS: PARTIAL

Issue: <full public issue URL>
Component: tools/codex-usage
Task: [task.md](task.md)
Delivery PR: <public PR URL; description uses Refs #N>

## Summary

<Actual change and remaining delivery checks. Runtime remains offline-tested / live-unverified.>

## Verification

- Component: `python3 -m unittest discover -s tests -v`; <observed count, exit code, sanitized evidence reference> — <actual result>
- Component: `python3 -m py_compile codex_usage.py`; <exit code, sanitized evidence reference> — <actual result>
- Hosted component CI: <actual run link/result, or reason it has not run> — <actual result>
- Independent review: <public review evidence, or reason it is pending> — <actual result>

## Documentation

<Changed documents and public information review.>

## Risks and Follow-ups

Live CLI version, account/workspace, schema and real snapshot acceptance remain unverified.
<Required pending delivery checks and next action.>
Merge delivers; only the owner records acceptance and closes the issue.
```

Use `passed`, `failed`, or `skipped` for actual results. Required failures/skips prevent `DONE`;
use `PARTIAL` or `BLOCKED`. Live collection is outside this documentation task: state that limitation explicitly
rather than inventing a pass. Completing an offline documentation task does not satisfy the live acceptance
gate below. The [phase 1 contract](../../../docs/work-tracking/README.md) keeps issue lifecycle in GitHub;
a report's `DONE` means its required work and evidence are complete, while owner acceptance remains separate.

## Target selection

Create a local file outside Git, for example `$HOME/.config/codex-usage/target.json`:

```json
{
  "expected_email": "YOUR_CHATGPT_ACCOUNT_EMAIL",
  "use_current_cli_workspace": true
}
```

Do not put tokens, cookies or auth-file contents in this file. Do not commit it.

## One-shot collection

```sh
python3 /absolute/path/to/newclear/tools/codex-usage/codex_usage.py \
  --codex "$(command -v codex)" \
  --target-file "$HOME/.config/codex-usage/target.json"
```

Exit code: `0` both usage reads OK; `2` partial; `1` failed. Always inspect stdout JSON on non-zero exit.

## Acceptance gate

Before scheduling anything, record and review:

1. `codex --version`;
2. actual authentication/account type without exposing credentials;
3. installed App Server method/schema support;
4. one redacted real snapshot;
5. comparison against the visible Codex usage/status view;
6. confirmation that missing cycle-aligned token data remains `null`.

Until this passes, this project is **offline-tested / live-unverified**.
