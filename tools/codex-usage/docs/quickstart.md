# Quickstart

## Requirements

- Python 3.11+
- POSIX host
- official `codex` CLI already installed
- CLI already authenticated to the intended ChatGPT account/workspace

The collector does not install Codex or perform login. Specify the intended account independently;
do not turn a discovered account email into its own expected identity. The `use_current_cli_workspace`
setting explicitly accepts the CLI's current workspace without claiming workspace identity verification.
A requested `expected_workspace_id` fails closed in this adapter.

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

Use the [report template](../../../docs/work-tracking/report-template.md) if you keep a local report. It is an optional format, not a claim.
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
use `PARTIAL` or `BLOCKED`. The historical documentation task did not authorize live collection. The current
[development prompt](../START_DEVELOPMENT_PROMPT.md) does authorize the fixed read-only live checks,
once the intended target is independently specified. Offline checks do not satisfy the live acceptance
gate below. A report's `DONE` means its required work and evidence are complete, while owner acceptance remains separate. Do not treat the archived phase-1 contract as the current claim process.

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
A missing or unknown schema must not be treated as zero use. If the final identity check fails,
the snapshot must not retain quota/token data from an unverified account. Source timestamps remain
unknown when absent; daily/lifetime tokens never become quota-cycle tokens.

To inspect the installed protocol without an account request, run
`codex app-server generate-json-schema --out <build-directory>`
with the output inside the shared launcher's `AGENT_BUILD_DIR`.
The 2026-10-23 check of CLI 0.163.0 is recorded in [schema evidence](evidence/2026-10-23-schema.json).
Schema generation proves local method/field support only; it does not prove authentication or a live response.

For a live run, keep the target and raw output outside Git. Capture stdout even when exit is 1 or 2.
Only share an inspected, de-identified snapshot: exclude identity strings, private paths, arbitrary
upstream text and unknown fields. Record CLI version, UTC collection time, source version/hash,
query statuses and whether account comparison succeeded. Do not read credential files.

## Acceptance gate

Before scheduling anything, record and review:

1. `codex --version`;
2. actual authentication/account type without exposing credentials;
3. installed App Server method/schema support;
4. one redacted real snapshot;
5. comparison against the visible Codex usage/status view;
6. confirmation that missing cycle-aligned token data remains `null`.

The current stage is **offline-tested / live-collected / visible-status-unverified**: AC-03
passed with an owner-specified target; AC-04 still needs the visible comparison. See the
[live follow-up report](evidence/2026-10-23-live-report.md). The complete gate remains pending.

## Comparing the visible usage/status view

Use the same independently specified account and explicitly selected current CLI workspace. Capture
the visible reading close to the snapshot and record both UTC observation times and the display timezone.
For each bucket/window compare the window duration, used versus remaining percentage, and reset instant
(convert display time to UTC). Allow only explained display rounding and elapsed-time differences.
Record unavailable fields as unavailable, never as zero or as a successful comparison. Do not open a
model thread/turn just to obtain a status view. If there is no already available view, AC-04 remains pending.

| Field | Snapshot | Visible reading | Comparison |
| --- | --- | --- | --- |
| Account/workspace match | Local verification only | Same selected account/workspace | pending |
| Bucket / window duration | pending | pending | pending |
| Used / remaining percentage | pending | pending | pending |
| Reset instant (UTC) | pending | pending | pending |
| Cycle tokens | must remain null without aligned source | not inferred from quota | pending live check |

The placeholders above are a procedure, not observed evidence. Record actual results in the existing
[task board](tasks/BOARD.md) and its linked evidence.
