# Private Office result navigation: verified gap and minimum proposal

2026-11-22; [task and ownership](../tasks/FZ-OFFICE-NAV.task.md).
This is a technical proposal under the owner's explicit insufficient-contract
fallback. It neither changes product AC nor declares a private feature available.

## Existing entries and access

Source for the following observations is main
`1c642259957aed8f65c31dc45f77740a121d9aa4`:

| Entry | Actual location/access contract | Consequence for Fanzloud |
| --- | --- | --- |
| [PR1057](https://github.com/fallrising/newclear/pull/1057), closed by [PR1058](https://github.com/fallrising/newclear/pull/1058) | Static disclosure with three public GitHub instruction links; no private destination configuration | Already implemented. It does not open private Office results or handle configured private endpoints. Do not repeat it or use its N01–04 as this feature's acceptance. |
| [Office RESULTS](https://github.com/fallrising/newclear/blob/1c642259957aed8f65c31dc45f77740a121d9aa4/labs/agent-office-lab/docs/RESULTS.md) | CLI reads explicitly selected local runs; HTML is a point-in-time local file, permission 0600, new output only. Clean checkout contains no private runs. | This is an existing read-only artifact, not a deployed HTTP address. Do not infer a browser-accessible server or copy/upload the snapshot into Fanzloud. |
| [Office CONSOLE](https://github.com/fallrising/newclear/blob/1c642259957aed8f65c31dc45f77740a121d9aa4/labs/agent-office-lab/docs/CONSOLE.md) | Runs on the Office machine, binds 127.0.0.1 with random port by default (explicit fixed port supported). Launch URL contains a private fragment token; API requires bearer, exact Host and origin checks. | Browser loopback refers to the browser machine, not a remote Fanzloud/Office host. No port scan, guessed hostname, SSH tunnel or new public listener. |
| [Console HTTP implementation](https://github.com/fallrising/newclear/blob/1c642259957aed8f65c31dc45f77740a121d9aa4/labs/agent-office-lab/scripts/office_console.py) and [client](https://github.com/fallrising/newclear/blob/1c642259957aed8f65c31dc45f77740a121d9aa4/labs/agent-office-lab/scripts/office_console.js) | Existing authenticated GET `/api/state`; UI also exposes explicit plan/execute/stop. Token moves from fragment to that tab's sessionStorage. No documented standalone result-page navigation contract. | A fresh noopener tab cannot assume the original tab's sessionStorage. A bare root link is not proven authenticated result navigation; forwarding the launch token violates this task. GET JSON alone is not a human result page. |
| [Fanzloud BOARD](https://github.com/fallrising/newclear/blob/1c642259957aed8f65c31dc45f77740a121d9aa4/platform/fanzloud/docs/tasks/BOARD.md) | Prior bounded windows ended with services stopped/no resident URL; original FN07 owner operation remains pending | Do not advertise a standing cross-host deployment from historical acceptance. Current private deployment availability is unknown. |

The established Office product targets a local Mac ([SDD](https://github.com/fallrising/newclear/blob/1c642259957aed8f65c31dc45f77740a121d9aa4/labs/agent-office-lab/docs/SDD.md));
the repository and this Linux checkout cannot certify its current runtime state.
Open [PR1056](https://github.com/fallrising/newclear/pull/1056) concerns Pi live-console
HTTP402, not a new navigation/auth contract. Do not modify or retry that work.

## Exact missing contract

We cannot yet bind an ordinary Fanzloud link to an **existing, reachable, source-owned
private result entry that needs no secret/identity transfer**. Missing evidence:

1. Destination ownership and topology: on which operator browser/Office environment
   the existing entry is reachable; stable locator syntax and permitted origin/path.
2. Source-local authentication usable on first open in a fresh noopener tab, with
   no Fanzloud-held token, session, run ref, private path or cross-product identifier.
3. A result-view contract: what opening/refreshing does, how access denial or
   unavailability appears, and how it preserves native status/unknown/provenance.

This is an evidence/compatibility gap, not a claim that the current console executes
work merely by opening. Its current refresh is read-only. A mixed control console
must not be relabelled as a proven standalone read-only result entry.

## Minimum conditional implementation

Recommendation: retain PR1057 and original Office manual access while resolving
only the destination contract. Do not build a result service, proxy, adapter or
unified database to bypass the gap. Do not add a speculative URL input now.

If an existing entry meets the three conditions, implement one optional Office
navigation action in the current Fanzloud disclosure. Use the existing private
operator configuration boundary; keep actual destination values out of Git,
logs, telemetry and unauthenticated responses. The exact configuration transport
must be chosen from current code after the destination contract is available,
and independently reviewed before implementation. No API/path is designated here.

- Unset: show “Office 私人成果入口尚未設定”, keep the existing instructions usable.
- Invalid: disable navigation with a generic configuration error; do not echo the
  rejected value. Validate against the proven origin/path contract and reject
  credentials, query/fragment secrets, run/session/ref parameters and executable or
  local-file schemes. Do not derive URLs from result IDs or accept arbitrary hosts.
- Configured: explicit user click only, new tab, noopener/noreferrer/no-referrer;
  no credential/identifier transfer, prefetch, probe, automatic retry or polling.
  Source owns access checks; Fanzloud must not report reachability as verified.
- Unavailable or denied: keep Fanzloud intact and provide clear return-to-source
  instructions before navigation; source/browser reports its failure. Cross-origin
  navigation alone cannot observe remote failure or distinguish 403 from offline.
  If acceptance requires Fanzloud itself to detect these failures, stop for a
  separately reviewed contract rather than inventing a health/result endpoint.

If the current console is the only destination, its missing independent result-view
and first-open authentication contract must be resolved on the Office side first.
That is not authorized by this proposal to add credentials, expose a service or
deploy. A new “read-only” mode or endpoint is not silently included in this slice.

## Functional acceptance remains unverified

| Clause | Required evidence before claiming the requested feature works |
| --- | --- |
| N01 Correct destination/access | Actual Fanzloud browser → verified existing Office entry, first open and reopen, source-local access checks; keyboard/mobile/desktop interaction. Documentation links alone do not pass. |
| N02 Unset/invalid/unavailable | Focused validation tests plus browser checks: no link when unset/invalid, no raw value disclosure; offline/denied destination has clear handling, source page retained, no hidden fallback. |
| N03 Privacy | Observe requests, redirects, referrer and opener with synthetic sentinels; no tokens/private identifiers transferred or logged. Test denied/expired access without relaxing source permissions. |
| N04 Read-only semantics | Opening/refreshing repeatedly causes no create/start/cancel/retry/reconcile/export write and changes no source status/data. Check authoritative source state/bytes before and after, not just the browser's HTTP verbs. Preserve failed/unknown, original and display/download hash distinctions; ref remains a lookup key, not an auth token or anonymous guarantee. |
| N05 Reversible delivery | Remove/disable the optional configuration/action and verify original Office terminal/session/local results plus Fanzloud/AP behavior remain reachable. Required tests, interface verification, independent review, CI, normal merge and remote readback. |

Source-result/hash cases must use existing source behavior, including a secret-only
change with raw changed/display unchanged, tampered hash disabling download and
missing/unavailable records. Do not create a new result projection in Fanzloud.
Use isolated synthetic records for negative checks; live navigation needs a verified
existing private entry and authorized access, no new provider work or deployment.

AP remains the sole execution/stop/recovery authority for its routes. Office retains
native terminal, session and local operations; permissions/status/unknown and raw
versus projected/download hashes stay with the source. No original FN07, AP M4,
Office MVP or other product AC is changed by this plan.

Rollback is disabling/removing only the optional navigation/configuration; no source
records, sessions, run stores or result files are deleted or migrated. Stop if the
entry requires secret forwarding, guessed endpoints, source writes, new hosting,
public projection, credential changes, paid calls or a competing executor. Stop
this round at the reviewed gap report; no adjacent milestone starts automatically.
