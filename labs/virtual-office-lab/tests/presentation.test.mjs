import test from 'node:test';
import assert from 'node:assert/strict';
import {present, isNight} from '../src/presentation.mjs';
const bot = (id, extra = {}) => ({id, name: id, role: 'public', summary: '固定摘要', seat: 'desk-1', status: 'coding', reportedStatus: 'coding', stale: false, alert: false, collaborators: [], ...extra});
const state = bots => ({schemaVersion: 1, mode: 'live', simulated: false, serverTime: '2026-10-31T15:00:00Z', bots});
test('all eight statuses have text; alert survives stale idle', () => {
  for (const status of ['coding', 'terminal', 'browsing', 'thinking', 'needs-you', 'error', 'idle', 'done']) {
    assert.ok(present(state([bot('a', {status, reportedStatus: status})])).bots[0].label);
  }
  const output = present(state([bot('a', {status: 'idle', reportedStatus: 'error', stale: true, alert: true})]), {nightEnabled: true}).bots[0];
  assert.equal(output.label, '出錯'); assert.equal(output.zone, 'desk');
  assert.deepEqual(output.badges, ['資料過期', '需要注意']); assert.equal(output.movable, false);
});
test('night is opt-in and uses Singapore 22:00–08:00 boundaries', () => {
  for (const [time, expected] of [['13:59', false], ['14:00', true], ['23:59', true], ['00:00', false]]) {
    assert.equal(isNight(`2026-10-31T${time}:00Z`), expected);
  }
  const input = state([bot('a', {status: 'idle', reportedStatus: 'idle'})]);
  assert.equal(present(input).bots[0].zone, 'rest');
  assert.equal(present(input, {nightEnabled: true}).bots[0].zone, 'exit');
  assert.equal(present(state([bot('a')]), {nightEnabled: true}).bots[0].zone, 'desk');
});
test('one-sided collaborators cannot move peers; stable reciprocal pairs fit four seats', () => {
  assert.equal(present(state([bot('a', {collaborators: ['b']}), bot('b')])).bots[0].zone, 'desk');
  const bots = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => bot(id, {collaborators: ['a', 'b', 'c', 'd', 'e', 'f'].filter(peer => peer !== id)}));
  const input = state(bots); const snapshot = structuredClone(input);
  const output = present(input);
  assert.deepEqual(output, present(state([...bots].reverse())));
  assert.equal(output.bots.filter(b => b.zone === 'meeting').length, 4);
  assert.equal(new Set(output.bots.filter(b => b.zone === 'meeting').map(b => JSON.stringify(b.position))).size, 4);
  output.bots[0].position[0] = 999;
  assert.deepEqual(input, snapshot); assert.notEqual(present(input).bots[0].position[0], 999);
});
test('stale, alert, idle, done and disconnected bots do not collaborate', () => {
  for (const extra of [{stale: true}, {alert: true}, {status: 'idle'}, {status: 'done'}]) {
    assert.ok(present(state([bot('a', {collaborators: ['b'], ...extra}), bot('b', {collaborators: ['a']})])).bots.every(b => b.zone !== 'meeting'));
  }
  const output = present(state([bot('a')]), {connected: false, nightEnabled: true});
  assert.equal(output.simulated, false); assert.equal(output.bots[0].movable, false); assert.match(output.banner, /連線中斷/);
  const idle = state([bot('a', {status: 'idle', stale: true})]);
  assert.equal(present(idle, {connected: false, nightEnabled: true}).bots[0].zone, 'desk');
  const demo = present({...idle, mode: 'demo', simulated: true}, {connected: false});
  assert.equal(demo.mode, 'demo'); assert.ok(demo.bots[0].badges.includes('模擬資料'));
  const inconsistent = present(state([bot('a', {status: 'error'})]), {nightEnabled: true}).bots[0];
  assert.equal(inconsistent.alert, true); assert.equal(inconsistent.label, '出錯'); assert.equal(inconsistent.zone, 'desk');
});
test('invalid mode fails closed; unrecognized seats have text-only fallback', () => {
  assert.throws(() => present(state([]), {connected: 'false'}));
  assert.throws(() => present(state([null])));
  assert.throws(() => present({...state([]), mode: 'unknown'}));
  assert.throws(() => present({...state([]), simulated: true}));
  assert.throws(() => present(state([bot('a'), bot('a')])));
  const output = present(state([bot('a', {name: '<img onerror=alert(1)>', seat: '__proto__'})]));
  assert.equal(output.bots[0].position, null);
  assert.equal(output.bots[0].name, '<img onerror=alert(1)>'); // data, not markup; renderer must use textContent
});
