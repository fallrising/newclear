# M2 repair — defects measured by the T-0433 dark baseline

Scope: desk T-0433 (issue 706), R2-AC-14, [DESIGN](../fe-review/DESIGN.md) M2 and [SPEC-T006R](SPEC-T006R-fe-review.md) R07. The dark baseline is 27/27 on the T-0433 source (PR604, main `0111908492c32d0b01d561b24b6024737cb4f641`). Each repair below follows a defect that the baseline actually measured; nothing is changed on assumption. Changes stay within `index.html` and `p0.css`, keep every existing ID, the controller interface, action order and text-only sinks, and make no visual redesign.

## Measured defects and repairs

M2-01 — The `device-pending__mobile__dark` page overflows horizontally (document 390 wide, scrolls to 399).
- Cause: `#verification-url.mono` holds the 36-character URL in an unbreakable monospace run, about 346 px. The card content box is about 284 px at 390, so the right edge lands near 399.
- Repair: `.mono` gains `overflow-wrap: anywhere`, the same rule `.timeline` and `.diff` already use.

M2-02 — `success-diff__mobile__dark` has axe `scrollable-region-focusable` (serious). On every cell, `#event-list` and `#diff-output` have `tabIndex` -1 and no name.
- Repair: both `<pre>` elements gain `tabindex="0"`, `role="region"` and `aria-labelledby`, pointing at their existing section headings, which gain the IDs `activity-heading` and `diff-heading`.
- The text stays inert and no live region is added (R07: do not announce every event or diff chunk).
- No CSS removes the default focus outline, so focus stays visible through the user agent's `:focus-visible` ring.

M2-03 — axe marks color-contrast as incomplete (serious) on all 27 cells. R07 requires bounded rendered-color and background evidence.
- Every text color in `p0.css` is checked against the lightest background the CSS layers can produce under it. That is the most opaque surface (card or panel `rgba(10,24,19,0.88)`) composited over the lightest body point: the lightest gradient stop `#0b1713` plus the full radial overlay `rgba(54,161,118,0.16)`. For text drawn straight on the body (header, status, error), the same body bound is used without the card layer.
- Button text is checked against its own solid button background.
- Disabled controls (`opacity: 0.45`) are exempt under WCAG 1.4.3 and are listed as such.
- The bound requires 4.5:1 for normal text and 3:1 for large text (h1 and h2).
- The baseline PNGs give the rendered cross-check. Pixels sampled from a fixed empty body area (the top-left 12×12 corner) of each viewport's `authenticated-ready` capture must lie within the computed body background range, from the darkest stop `#07100d` up to the lightest bound.
- This is bounded evidence for contrast acceptance, not an axe pass. axe may still report incomplete, and the evidence is recorded beside it.

## Tests (focused RED first)

`fe-review/m2-presentation.node.mjs`:
- M2-01: `.mono` wraps.
- M2-02: both regions are focusable, named by existing headings and not live.
- M2-03: computed contrast lower bounds per text color, plus the PNG background cross-check when baseline PNGs are present.

M2-01 and M2-02 fail on the baseline source for the intended reason and pass after the repair. M2-03 is evidence, not a change, so its first run must pass. Existing T006 and fe-review suites must stay green.

## Recapture boundary

The repair changes the served `/` and `/assets/p0.css` bytes, so every runner pin and every cell's served assets change. Under the existing hash-equality rules, no earlier cell stays reusable. Recapturing (all 27, or only the R10-affected keys with explicit provenance) is a separate owner decision before any runtime. The v4–v6 runners stay as historical runners accepted on the milestone-1 source. Their pin tests now require the two M2-changed assets to equal the milestone-1 hashes, and every other pin to equal the current files, so they cannot silently run on the repaired source. This unit runs no browser. The M2 acceptance gates (no unexpected overflow, no axe critical or serious, named keyboard-accessible regions) are judged on that recapture.
