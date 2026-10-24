/** Self-contained addInitScript function. No product imports or native fallback. */
export function installFlowshotFixture() {
  const host = window;
  if (host.__FLOWSHOT_BUILD_INFO_PROMISE__ || host.__FLOW_REVIEW__ || host.__TAURI_INTERNALS__) throw new Error('FIXTURE_COLLISION');
  if (host.document.readyState !== 'loading' || host.document.querySelector('#root')?.childElementCount) throw new Error('LATE_PRELOAD');
  let resolve, reject;
  let state = 'loading';
  let observed = false;
  let unknownInvokes = 0;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  // The real eager launch also handles rejection; this protects disposal before React mounts.
  void promise.catch(() => undefined);
  host.__FLOWSHOT_BUILD_INFO_PROMISE__ = promise;
  host.__TAURI_INTERNALS__ = { invoke: async () => { unknownInvokes++; throw new Error('NATIVE_FORBIDDEN'); } };
  function settle(next) {
    if (!observed) throw new Error('LOADING_NOT_OBSERVED');
    if (state !== 'loading') throw new Error('ALREADY_SETTLED');
    state = next;
  }
  host.__FLOW_REVIEW__ = Object.freeze({
    observeLoading() { if (state !== 'loading') throw new Error('ALREADY_SETTLED'); observed = true; },
    ready(long = false) {
      settle('ready');
      resolve({ version: '0.0.0-review', gitSha: long ? 'synthetic-long-revision-'.repeat(12) : 'synthetic-revision', buildProfile: 'review-only' });
    },
    error() { settle('error'); reject({ code: 'INTERNAL', message: 'Synthetic build information unavailable', retryable: false, correlationId: 'synthetic-error' }); },
    snapshot() { return { state, observedLoading: observed, unknownInvokes, synthetic: true }; },
    dispose() { if (state === 'loading') { state = 'disposed'; reject({ code: 'INTERNAL', message: 'Synthetic fixture disposed', retryable: false, correlationId: 'synthetic-disposed' }); } },
  });
}
