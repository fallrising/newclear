'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const source = path.resolve(__dirname, '..');
function fixture(t, { missingStep = false, malformed = false, otherRun = false, change = () => {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-analyzer-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  fs.mkdirSync(path.join(root, 'public')); fs.mkdirSync(path.join(root, 'logs'));
  fs.copyFileSync(path.join(source, 'analyze-observations.cjs'), path.join(root, 'analyze-observations.cjs'));
  const base = { runId: 'run', sessionId: 'session', receivedAt: '2026-10-23T00:00:00Z' };
  const events = ['tutorial_start', ...Array(5).fill('tutorial_step'), 'tutorial_complete'].map((type, i) => ({ ...base, type, details: { tutorialId: 'tutorial', step: i === 6 ? 5 : i, action: ['start', 'create', 'update', 'complete', 'search', 'delete'][i], taskId: i > 0 && i < 6 ? 'task' : undefined } }));
  if (missingStep) events.splice(2, 1);
  change(events);
  if (otherRun) events.push({ ...events.at(-1), runId: 'other' });
  const rows = { fingerprints: [{ ...base, fingerprintId: 'fingerprint', client: { context: { sampleLabel: 'unit' } } }], events, requests: [] };
  for (const [name, records] of Object.entries(rows)) fs.writeFileSync(path.join(root, 'logs', name + '.jsonl'), records.map(JSON.stringify).join('\n') + '\n' + (malformed && name === 'events' ? '{"secret":"DO_NOT_ECHO_PRIVATE_VALUE"\n' : ''));
  const result = spawnSync(process.execPath, [path.join(root, 'analyze-observations.cjs'), '--log-dir', path.join(root, 'logs'), '--sample', 'unit'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(fs.readFileSync(path.join(root, 'logs', 'analysis.json')));
}
test('complete ordered tutorial is recorded', t => {
  const result = fixture(t, { otherRun: true });
  assert.equal(result.tutorials.length, 1);
  assert.equal(result.tutorials[0].completed, true);
  assert.equal(result.tutorials[0].stepsMatchExpected, true);
});
test('completion event cannot conceal a missing tutorial step', t => {
  const result = fixture(t, { missingStep: true });
  assert.equal(result.tutorials[0].completed, false);
  assert.equal(result.tutorials[0].completionEventRecorded, true);
});
test('malformed JSON diagnostic never echoes source data', t => {
  const result = fixture(t, { malformed: true });
  assert.equal(result.parseErrors.events.length, 1);
  assert.ok(!JSON.stringify(result.parseErrors).includes('DO_NOT_ECHO_PRIVATE_VALUE'));
});

for (const [name, change] of [
  ['wrong task', rows => { rows[3].details.taskId = 'unrelated'; }],
  ['wrong step number', rows => { rows[3].details.step = 2; }],
  ['completion before steps', rows => { rows.unshift(rows.pop()); }],
  ['cancelled tutorial', rows => { rows.push({ ...rows[1], details: { tutorialId: 'tutorial', status: 'cancelled' } }); }],
  ['missing tutorial id', rows => { for (const row of rows) delete row.details.tutorialId; }],
]) test(name + ' cannot count as complete', t => assert.equal(fixture(t, { change }).tutorials[0].completed, false));
