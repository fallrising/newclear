import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { installLoomFixture } from './preload.mjs';
function fresh(options = {}) {
  globalThis.window = { document: { readyState: 'loading', querySelector: () => null } };
  installLoomFixture(options);
  return window.__LOOM_REVIEW__;
}
const user = { kind: 'user' };
const spawn = () => invoke('pty_spawn', { origin: user, cwd: '/fixture/vault', cmd: null, shell: null, cols: 80, rows: 24 });

test('locked SDK invoke + listen callback delivers synchronous replay only after registration', async () => {
  const fixture = fresh(); const id = await spawn(); const events = [];
  await assert.rejects(invoke('pty_subscribe', { sessionId: id }), /LISTENER_REQUIRED/);
  const off = await listen('pty:io', (e) => events.push(e));
  const stream = await invoke('pty_subscribe', { sessionId: id });
  assert.equal(events.length, 1); assert.equal(events[0].payload.session_id, id); assert.equal(events[0].payload.stream_id, stream);
  assert.deepEqual(events[0].payload.frames, ['Synthetic terminal ready\r\n']);
  await off(); await invoke('pty_detach', { sessionId: id });
  fixture.emit('pty:io', { session_id: id, stream_id: stream, frames: ['stale'], dropped_old: 0 });
  assert.equal(events.length, 1); assert.equal(fixture.snapshot().listeners, 0); assert.equal(fixture.snapshot().callbacks, 0);
  assert.equal(fixture.snapshot().subscriptions, 0);
});
test('listener id is distinct from callback id; SDK unlisten releases both and late unlisten is safe', async () => {
  const f = fresh(); let called = 0; const off = await listen('session:changed', () => called++);
  f.emit('session:changed', null); assert.equal(called, 1);
  assert.equal(f.snapshot().listenerIdsDistinct, true);
  f.dispose(); await off(); f.emit('session:changed', null);
  assert.equal(called, 1); assert.equal(f.snapshot().listeners, 0); assert.equal(f.snapshot().callbacks, 0);
});
test('unknown invoke/invalid Origin/unsafe path do not mutate state or expose request values', async () => {
  const f = fresh();
  await assert.rejects(invoke('CANARY_UNKNOWN', { secret: 'CANARY_SECRET' }), /UNKNOWN_COMMAND/);
  await assert.rejects(invoke('pty_spawn', { origin: { kind: 'plugin' }, cwd: '/fixture/vault' }), /INVALID_ARGUMENT/);
  await assert.rejects(invoke('doc_read', { path: '/outside/CANARY' }), /INVALID_ARGUMENT/);
  assert.equal(f.snapshot().sessions, 0); assert.equal(JSON.stringify(f.snapshot()).includes('CANARY'), false);
});
test('runtime document DTO validates expectedHash; conflict/error do not write; doc close releases state', async () => {
  const f = fresh(); const doc = await invoke('doc_read', { path: 'notes.md' });
  await invoke('doc_open', { path: doc.path, onDiskHash: doc.on_disk_hash });
  await invoke('doc_mark_dirty', { path: doc.path });
  const conflict = await invoke('doc_write', { origin: user, path: doc.path, content: 'changed', expectedHash: 'wrong' });
  assert.equal(conflict.kind, 'conflict'); assert.equal((await invoke('doc_read', { path: doc.path })).content, doc.content);
  f.setWriteMode('error');
  await assert.rejects(invoke('doc_write', { origin: user, path: doc.path, content: 'changed', expectedHash: doc.on_disk_hash }), /SYNTHETIC_SAVE_ERROR/);
  f.setWriteMode('normal'); const saved = await invoke('doc_write', { origin: user, path: doc.path, content: 'changed', expectedHash: doc.on_disk_hash });
  assert.equal(saved.kind, 'written'); assert.equal((await invoke('doc_read', { path: doc.path })).on_disk_hash, saved.new_hash);
  await invoke('doc_close', { path: doc.path }); assert.equal(f.snapshot().openDocuments, 0);
});
test('history reads never restart or write stdin; restart and forget are explicit; reset is isolated', async () => {
  const f = fresh({ history: 'populated' }); const history = await invoke('session_history');
  assert.equal(history.sessions.length, 1); assert.equal(history.live_session_ids.length, 0);
  assert.equal(f.snapshot().counts.session_restart ?? 0, 0); assert.equal(f.snapshot().counts.pty_write_stdin ?? 0, 0);
  const id = await invoke('session_restart', { origin: user, sessionId: history.sessions[0].id, cols: 120, rows: 30 });
  assert.notEqual(id, history.sessions[0].id);
  await invoke('session_forget', { origin: user, sessionId: history.sessions[0].id });
  assert.equal((await invoke('session_history')).sessions.length, 1);
  f.dispose(); const next = fresh(); assert.equal(next.snapshot().sessions, 0); assert.equal(await invoke('canvas_read'), null);
});
test('sidecar is exact JSON string boundary and explicit export/reseed is separate from reset', async () => {
  const f = fresh(); const value = { version: 1, nodes: [], edges: [] };
  await invoke('canvas_write', { content: JSON.stringify(value) });
  assert.deepEqual(JSON.parse(await invoke('canvas_read')), value);
  const seed = f.exportSeed(); f.dispose(); fresh({ seed }); assert.deepEqual(JSON.parse(await invoke('canvas_read')), value);
  await assert.rejects(invoke('canvas_write', { content: '{"version":2,"nodes":[],"edges":[]}' }), /INVALID_ARGUMENT/);
});
test('no-key AI cannot issue a request; disposal settles pending history and forbids native fallback', async () => {
  const f = fresh({ history: 'loading' }); const pending = invoke('session_history');
  assert.equal((await invoke('ai_status')).key_present, false);
  await assert.rejects(invoke('ai_ask', { prompt: 'synthetic', contextDoc: null, pinnedContext: [] }), /AI_DISABLED/);
  f.dispose(); await assert.rejects(pending, /FIXTURE_DISPOSED/);
  await assert.rejects(invoke('vault_root'), /FIXTURE_DISPOSED/);
  assert.equal(f.snapshot().pending, 0);
});

test('native-compatible document acknowledgement clears dirty state and missing read is recognizable', async () => {
  const f = fresh(); const doc = await invoke('doc_read', { path: 'notes.md' });
  await invoke('doc_open', { path: doc.path, onDiskHash: doc.on_disk_hash });
  await invoke('doc_mark_dirty', { path: doc.path });
  await invoke('doc_write', { origin: user, path: doc.path, content: 'saved', expectedHash: doc.on_disk_hash });
  assert.equal(f.snapshot().dirtyDocuments, 0);
  await invoke('doc_mark_dirty', { path: doc.path });
  assert.equal(await invoke('doc_check_conflict', { path: doc.path }), 'no_conflict');
  await assert.rejects(invoke('doc_read', { path: 'missing.md' }), /not found/i);
  const created = await invoke('doc_create', { origin: user, path: 'missing.md', content: 'synthetic new document' });
  assert.equal(created.path, '/fixture/vault/missing.md');
  await assert.rejects(invoke('doc_create', { origin: user, path: 'missing.md', content: 'must not replace' }), /SYNTHETIC_ALREADY_EXISTS/);
  assert.equal((await invoke('doc_read', { path: 'missing.md' })).content, 'synthetic new document');
});
