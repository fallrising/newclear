STATUS: PARTIAL

## Summary

Owner supplied the private target file. The reviewed collector is unchanged (SHA-256 recorded in the receipt). AC-03 now passes: the installed Codex CLI 0.163.0 returned a real snapshot with matching expected ChatGPT email before and after acquisition, all account/rate_limits/usage queries ok, and exit 0. Current CLI workspace selection was explicitly authorized by the target; workspace_identity_verified remains false and is not promoted to true.

AC-04 remains pending because no same-account visible usage/status reading has been provided. Overall mainline remains incomplete; no usable tag or publication is claimed.

## Verification

- Shared launcher cu997-target-preflight: validated owner target without displaying its contents; reviewed source hash matched — passed
- Shared launcher cu997-live-01: `python3 codex_usage.py --codex <installed-cli> --target-file <private-target>`; sandbox attempt exited 1 with process_stdout_closed before usage reads; exact cause not established — failed
- Shared launcher cu997-live-02: same single read-only collection with approved sandbox escalation; exit 0, status ok, account identity verified, all three query statuses ok — passed
- Inspected [de-identified snapshot](2026-10-23-live-snapshot.json) and [receipt](2026-10-23-live-receipt.json): one primary window, 10,080 minutes, 87% remaining; reset 2026-10-29T17:10:45Z; collected 2026-10-22T18:30:44Z; source timestamp unknown and cycle_tokens null — passed
- Original snapshot and stderr retained in restricted evidence outside Git; public snapshot removes bucket labels and replaces IDs with ordinals; no account email, credential or private path in public evidence — passed
- Component contract (`python3 scripts/check_project_success.py --projects tools/codex-usage --contracts-only`), report validators, 41 local links, privacy/hash review and diff check — passed
- Repository-wide `python3 scripts/check_project_success.py`: current unrelated labs/zircon-godot AC table format errors; that concurrent work was left untouched; [check receipt](2026-10-23-live-checks.json) — failed
- Same-account visible usage/status comparison — skipped
- Hosted CI, commit, PR, merge, tag and deployment; no new authorization — skipped

Command placeholders conceal private paths; they describe the actual arguments supplied. Both attempts and their exit codes are preserved. The first failed attempt is not counted as a successful live snapshot. The collector sends only initialize/initialized and the fixed account reads; it does not start a model thread/turn or invoke account mutation. No credentials were extracted. Native CLI internal state handling is not claimed to be filesystem read-only.

## Documentation

Updated SUCCESS, README, quickstart, task board and current verification receipt to distinguish successful live acquisition from pending visible comparison. The earlier offline checkpoint and schema preflight remain historical evidence, with explicit follow-up links. Code/tests are unchanged from the reviewed 33-test candidate; documentation/evidence gates are recorded separately in the follow-up check receipt.

## Risks and Follow-ups

Obtain the same account's visible usage/status reading with observation time and timezone. Compare its weekly window, remaining percentage and reset instant with this snapshot, allowing only explained elapsed usage or display rounding. A new synchronized one-shot snapshot may be needed if the visible reading arrives much later. Missing cycle-aligned token data remains null. AC-04 and publication gates remain pending.
