import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API_BASE = process.env.SP_API_URL ?? 'http://127.0.0.1:8788';
const ACTOR = process.env.SP_PERSIST_ACTOR ?? 'owner@example.test';
const PHASE = process.env.SP_PERSIST_PHASE ?? '';
const STATE_FILE = process.env.SP_PERSIST_STATE ?? join(tmpdir(), 'spring-pool-t003-persist.json');

async function api(path, { method = 'GET', body } = {}) {
  const init = { method, headers: { 'X-Spring-Pool-Actor': ACTOR } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json; charset=utf-8';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${API_BASE}${path}`, init);
  const text = await res.text();
  let json = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { res, json, text };
}

async function requireApi() {
  try {
    const res = await fetch(`${API_BASE}/v1/health`);
    if (res.status !== 200) throw new Error(`health -> ${res.status}`);
  } catch (err) {
    throw new Error(`API not reachable at ${API_BASE} (SP_API_URL): ${err.message}. Start the local workerd pair first.`);
  }
}

if (PHASE === 'seed') {
  test('PERSIST seed: create fixture and record body + export for later comparison', async () => {
    await requireApi();
    const run = `t003-persist-${randomUUID().slice(0, 8)}`;
    const body = `#!/bin/bash\necho "${run}"\n`;
    const script = await api('/v1/scripts', {
      method: 'POST',
      body: { title: `${run} script`, description: 'persistence fixture', tags: ['persist'], language: 'bash', body },
    });
    assert.equal(script.res.status, 201, script.text.slice(0, 200));
    const runbook = await api('/v1/runbooks', {
      method: 'POST',
      body: {
        title: `${run} runbook`,
        description: '',
        steps: [{ script_id: script.json.id, script_revision: 1, instruction: 'run persistence fixture' }],
      },
    });
    assert.equal(runbook.res.status, 201, runbook.text.slice(0, 200));
    const exportRes = await fetch(`${API_BASE}/v1/runbooks/${runbook.json.id}/revisions/1/export`, {
      headers: { 'X-Spring-Pool-Actor': ACTOR },
    });
    assert.equal(exportRes.status, 200);
    const state = {
      run,
      scriptId: script.json.id,
      runbookId: runbook.json.id,
      scriptBody: body,
      exportText: await exportRes.text(),
      seededAt: new Date().toISOString(),
    };
    await mkdir(tmpdir(), { recursive: true });
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
    console.log(`Persist fixture seeded: script ${state.scriptId}, runbook ${state.runbookId}; state -> ${STATE_FILE}`);
  });
} else if (PHASE === 'verify') {
  test('PERSIST verify: data and export are byte-identical after the wrangler dev restart', async () => {
    await requireApi();
    let state;
    try {
      state = JSON.parse(await readFile(STATE_FILE, 'utf8'));
    } catch (err) {
      throw new Error(`Cannot read persist state ${STATE_FILE} (override with SP_PERSIST_STATE). Run SP_PERSIST_PHASE=seed first. ${err.message}`);
    }

    const script = await api(`/v1/scripts/${state.scriptId}`);
    assert.equal(script.res.status, 200, `script ${state.scriptId} missing after restart`);
    assert.equal(script.json.body, state.scriptBody, 'script body changed after restart');

    const rev1 = await api(`/v1/scripts/${state.scriptId}/revisions/1`);
    assert.equal(rev1.res.status, 200);
    assert.equal(rev1.json.body, state.scriptBody, 'revision 1 changed after restart');

    const runbook = await api(`/v1/runbooks/${state.runbookId}`);
    assert.equal(runbook.res.status, 200, `runbook ${state.runbookId} missing after restart`);
    assert.equal(runbook.json.steps[0].script_id, state.scriptId);
    assert.equal(runbook.json.steps[0].script_revision, 1);

    const exportRes = await fetch(`${API_BASE}/v1/runbooks/${state.runbookId}/revisions/1/export`, {
      headers: { 'X-Spring-Pool-Actor': ACTOR },
    });
    assert.equal(exportRes.status, 200);
    assert.equal(await exportRes.text(), state.exportText, 'export is not byte-identical after restart');
    console.log(`Persist fixture verified: script ${state.scriptId}, runbook ${state.runbookId}, export byte-identical.`);
  });
} else if (PHASE) {
  test('unknown persistence phase', () => {
    assert.fail(`Unknown SP_PERSIST_PHASE: ${PHASE} (expected 'seed' or 'verify')`);
  });
} else {
  test('persistence restart check is opt-in', (t) => {
    t.skip(
      `Two-phase persistence check skipped by default. Lead procedure: ` +
        `1) SP_PERSIST_PHASE=seed node --test tests/integration/persistence.test.mjs; ` +
        `2) restart wrangler dev on the same .wrangler state; ` +
        `3) SP_PERSIST_PHASE=verify node --test tests/integration/persistence.test.mjs. See .team/reports/T-003.md.`
    );
  });
}
