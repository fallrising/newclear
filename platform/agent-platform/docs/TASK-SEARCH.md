# Task history search and filters

The task list supports an explicit **搜尋** action plus **篩選專案** and **篩選狀態**. Search matches the task title or the latest run's goal, case-insensitively. Filters combine, stay in effect when paging, and reset pagination to the first page when changed. **清除篩選** returns to recent tasks. Empty filtered lists explain that no tasks matched; the selected task workspace remains available independently of the list. Typing alone does not submit a search; existing background polling continues.

The address bar preserves the submitted search and selected project/state. Reload the page, bookmark or open that address in another tab to restore the filters and selected task. Browser Back/Forward restores the corresponding filters and search field, starting on the first page. Explicit filter changes add a history entry; submitting the same normalized filters again does not. The selected task's `#` fragment and unrelated query parameters survive filter changes and clearing. Pagination cursors are not restored from the address.

Filter links validate `q`, `project_id` and `state` before requesting tasks. Duplicate filter parameters, a search over 200 Unicode code points before trimming, NUL, noncanonical UUID syntax or unknown states show a recoverable notice and fall back to recent tasks. **清除篩選** removes those parameters. UUID letters may be upper or lowercase and normalize to lowercase. A valid project whose name is unavailable remains visibly selected by ID; it is never displayed as **所有專案**. Sharing a link still requires a valid operator session and does not grant access.

`GET /api/v1/tasks` accepts optional `q`, `project_id` and `state` alongside the existing `cursor` and `limit`. A valid operator session is required. Search input is limited to 200 characters before trimming; whitespace-only means no search. NUL is rejected with 422. `%`, `_`, `!` and backslash are ordinary search characters, not wildcard or SQL operators. Project IDs must be UUIDs and states must be known run states; invalid inputs return 422. A valid but absent project has no matches.

State and goal filters use the latest attempt of each task, so an older failed attempt does not make a currently queued retry match the failed filter. Keyset ordering remains task creation time and UUID, newest first. Filtered cursors contain a versioned anchor and a fingerprint of normalized filters, remaining within the 512-character input limit even for 200-character Unicode searches. Reusing a cursor with a different query/project/state, or supplying malformed anchors, returns 422 `invalid_cursor`. Unfiltered cursors preserve the existing representation. The fingerprint binds query scope; it is not an authorization token. Every request still requires authentication.

The feature issues read requests and does not rerun tasks, change run state or allocate a runtime. No new database schema, dependencies or external search service is needed.

## Validation

```sh
make platform-check
make web-check
make browser-test
```

SQL/HTTP cases cover literal and Unicode matching, combined filters, latest attempts, pagination, malformed/mismatched cursors, authentication and input bounds. UI cases cover explicit submission, combined controls, clearing, filtered empty states and cursor resets. A real Chromium case queries the real local PostgreSQL/API fixture, traverses 32 matching tasks across pages, checks a Unicode/metacharacter goal, clears and reloads, and proves fake runtime prompt/allocation counts are unchanged. Existing disconnect/reconnect and inert diff-download cases remain in the suite.

The filter-link follow-up adds parser and UI cases for normalization, malformed/duplicate inputs, history and pagination restoration, unavailable project names and preservation of unrelated URL data. Real Chromium cases cover reload, opening a shared address in another tab, Back/Forward with a selected task, malformed-link recovery and unavailable projects. This frontend-only follow-up reruns `make web-check` and the complete `make browser-test` suite; it does not change or rerun the backend test suite. Its evidence is in `evidence/search-links-2026-10-03.json`.

Platform checks use pinned Python 3.12. Local browser fixtures use Python 3.13.5 with existing locked dependencies, Node 24.18.0 and pinned Playwright Chromium. These tests do not make a VM/provider or full-M3 acceptance claim; billing stays deferred. Sanitized final counts and log hashes are in `evidence/task-search-2026-10-03.json`.
