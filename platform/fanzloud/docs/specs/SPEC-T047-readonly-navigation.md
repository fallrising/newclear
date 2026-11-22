---
id: SPEC-T047
status: specified
contract_units: [CU-WEB-NAV-01]
---

# CU-WEB-NAV-01: static existing-result navigation

Given the existing isolated-mode page, including logged-out/unavailable states, display
one native, initially collapsed details control labelled 「查看既有成果」 outside the hidden
task panel, containing a semantic nav landmark labelled 「既有成果操作說明」. Native
keyboard/summary activation expands it without JS, preserving compact login/task access.
Its three items distinguish Fanzloud isolated-task diff/candidate, AP workbench archives,
and Office local results/native terminal. All actions explicitly say 「操作說明」 and
「新分頁」; they do not advertise an available service or fetch results.

Only these HTTPS URLs are allowed (public documentation on main, not runtime locators):

- https://github.com/fallrising/newclear/blob/main/platform/fanzloud/docs/isolated-operator.md
- https://github.com/fallrising/newclear/blob/main/platform/agent-platform/docs/RESULT-ARCHIVE.md
- https://github.com/fallrising/newclear/blob/main/labs/agent-office-lab/docs/RESULTS.md

Every link has target=_blank, rel=noopener noreferrer and referrerpolicy=no-referrer.
No query/fragment, user input, ID, session/token, run reference or command is inserted.
No script, form, handler, prefetch, polling, storage write or new API is introduced.
Existing page bootstrap GET and authenticated polling are unchanged, not new navigation
I/O. Opening a document never changes the current selection, authenticates, submits,
cancels, reconciles, retries, reviews or exports. The destination's failure does not
trigger fallback execution; the original page remains open. No return value is consumed.

# Compatibility, errors and effects

The three products keep their own auth, run/session and result authority. Public documents
may evolve; there is no inferred live status or cross-product identity mapping. Offline
network errors are normal browser errors; navigation is optional. Original controls remain.
Only browser navigation is added (no platform-managed mutation); no command/event schema,
error type, persistence, Rust signature or rustdoc contract changes. CSS selectors use the
new result-entry-nav class, including link/focus styles, without affecting P0 controls.

# Acceptance traceability

| Clause | Evidence |
| --- | --- |
| N01 | Chromium actual markup at 390/1280 widths, semantic labels, keyboard focus, logged-out and unavailable fixtures |
| N02 | Actual click into intercepted document navigation: fixed URL, opener null, Referer absent, original URL preserved; no mutation requests |
| N03 | Existing Web regression; required hosted Fanzloud native checks; screenshots and source hashes |
| N04 | Index/local-link/changed-scope/whitespace, independent review, PR/CI/merge/readback and board closure |

No new product live acceptance, FN07 or full platform completion follows from these checks.
