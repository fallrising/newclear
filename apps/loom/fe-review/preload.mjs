/**
 * Self-contained review-only addInitScript, matched to locked API 2.11.0 core/event.
 * This simulates only the existing Web boundary. It never calls native or network.
 */
export function installLoomFixture(options = {}) {
  const host = window;
  if (host.__LOOM_REVIEW__ || host.__TAURI_INTERNALS__ || host.__TAURI_EVENT_PLUGIN_INTERNALS__) throw new Error('FIXTURE_COLLISION');
  if (host.document.readyState !== 'loading' || host.document.querySelector('#root')?.childElementCount) throw new Error('LATE_PRELOAD');
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const fail = (code) => { throw new Error(code); };
  const require = (ok) => { if (!ok) fail('INVALID_ARGUMENT'); };
  const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const exact = (v, allowed) => { require(object(v) && Object.keys(v).every((k) => allowed.includes(k))); };
  const text = (v) => typeof v === 'string' && v.length > 0 && v.length <= 100000;
  const integer = (v) => Number.isInteger(v) && v > 0 && v <= 10000;
  const origin = (v) => { require(object(v) && v.kind === 'user' && Object.keys(v).length === 1); };
  const events = new Set(['pty:io', 'loom:event', 'session:changed', 'ai:event', 'loom:window-close-requested']);
  const sessions = new Map();
  const documents = new Map();
  const openDocuments = new Map();
  const callbacks = new Map();
  const listeners = new Map();
  const subscriptions = new Map();
  const pending = new Set();
  const counts = Object.create(null);
  let disposed = false, nextCallback = 1, nextListener = 10001, nextSession = 1, nextStream = 1, nextHash = 1;
  let unknownCommands = 0, rejectedArguments = 0, detached = 0, closedDocuments = 0;
  let historyMode = options.history ?? 'empty';
  let writeMode = 'normal';
  let canvas = null;
  let closeApproved = 0;
  let exactRunPayloads = 0;
  require(['empty', 'populated', 'loading', 'error', 'memory'].includes(historyMode));
  function path(value) {
    require(text(value));
    const result = value.startsWith('/') ? value : `/fixture/vault/${value}`;
    require(/^\/fixture\/vault\/[a-zA-Z0-9_-]+\.md$/.test(result));
    return result;
  }
  function hash() { return `synthetic-hash-${nextHash++}`; }
  documents.set('/fixture/vault/notes.md', { path: '/fixture/vault/notes.md', content: '# Synthetic notes\n\nReview-only document.\n\n```bash run\nprintf "synthetic output"\n```\n', on_disk_hash: hash() });
  function meta(id, state = { kind: 'active' }) { return { id, cwd: '/fixture/vault', cmd: null, shell: '/bin/synthetic-shell', state, last_activity_ms: 1 }; }
  if (historyMode === 'populated' || historyMode === 'memory') sessions.set('synthetic-history-1', meta('synthetic-history-1', { kind: 'tombstone', reason: 'Synthetic previous session' }));
  function validateCanvas(value) {
    exact(value, ['version', 'nodes', 'edges']);
    require(value.version === 1 && Array.isArray(value.nodes) && Array.isArray(value.edges));
    const ids = new Set();
    for (const node of value.nodes) {
      exact(node, ['id', 'kind', 'x', 'y', 'w', 'h', 'group']);
      require(text(node.id) && !ids.has(node.id)); ids.add(node.id);
      require([node.x, node.y, node.w, node.h].every(Number.isFinite) && node.w > 0 && node.h > 0 && (node.group === null || typeof node.group === 'string'));
      require(object(node.kind));
      if (node.kind.type === 'document') { exact(node.kind, ['type', 'path']); path(node.kind.path); }
      else {
        exact(node.kind, ['type', 'reason', 'was']); require(node.kind.type === 'tombstone' && typeof node.kind.reason === 'string');
        const was = node.kind.was; exact(was, ['type', 'cwd', 'cmd', 'shell', 'name']);
        require(was.type === 'terminal' && was.cwd === '/fixture/vault' && (was.cmd === null || typeof was.cmd === 'string') && text(was.shell) && (was.name == null || typeof was.name === 'string'));
      }
    }
    const edgeIds = new Set();
    for (const edge of value.edges) {
      exact(edge, ['id', 'from', 'to', 'kind']); require(text(edge.id) && !edgeIds.has(edge.id) && ids.has(edge.from) && ids.has(edge.to) && ['triggers', 'feeds_output_to', 'context_for'].includes(edge.kind)); edgeIds.add(edge.id);
    }
    return clone(value);
  }
  if (options.seed) {
    exact(options.seed, ['canvas', 'documents']);
    if (options.seed.canvas !== null) canvas = validateCanvas(options.seed.canvas);
    require(Array.isArray(options.seed.documents)); documents.clear();
    for (const doc of options.seed.documents) { exact(doc, ['path', 'content', 'on_disk_hash']); require(typeof doc.content === 'string' && text(doc.on_disk_hash)); const key = path(doc.path); documents.set(key, clone(doc)); }
    // Hash identities are content-independent synthetic versions, never real-file hashes.
    nextHash = 10000;
  }
  function emit(event, payload) {
    require(events.has(event));
    if (disposed) return;
    for (const [id, listener] of [...listeners]) {
      if (listener.event !== event) continue;
      const callback = callbacks.get(listener.handler);
      if (callback) { if (callback.once) callbacks.delete(listener.handler); callback.fn({ event, id, payload: clone(payload) }); }
    }
  }
  function readHistory() { return { sessions: [...sessions.values()].map(clone), live_session_ids: [...sessions.values()].filter((s) => s.state.kind === 'active').map((s) => s.id), persistent: historyMode !== 'memory', warning: historyMode === 'memory' ? 'Synthetic in-memory history; not durable' : null }; }
  function needSession(args) { require(text(args.sessionId) && sessions.has(args.sessionId)); return sessions.get(args.sessionId); }
  function newSession(args) {
    require(args.cwd === '/fixture/vault' && (args.cmd === null || typeof args.cmd === 'string') && (args.shell === null || text(args.shell)) && (args.cols === null || integer(args.cols)) && (args.rows === null || integer(args.rows)));
    const id = `synthetic-session-${nextSession++}`;
    sessions.set(id, { ...meta(id), cmd: args.cmd, shell: args.shell ?? '/bin/synthetic-shell' }); emit('session:changed', null); return id;
  }
  const commands = {
    vault_root(args) { exact(args, []); return '/fixture/vault'; },
    home_dir(args) { exact(args, []); return '/fixture/vault'; },
    pty_spawn(args) { exact(args, ['origin', 'cwd', 'cmd', 'shell', 'cols', 'rows']); origin(args.origin); return newSession(args); },
    pty_kill(args) { exact(args, ['origin', 'sessionId']); origin(args.origin); const s = needSession(args); s.state = { kind: 'exited', code: 0 }; subscriptions.delete(s.id); emit('loom:event', { kind: 'pty_exited', session_id: s.id, exit_code: 0 }); emit('session:changed', null); },
    pty_resize(args) { exact(args, ['origin', 'sessionId', 'cols', 'rows']); origin(args.origin); needSession(args); require(integer(args.cols) && integer(args.rows)); },
    pty_write_stdin(args) { exact(args, ['origin', 'sessionId', 'data']); origin(args.origin); const s = needSession(args); require(s.state.kind === 'active' && typeof args.data === 'string' && args.data.length <= 100000); if (args.data === 'printf "synthetic output"\r') exactRunPayloads++; const stream = subscriptions.get(s.id); if (stream) emit('pty:io', { stream_id: stream, session_id: s.id, frames: ['Synthetic command output\r\n'], dropped_old: 0 }); },
    pty_subscribe(args) { exact(args, ['sessionId']); const s = needSession(args); if (![...listeners.values()].some((l) => l.event === 'pty:io')) fail('LISTENER_REQUIRED'); const stream = `synthetic-stream-${nextStream++}`; subscriptions.set(s.id, stream); emit('pty:io', { stream_id: stream, session_id: s.id, frames: ['Synthetic terminal ready\r\n'], dropped_old: 0 }); return stream; },
    pty_detach(args) { exact(args, ['sessionId']); needSession(args); subscriptions.delete(args.sessionId); detached++; },
    pty_list_sessions(args) { exact(args, []); return readHistory().live_session_ids; },
    pty_session_meta(args) { exact(args, ['sessionId']); require(text(args.sessionId)); return sessions.has(args.sessionId) ? clone(sessions.get(args.sessionId)) : null; },
    pty_scrollback(args) { exact(args, ['sessionId', 'maxChars']); needSession(args); require(args.maxChars === undefined || integer(args.maxChars)); return 'Synthetic terminal scrollback\n'; },
    session_history(args) { exact(args, []); if (historyMode === 'error') fail('SYNTHETIC_HISTORY_ERROR'); if (historyMode === 'loading') return new Promise((resolve, reject) => pending.add({ resolve, reject })); return readHistory(); },
    session_restart(args) { exact(args, ['origin', 'sessionId', 'cols', 'rows']); origin(args.origin); const s = needSession(args); require(['exited', 'tombstone'].includes(s.state.kind)); return newSession({ cwd: s.cwd, cmd: s.cmd, shell: s.shell, cols: args.cols, rows: args.rows }); },
    session_forget(args) { exact(args, ['origin', 'sessionId']); origin(args.origin); const s = needSession(args); require(['exited', 'tombstone'].includes(s.state.kind)); sessions.delete(s.id); emit('session:changed', null); },
    doc_read(args) { exact(args, ['path']); const key = path(args.path); if (!documents.has(key)) fail('Synthetic document not found'); return clone(documents.get(key)); },
    doc_create(args) { exact(args, ['origin', 'path', 'content']); origin(args.origin); const key = path(args.path); require(typeof args.content === 'string'); if (documents.has(key)) fail('SYNTHETIC_ALREADY_EXISTS'); const doc = { path: key, content: args.content, on_disk_hash: hash() }; documents.set(key, doc); return clone(doc); },
    doc_write(args) { exact(args, ['origin', 'path', 'content', 'expectedHash']); origin(args.origin); const key = path(args.path); require(documents.has(key) && typeof args.content === 'string' && (args.expectedHash === null || text(args.expectedHash))); const doc = documents.get(key); if (writeMode === 'error') fail('SYNTHETIC_SAVE_ERROR'); if (writeMode === 'conflict' || (args.expectedHash !== null && args.expectedHash !== doc.on_disk_hash)) return { kind: 'conflict', current_disk_hash: doc.on_disk_hash }; doc.content = args.content; doc.on_disk_hash = hash(); if (openDocuments.has(key)) openDocuments.set(key, { hash: doc.on_disk_hash, dirty: false }); return { kind: 'written', new_hash: doc.on_disk_hash }; },
    doc_open(args) { exact(args, ['path', 'onDiskHash']); const key = path(args.path); require(documents.has(key) && text(args.onDiskHash)); openDocuments.set(key, { hash: args.onDiskHash, dirty: false }); },
    doc_close(args) { exact(args, ['path']); openDocuments.delete(path(args.path)); closedDocuments++; },
    doc_mark_dirty(args) { exact(args, ['path']); const key = path(args.path); require(openDocuments.has(key)); openDocuments.get(key).dirty = true; },
    doc_mark_clean(args) { exact(args, ['path']); const key = path(args.path); require(openDocuments.has(key)); openDocuments.get(key).dirty = false; },
    doc_check_conflict(args) { exact(args, ['path']); const key = path(args.path); if (!documents.has(key) || !openDocuments.has(key)) return 'unknown'; return !openDocuments.get(key).dirty || openDocuments.get(key).hash === documents.get(key).on_disk_hash ? 'no_conflict' : 'conflict'; },
    canvas_read(args) { exact(args, []); return canvas === null ? null : JSON.stringify(canvas); },
    canvas_write(args) { exact(args, ['content']); require(typeof args.content === 'string'); let value; try { value = JSON.parse(args.content); } catch { fail('INVALID_ARGUMENT'); } canvas = validateCanvas(value); },
    ai_status(args) { exact(args, []); return { provider: 'synthetic', model: 'review-only', key_present: false, key_env: 'SYNTHETIC_NO_KEY', protocol: null, base_url: null, configuration_error: null }; },
    ai_ask(args) { exact(args, ['prompt', 'contextDoc', 'pinnedContext']); require(text(args.prompt) && (args.contextDoc === null || typeof args.contextDoc === 'string') && Array.isArray(args.pinnedContext)); fail('AI_DISABLED'); },
    ai_cancel(args) { exact(args, ['requestId']); require(text(args.requestId)); return false; },
    window_close_approved(args) { exact(args, []); closeApproved++; },
    'plugin:event|listen'(args) { exact(args, ['event', 'target', 'handler']); require(events.has(args.event) && object(args.target) && args.target.kind === 'Any' && Object.keys(args.target).length === 1 && callbacks.has(args.handler)); const id = nextListener++; listeners.set(id, { event: args.event, handler: args.handler }); return id; },
    'plugin:event|unlisten'(args) { exact(args, ['event', 'eventId']); require(events.has(args.event) && Number.isInteger(args.eventId)); const listener = listeners.get(args.eventId); if (listener) { require(listener.event === args.event); callbacks.delete(listener.handler); listeners.delete(args.eventId); } },
  };
  host.__TAURI_INTERNALS__ = {
    async invoke(command, args = {}) {
      if (disposed && command !== 'plugin:event|unlisten') fail('FIXTURE_DISPOSED');
      if (!Object.hasOwn(commands, command)) { unknownCommands++; fail('UNKNOWN_COMMAND'); }
      counts[command] = (counts[command] ?? 0) + 1;
      try { return await commands[command](args); } catch (error) { if (error?.message === 'INVALID_ARGUMENT') rejectedArguments++; throw error; }
    },
    transformCallback(fn, once = false) { if (disposed) fail('FIXTURE_DISPOSED'); require(typeof fn === 'function' && typeof once === 'boolean'); const id = nextCallback++; callbacks.set(id, { fn, once }); return id; },
    unregisterCallback(id) { callbacks.delete(id); },
  };
  host.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener(event, id) { const listener = listeners.get(id); if (listener && listener.event === event) callbacks.delete(listener.handler); },
  };
  host.__LOOM_REVIEW__ = Object.freeze({
    emit,
    setWriteMode(mode) { require(['normal', 'error', 'conflict'].includes(mode)); writeMode = mode; },
    setHistoryMode(mode) { require(['empty', 'populated', 'loading', 'error', 'memory'].includes(mode)); historyMode = mode; if (mode !== 'loading') { for (const p of pending) { if (mode === 'error') p.reject(new Error('SYNTHETIC_HISTORY_ERROR')); else p.resolve(readHistory()); } pending.clear(); } emit('session:changed', null); },
    exportSeed() { return { canvas: canvas === null ? null : clone(canvas), documents: [...documents.values()].map(clone) }; },
    snapshot() { return { synthetic: true, disposed, counts: { ...counts }, unknownCommands, rejectedArguments, listeners: listeners.size, callbacks: callbacks.size, listenerIdsDistinct: [...listeners].every(([id, listener]) => id !== listener.handler), subscriptions: subscriptions.size, sessions: sessions.size, openDocuments: openDocuments.size, dirtyDocuments: [...openDocuments.values()].filter((d) => d.dirty).length, pending: pending.size, detached, closedDocuments, closeApproved, exactRunPayloads }; },
    dispose() { disposed = true; for (const p of pending) p.reject(new Error('FIXTURE_DISPOSED')); pending.clear(); callbacks.clear(); listeners.clear(); subscriptions.clear(); openDocuments.clear(); },
  });
}
