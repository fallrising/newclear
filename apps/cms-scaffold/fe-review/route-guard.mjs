/** No dynamic URLs or browser text are included in failures. */
export function verifyObservation(contract, observed) {
  let expected;
  let actual;
  try {
    expected = new URL(contract.finalPath, contract.baseUrl);
    actual = new URL(observed.finalUrl);
  } catch {
    throw new Error('REVIEW_URL');
  }
  if (actual.href !== expected.href) throw new Error('REVIEW_URL');
  if (observed.status !== 200) throw new Error('REVIEW_STATUS');
  if (observed.identity !== contract.identity) throw new Error('REVIEW_IDENTITY');
  if (observed.loaded !== true) throw new Error('REVIEW_LOADED');
  if (observed.pageErrors !== 0) throw new Error('REVIEW_PAGE_ERRORS');
  return true;
}
