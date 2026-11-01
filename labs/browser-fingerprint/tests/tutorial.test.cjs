'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
// Exercise the shipped listener with a deterministic timer, without a browser mock
// standing in for acceptance. The real-browser harness covers the same scenario.
const searchCode = script.slice(script.indexOf("$('#search').addEventListener('input'"), script.indexOf('\nfunction selectProject'));
async function search(filter, project, query) {
  const task = { id: 'task', title: 'find me', project: '開發', completed: true };
  let listener, timer, advanced = false;
  const context = { state: { tasks: [task], filter, project, query: '', loaded: true }, tutorial: { id: 'tutorial', taskId: 'task' }, searchTimer: null,
    $: () => ({ addEventListener: (_, callback) => { listener = callback; } }), render() {}, clearTimeout() {},
    setTimeout: callback => { timer = callback; }, record: async () => true, advanceTutorial: async () => { advanced = true; } };
  vm.runInNewContext(searchCode, context);
  listener({ target: { value: query } }); await timer(); return advanced;
}
test('matching completed task is not found under pending filter', async () => assert.equal(await search('pending', 'all', 'find'), false));
test('matching task is not found under another project', async () => assert.equal(await search('all', '設計', 'find'), false));
test('visible matching task advances search', async () => assert.equal(await search('completed', '開發', 'find'), true));
test('short query does not advance', async () => assert.equal(await search('all', 'all', 'f'), false));
