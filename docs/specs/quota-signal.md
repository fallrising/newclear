# Quota signal

Status: **Proposed** (2026-09-28). Not accepted until the owner merges this document.

Owners: `tools/cc-quota` and `tools/codex-usage` (producers). Consumers are task dispatchers and
attention views outside this repository.

## Context

Both tools read subscription usage for a coding-agent CLI:

- `cc-quota` collects Claude Code usage hourly into SQLite (`snapshots`: `used_pct`, `remaining_pct`,
  `reset_in_s`, `pace`, `exhaust_in_s`, `verdict`, ...) and has a human-oriented `report`.
- `codex-usage` is a one-shot, stateless reader that prints JSON (`remaining_percent`,
  `seconds_until_reset`, ...), keeps partial failures and uses `null` for missing values.

A dispatcher that decides whether to release the next agent task needs one shape for both. Today it
would need two parsers with different field names and units.

## Goal

Each tool gains a read-only command that prints one **quota signal v1** JSON document to stdout.
The signal is advisory: consumers may warn or hold new work, never stop running work.

## Non-goals

- New collection endpoints, scraping, or credential handling changes.
- Scheduling, notifications or task dispatch inside these tools.
- Adding state to `codex-usage` (it stays stateless).
- Cost in money. Both sources report percentages of a subscription window, not bills.

## Signal v1

```json
{
  "signal_version": 1,
  "provider": "claude-code | codex",
  "observed_at": "<UTC ISO8601, when this tool read the source>",
  "source_updated_at": "<UTC ISO8601 | null>",
  "windows": [
    {
      "name": "<source window name, e.g. five_hour | seven_day>",
      "remaining_percent": 0.0,
      "seconds_until_reset": 0,
      "pace": 1.0,
      "state": "ok | tight | exhausted | unknown"
    }
  ],
  "errors": ["<stable error code>"]
}
```

Rules:

- **QS-1** — `remaining_percent` is `clamp(100 - used_percent, 0, 100)`; `seconds_until_reset` is
  `max(0, resets_at - now)`. Missing inputs yield `null`, never `0`.
- **QS-2** — `pace` is used-percent divided by elapsed-percent of the window when both are known,
  else `null`. `codex-usage` computes it from the same response; it does not need history.
- **QS-3** — `state` is derived only from fields in the same document:
  `exhausted` when `remaining_percent == 0`; `tight` when `pace > 1.2` or `remaining_percent < 10`;
  `ok` otherwise; `unknown` when `remaining_percent` is `null`. Thresholds are constants in each tool
  and listed in its README.
- **QS-4** — Partial failure still prints a valid document with `errors` populated and exit code 0;
  total failure prints a document with an empty `windows` list and exits non-zero.
- **QS-5** — The document contains no token, account identifier, email or raw response body.

Commands:

- `cc_quota.py signal` reads the latest snapshot from SQLite; it does not call the network.
  If the latest snapshot is older than two collection intervals, `state` is `unknown` for every
  window and `errors` contains `stale_snapshot`.
- `codex_usage.py --signal` performs its normal one-shot read and prints the signal instead of the
  full document.

## Consumer guidance (non-normative)

A dispatcher should treat `tight` as "warn before releasing new work" and `exhausted` as
"do not release new work for this provider until reset". It must not cancel or pause running work
based on this signal.

## Acceptance Criteria

- Each tool has offline tests for QS-1 to QS-5 using recorded fixtures.
- The existing root workflows `codex-usage-ci.yml` and `cc-quota-ci.yml` run the new tests and
  cover the new command.
- Both tools' README and quickstart document the command; steps not run on a real account stay
  marked `skipped` with the reason.
