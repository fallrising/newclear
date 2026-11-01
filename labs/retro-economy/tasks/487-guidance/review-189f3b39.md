# Review: Retro #487 guidance fixes

**Verdict: PASS**

**Reviewed SHA:** `189f3b39385a21dab16f927bf183deb7d11da3fe` (base `6c611778a83b8e2d7198edace1dfc6a04d517516`)

This was a static review of the supplied diff and full-head files only. I ran no tests, browser, CI or git commands. The RED/GREEN summaries, `browser-result.json` and screenshots are treated as supplied artifacts, not as execution I observed.

## Blocking findings

None.

## Checks against the contract

**Gathering hint follows current position and the actual action (HINT-01)**
- `app.js:266` computes remaining route length correctly for every reachable node in both professions. That includes cross-branch and tower-road positions, for example smith at (0,2) → 5 and herbalist at (2,0) → 6.
- `app.js:267` (`homeward`) is only used off-town and gives the correct direction and count on each branch.
- On arrival (`remaining === 0`), the hint tells the player to press 採集 `needed - raw` times. That count is always positive in step 0, and gather is enabled there per `controls()`.
- With enough raw materials, the hint becomes "return to town" off-town and "craft" in town. Craft is enabled only in town with sufficient materials, which matches the domain rules.
- `app.js:286`: the missing-opposite-supply override now applies only in town at step 0 or at step 2, so it no longer hides arrival or crafting guidance. The town step-0 text still mentions 採集製作, so it stays truthful.

**Summit, return, town and repeat ascent (HINT-02)**
- Every reachable state is handled consistently:
  - **Summit (x=4):** "向西走 4 格回鎮".
  - **Claimed, stage 2, x=1–3:** neutral two-route text with correct distances, and the step label is 塔路往返.
  - **Unclaimed, stage 2:** "首次登頂 +8", which is correct because only a first round can be in this state.
  - **Stage 1:** must be ascending in the current round, since stage 2 only resets in town, so "霧影在東側" is accurate.
  - **Town:** stage resets to 0 and the label returns to 向東登塔.
- Lifetime reward is never treated as proof of a completed round. The repeat-ascent text ("可前往東側塔頂…再次登頂不再發獎") does not block or contradict a second ascent.
- `domain.py` is consistent with every distance and message used.

**No mechanism changes**
- The diff touches no backend, rules, economy or trading code.
- `source-hashes.json` pins `domain.py`, `store.py` and `http.py`. I did not verify the hashes myself.

**Regressions**
- The `test_ui.mjs` VM harness runs the real `startGame`/`render`/poll/resume path, not a copy of the logic. Its `flush` asserts that render actually completed.
- The 10 tests in `node-red` would fail on the original code: the fixed "走 3/4 格" text, and "沿塔路向東"/"繼續向東" on return.
- `browser_smoke.mjs` only adds assertions; every prior `move`, restart, trading, replay and conservation assertion is still present. The new checks read actual DOM text, button disabled state and step labels, including after a reload at x=2 for both professions.

**Documentation**
- SUCCESS, README, re1-contract and the report all state the limits: no expansion of RE-3 results, and no claims about human fun, motivation or balance.
- The worker report keeps its PARTIAL browser status honestly. The root report attributes the final browser run to the orchestrator.
- Board rows remain `in_progress` before merge, as the repo rules require.

## Optional suggestions (non-blocking)

1. **Stale reviewer route in `report.md:58`.** The line says Claude will not be retried and that Grok 4.7 reviews the final SHA. This review is a Claude review of the final SHA, so the board/closeout PR should record the actual reviewer route. That keeps the claims about the review route accurate.
2. **Pre-existing fixed distance at `app.js:279`.** The step-2 text "沿東側塔路前進 4 格" is not position-aware. It is stale if a stage-0 character holding both supplies is anywhere but town, for example at (1,0) or after a market purchase elsewhere. This is outside #487's two defects and not a regression; consider it for a follow-up.
3. **Cross-branch and missing-supply edge tests.** These four tests were added after the first GREEN, so no pre-change RED was shown for them. The report says this truthfully. If wanted, capturing their RED against the base `app.js` would strengthen the evidence.
4. **`lastChild` label update at `app.js:304`.** It relies on the label being the element's last child text node. Browser evidence confirms that holds with the current markup, but any trailing whitespace in the HTML would silently break it. A dedicated label `<span>` would be more robust.
