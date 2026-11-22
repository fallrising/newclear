# CU-WEB-OFFICE-NAV-01 — local Office result navigation

Owner-authorized continuation of [FZ-OFFICE-NAV](../tasks/FZ-OFFICE-NAV.task.md).
Baseline `1f855489328736a2578bb0c9e7d76e688b4f5bf8`. Technical design, not a
change to original product AC. Reuses existing Office `/` and GET `/api/state`;
no new backend endpoint, result service, credential, permission or deployment.

## Behavior and trust boundary

The existing Fanzloud Office instruction item gains a labelled optional **local
port** field and an explicit open link. No URL, hostname, token, path, run ref or
command is accepted. Canonical decimal ports 1024–65535 only, no whitespace or
leading zero. Empty/invalid input leaves no href and displays unset/invalid help.
The field is not persisted or submitted and resets on page load; input changes
invalidate the old href immediately. The only constructed destination is
`http://127.0.0.1:<port>/#view=results`, a fixed non-secret view selector on the
existing Office root. No automatic open, fetch, probe, prefetch, retry or storage
write. Link uses a new tab with noopener/noreferrer/no-referrer.

The UI states that Office must already be running **on the browser's machine**,
that only its port is entered, and that availability/login are checked by Office.
It gives offline/wrong-port instructions before navigation. Fanzloud cannot
observe a cross-origin page's failure and must never claim that it can. Existing
public instruction links stay usable, including before Fanzloud login or when
its own session API fails. Numeric port is a local navigation setting, not auth.

Office's existing root frontend recognizes exactly `view=results`, records this
UI mode in that Office tab's sessionStorage, and keeps it across reload and the
original same-tab launch-URL authentication. A fresh noopener tab cannot inherit
another tab's token: without an existing token it explains how to open the
already-running console's original private launch URL **in this Office tab**.
Nothing is copied to Fanzloud. No new token input/exchange/credential is added.
A token-fragment hash-only navigation reloads the same source tab to invoke the
existing parser; it does not exchange credentials with Fanzloud. Existing
token-fragment parsing/removal and server bearer/Host/Origin policies
remain unchanged. If source mode storage is unavailable, results-only selection
must fail closed instead of accidentally exposing operational controls.

The source view shows only existing results/filter/detail/verified download,
an explicit refresh and source-owned return-to-full-console action. No provider,
plan, detect, execute, stop, retry or native-terminal actions are bound or rendered
in this view. The frontend API helper additionally rejects non-GET calls in this
mode. This is a UI safety boundary, **not** a new read-only token/server capability;
the existing authorized token retains its original permissions. Returning to full
Office is a distinct user action, not a refresh side effect. It clears only the
view selector and reloads the original console; no task starts automatically.

Only an initial authorized GET and explicit refresh fetch source state; no polling
in results-only mode. No-token, 403, unavailable/invalid state or network error
clears displayed rows/detail/downloads and presents generic source-local recovery
instructions. Refresh is serialized; stale detail is cleared on each refresh so
removed/tampered records cannot retain a previously enabled download. Source
native statuses (including unknown), provenance, raw vs displayed/download hashes
and integrity-disabled downloads are reused without reinterpretation. Fanzloud
never reads the result payload. `ref` remains a lookup key, not authorization or
an anonymity guarantee. AP execution/stop/recovery authority is unchanged.

## Contract questions and rollback

Input: local port and fixed source-view selector, no command/event schema.
Output: optional native navigation and Office's existing result view.
Authorization: source-owned existing bearer checks; Fanzloud grants none.
Atomicity: no domain write/transaction. Only per-tab view preference and existing
source login storage; no intent, dispatch, reconciliation or artifact write.
Retries/recovery: explicit read refresh only; no auto recovery or work retry.
Errors: local validation and generic source auth/offline failures, no raw secret
echo. Rollback clears the local port/removes the optional nav and clears source
view mode; native Office console, terminal/session and offline results survive.
No migration, database or dependencies. Do not enable a public listener or open a
service window. If safe first-open source auth cannot be demonstrated, stop.

## Acceptance and executable checks

| Clause | Required evidence |
| --- | --- |
| N01 | Actual Chromium shipped Fanzloud UI → actual isolated Office HTTP `/`, first unauthenticated open, same-source-tab original launch URL, results, refresh/reopen; keyboard/mobile/desktop checks |
| N02 | Focused unset/invalid/bounds/change/reload tests and browser unavailable/denied checks; no previous href or private data remains |
| N03 | Browser request records, absent document Referer, null opener, source-only synthetic token; no Office payload/identifier at Fanzloud, no new storage there |
| N04 | Actual source HTTP plus synthetic existing runs; no POST/runner launch, before/after source bytes/mtime unchanged; failure/unknown, raw/display hash and tamper-download cases |
| N05 | Explicit return to original Office, no implicit execution; relevant regression tests, independent review, native CI, normal PR merge/readback and BOARD closure |

Focused tests extend `acceptance/m2-isolated.test.mjs` and add
`labs/agent-office-lab/scripts/office_results_view.test.mjs`. Browser harness uses
synthetic Fanzloud session only, actual Office handler and isolated records. It
must not invoke existing Office paid/local-model acceptance drivers. Original
FN07 owner operation and live private deployment remain outside this source-level
functional validation and cannot be marked passed. No release or deploy.
