const INSTALLED = Symbol.for('lab.pi.hook.guard.installed');
const PI_SESSION_ID = /^[A-Za-z0-9._-]{1,160}$/;
const TYPES = new Set(['session', 'prompt', 'tool', 'question', 'error']);
const STATUSES = new Set(['starting', 'working', 'needs_input', 'done']);

function bounded(text, max) {
  return typeof text === 'string' && text.length > 0 && text.length <= max && !/[\p{Cc}\p{Cf}]/u.test(text);
}

// Match upstream normalizePiHook's accepted shape and ignored unknown fields.
export function piHookIdentity(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const v = payload;
  if (typeof v.sessionId !== 'string' || !PI_SESSION_ID.test(v.sessionId)) return null;
  if (!TYPES.has(v.type)) return null;
  if (!STATUSES.has(v.status)) return null;
  if (v.prompt !== undefined && (typeof v.prompt !== 'string' || v.prompt.length > 20_000)) return null;
  if (v.tool !== undefined && !bounded(v.tool, 160)) return null;
  return { event: `${v.type}/${v.status}`, session: v.sessionId };
}

function isStart(idn) {
  return idn.event === 'session/starting';
}

function isPromiseLike(value) {
  return value && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function';
}

function requireManager(manager) {
  if (!manager || !(manager.workers instanceof Map) || typeof manager.authenticate !== 'function' || typeof manager.handleProviderHook !== 'function') {
    throw new Error('Pi hook guard requires a real worker manager');
  }
}

export function installPiHookGuard(manager, { model = 'deepseek/deepseek-flash' } = {}) {
  requireManager(manager);
  if (manager[INSTALLED]) throw new Error('Pi hook guard already installed');
  const native = manager.handleProviderHook;
  const states = new Map();
  const announced = new Map();

  const reject = () => false;
  const getWorker = id => manager.workers.get(id);
  const authenticate = (route, id, token, w) => {
    let ok;
    try {
      ok = typeof token === 'string' && token.length > 0 && manager.authenticate(id, token) === w.info;
    } catch { return false; }
    if (!ok) return false;
    return w?.info?.id === id && w.info.kind === 'agent' && w.info.provider === 'pi' && w.info.model === model
      && !!w.pty;
  };

  function entry(route, id, token, event, payload) {
    if (route !== 'pi') return reject();
    const w = getWorker(id);
    if (!w) return reject();
    if (!authenticate(route, id, token, w)) return reject();
    if (event !== '') return reject();
    const idn = piHookIdentity(payload);
    if (!idn) return reject();

    const oldSt = states.get(id);
    if (oldSt?.poisoned || oldSt?.pending) return reject();
    const newGen = !oldSt || oldSt.wObj !== w || oldSt.tok !== w.hookToken;
    let st = oldSt;
    let exp;

    if (newGen) {
      exp = announced.get(id);
      if (!exp) return reject();
      if (exp.wObj && exp.wObj !== w) return reject();
      if (exp.kind === 'reconnect' && exp.oldTok === w.hookToken) return reject();
      if (!isStart(idn)) return reject();
      const want = exp.kind === 'fresh' ? (w.info.sessionId ?? null) : exp.session;
      if (want !== null && idn.session !== want) return reject();
      if (oldSt?.session && idn.session !== oldSt.session) return reject();
      st = { wObj: w, tok: w.hookToken, session: oldSt?.session ?? null, pending: true, poisoned: false };
      states.set(id, st);
    } else {
      if (st.pending) return reject();
      if (idn.session !== st.session) return reject();
      if (isStart(idn)) return reject();
      if (w.info.sessionId !== st.session) { st.poisoned = true; return reject(); }
      st.pending = true;
    }

    let res;
    try {
      res = native.call(manager, route, id, token, event, payload);
      if (isPromiseLike(res)) throw new Error('Pi native hook returned Promise');
    } catch (error) {
      st.pending = false;
      if (newGen) {
        if (oldSt) states.set(id, oldSt); else states.delete(id);
      }
      throw error;
    }
    st.pending = false;
    if (res !== true) {
      if (newGen) {
        if (oldSt) states.set(id, oldSt); else states.delete(id);
      }
      return res === true;
    }
    if (newGen) {
      if (w.info.sessionId !== idn.session) {
        st.poisoned = true;
        states.set(id, st);
        announced.delete(id);
        return reject();
      }
      st.session = idn.session;
      st.wObj = w;
      st.tok = w.hookToken;
      announced.delete(id);
    }
    states.set(id, st);
    return true;
  }

  Object.defineProperty(manager, INSTALLED, { value: true });
  manager.handleProviderHook = entry;

  return {
    expectFresh(id) {
      const w = getWorker(id);
      if (!w) throw new Error('Pi fresh hook expectation requires a live worker');
      announced.set(id, { kind: 'fresh', wObj: w });
    },
    expectReconnect(id, session) {
      const w = getWorker(id);
      if (!w || typeof session !== 'string' || !session || w.info?.sessionId !== session) throw new Error('Pi reconnect hook expectation requires the saved session');
      announced.set(id, { kind: 'reconnect', session, wObj: w, oldTok: w.hookToken });
    },
  };
}
