import assert from 'node:assert/strict';

export async function tabTo(page, locator, key = 'Tab') {
  await locator.waitFor({state: 'visible'});
  assert.equal(await locator.count(), 1, 'REVIEW_KEYBOARD_TARGET_COUNT');
  for (let count = 0; count <= 200; count++) {
    if (await locator.evaluate(el => el === document.activeElement)) {
      const focus = await locator.evaluate(el => {
        const style = getComputedStyle(el);
        return {focusVisible: el.matches(':focus-visible'), outlineWidth: parseFloat(style.outlineWidth), outlineStyle: style.outlineStyle, shadow: style.boxShadow, disabled: el.disabled === true};
      });
      assert(focus.focusVisible && !focus.disabled, 'REVIEW_KEYBOARD_FOCUS');
      assert((focus.outlineWidth > 0 && focus.outlineStyle !== 'none') || focus.shadow !== 'none', 'REVIEW_KEYBOARD_INDICATOR');
      return {tabs: count, direction: key, focus};
    }
    await page.keyboard.press(key);
  }
  throw Error('REVIEW_KEYBOARD_UNREACHABLE');
}
export function observeResponse(page, origin, method, path, observed = () => {}) {
  // Attach rejection handling immediately; a later UI failure must not leave an
  // unhandled wait masking its original failure or bypassing owned cleanup.
  const pending = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === origin && url.pathname === path && response.request().method() === method;
  }, {timeout: 10000}).then(response => ({response}), () => ({failed: true}));
  return async expected => {
    const result = await pending;
    assert(!result.failed, 'REVIEW_RESPONSE_MISSING');
    assert.equal(result.response.status(), expected, 'REVIEW_RESPONSE_STATUS');
    observed(result.response);
    return expected === 204 ? null : result.response.json();
  };
}
