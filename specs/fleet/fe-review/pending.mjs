// Attach rejection handling at creation, even if an action fails before awaiting.
export function observed(promise) {
  return promise.then((value) => ({ value }), (error) => ({ error }));
}
export async function unwrap(promise) {
  const outcome = await promise;
  if (outcome.error) throw outcome.error;
  return outcome.value;
}
export function errorCategory(error) {
  const message = String(error?.message ?? '');
  if (/^REVIEW_[A-Z_]+$/.test(message)) return message;
  if (message.includes('strict mode violation')) return 'REVIEW_LOCATOR_AMBIGUOUS';
  if (error?.name === 'TimeoutError') return 'REVIEW_BROWSER_TIMEOUT';
  if (message.includes('Target page, context or browser has been closed')) return 'REVIEW_BROWSER_CLOSED';
  return 'REVIEW_FAILED';
}
