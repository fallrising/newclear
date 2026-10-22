import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { buildPage } from '../scripts/build.mjs';

const scratch = await mkdtemp(join(process.env.AGENT_BUILD_DIR || tmpdir(), 'hw1-test-'));
const upstream = process.env.HANDWIRED_ROOT;

function documentFor(html) {
  const elements = new Map();
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const attrs = match[0];
    const listeners = {};
    elements.set(match[1], { value: attrs.match(/\bvalue="([^"]*)"/)?.[1] || '',
      textContent: '', dataset: {}, attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, fn) { listeners[name] = fn; },
      input(value) { this.value = value; listeners.input(); } });
  }
  return { getElementById(id) { assert.ok(elements.has(id), id); return elements.get(id); } };
}

test('built HTML runs its real inline graph offline and clears stale UI results', async () => {
  const output = join(scratch, 'forward.html');
  await buildPage(output, upstream);
  const html = await readFile(output, 'utf8');
  const license = await readFile(join(upstream, 'LICENSE'), 'utf8');
  assert.ok(html.includes(license));
  assert.match(html, /257856e3b221140acb4cc4460626b850c0bd4ff1/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|\bfetch\s*\(|^import\s/m);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  const document = documentFor(html);
  runInNewContext(scripts[0][1], { document });
  const el = id => document.getElementById(id);
  assert.equal(el('status').dataset.state, 'pass');
  assert.equal(Number(el('reference').textContent), 23);
  assert.equal(Number(el('graph').textContent), 23);
  el('x-number').input('60');
  assert.equal(Number(el('graph').textContent), 73);
  assert.equal(el('x-range').value, '60');
  for (const value of ['', 'NaN', 'Infinity', '61', 'nonsense']) {
    el('x-number').input(value);
    assert.equal(el('status').dataset.state, 'error');
    for (const id of ['reference', 'graph', 'difference', 'tolerance', 'formula-value']) {
      assert.equal(el(id).textContent, '—', id);
    }
    assert.equal(el('x-number').attributes['aria-invalid'], 'true');
  }
  el('x-range').input('-20');
  assert.equal(el('status').dataset.state, 'pass');
  assert.equal(el('x-number').value, '-20');
  assert.equal(Number(el('graph').textContent), -27);
  assert.equal(el('x-number').attributes['aria-invalid'], 'false');
  el('a-number').input('1.333333');
  el('b-number').input('0.1234567');
  assert.equal(el('status').dataset.state, 'pass');
  assert.ok(Math.abs(Number(el('graph').textContent) - (-20 * 1.333333 + 0.1234567)) < 0.0003);
  for (const x of [-20, -10, 0, 10, 20, 30, 40, 50, 60, 12.34567]) {
    for (const a of [0.5, 1.25, 1.333333, 2]) {
      for (const b of [-10, -2, 0.1234567, 10]) {
        el('x-number').input(String(x));
        el('a-number').input(String(a));
        el('b-number').input(String(b));
        const reference = a * x + b;
        const graph = Number(el('graph').textContent);
        assert.equal(Number(el('reference').textContent), reference);
        assert.ok(Number.isFinite(graph));
        assert.ok(Math.abs(graph - reference) <= 1e-5 + 1e-5 * Math.abs(reference));
        assert.equal(el('status').dataset.state, 'pass');
      }
    }
  }
  for (const [key, value, recovery] of [['a', '0.49', '1.25'], ['b', '10.01', '-2']]) {
    el(`${key}-number`).input(value);
    assert.equal(el('status').dataset.state, 'error');
    assert.equal(el(`${key}-number`).attributes['aria-invalid'], 'true');
    for (const id of ['reference', 'graph', 'difference', 'tolerance', 'formula-value']) {
      assert.equal(el(id).textContent, '—');
    }
    el(`${key}-number`).input(recovery);
    assert.equal(el('status').dataset.state, 'pass');
  }
});

test('build refuses absent or modified core/license and never writes a misleading artifact', async () => {
  const fixture = join(scratch, 'upstream');
  await mkdir(join(fixture, 'src/runtime'), { recursive: true });
  const output = join(scratch, 'invalid.html');
  await assert.rejects(buildPage(output, undefined), /HANDWIRED_ROOT/);
  await assert.rejects(buildPage(output, fixture), /ENOENT/);
  const core = 'src/runtime/numeric-ui-core.ts';
  await copyFile(join(upstream, core), join(fixture, core));
  await assert.rejects(buildPage(output, fixture), /ENOENT/);
  await writeFile(join(fixture, 'LICENSE'), 'MIT License, but not the original');
  await assert.rejects(buildPage(output, fixture), /license.*SHA-256/i);
  await copyFile(join(upstream, 'LICENSE'), join(fixture, 'LICENSE'));
  await writeFile(join(fixture, core), '// drift');
  await assert.rejects(buildPage(output, fixture), /core.*SHA-256/i);
  await assert.rejects(readFile(output), /ENOENT/);
});

test('build requires an explicit absolute HTML output outside the repository', async () => {
  for (const output of [undefined, 'forward.html', resolve('labs/handwired-learning/generated.html'), join(scratch, 'page.js')]) {
    await assert.rejects(buildPage(output, upstream), /output/i);
  }
});
