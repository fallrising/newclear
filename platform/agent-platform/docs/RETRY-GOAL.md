# Adjust a goal and run again

After the latest attempt has succeeded, failed or been cancelled, **重新執行** keeps its existing goal, base commit and Agent profile. **調整目標後重新執行** opens an editor containing the latest attempt's goal. Change the instructions and choose **以新目標重新執行** to create the next attempt on the same task. **取消修改** closes the editor without sending a command.

Only the goal is editable in this flow. The new attempt retains the latest base SHA and profile revision and uses the existing version-checked, idempotent retry endpoint. Each attempt keeps its own goal and result; the **本次工作目標** section follows the selected **執行紀錄**. Looking at an older attempt does not change which latest attempt supplies the retry editor's starting goal.

The editor rejects whitespace-only content and input over 20,000 Unicode code points. The request preserves the typed content; the existing API trims outer whitespace while keeping internal spaces, line breaks and Unicode. Goals render as plain text, including strings that look like HTML. The retry endpoint also retains its existing request-size limit.

During submission, editing, cancellation and competing retry actions are disabled. An error retains the draft while the same latest attempt remains; retrying the same payload reuses its idempotency key. Background refreshes of that attempt do not overwrite a draft. If a different latest attempt arrives, the editor resets; if that attempt is active, retry controls disappear. Successful submission selects the newly created attempt. A retry creates a queued attempt; it does not mean execution has completed.

## Validation

Frontend tests cover cancel, raw multiline input, Unicode size boundaries, historical goals, safe text rendering, pending controls, lost-response retry keys, conflicts and refresh behavior. A real Chromium test uses the local PostgreSQL/API fixture to cancel a draft, submit one edited attempt, check request metadata and disabled controls, verify the original run is unchanged, switch between goals/results, and reload the saved new goal. The fixture leaves the new attempt queued and checks that no runtime allocation or prompt is performed by these UI operations.

```sh
make web-check
make browser-test
ruff check scripts/browser-fixture.py
ruff format --check scripts/browser-fixture.py
git diff --check
```

This slice changes the frontend and test fixture, with no backend API, database or dependency changes. The complete local browser suite is required; the backend suite is not rerun locally for this frontend-only change. Independent review and PR CI supplement the local evidence in `evidence/retry-goal-2026-10-04.json`. No live VM/provider, billing, deployment or full-M3 acceptance claim is made.
