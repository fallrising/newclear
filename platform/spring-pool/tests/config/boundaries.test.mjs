import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../../', import.meta.url);

async function readText(rel) {
  try {
    return await readFile(new URL(rel, ROOT), 'utf8');
  } catch (err) {
    throw new Error(`Cannot read ${rel} (required by config guards): ${err.message}`);
  }
}

async function readJsonc(rel) {
  const src = await readText(rel);
  const cleaned = src
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (t.startsWith('//')) return '';
      if (t.startsWith('/*') && t.endsWith('*/')) return '';
      return line;
    })
    .join('\n')
    .replace(/,\s*([}\]])/g, '$1');
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Could not parse ${rel} as JSONC (whole-line comments and trailing commas stripped only): ${err.message}`);
  }
}

function parseTomlSections(src) {
  const sections = { __root__: [] };
  let current = '__root__';
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const table = line.match(/^\[\[?[^\]]+\]\]?$/);
    if (table) {
      current = line.replace(/^\[\[?/, '').replace(/\]\]?$/, '').trim();
      if (!sections[current]) sections[current] = [];
      continue;
    }
    const kv = line.match(/^([^=]+)=\s*(.*)$/);
    if (kv) sections[current].push([kv[1].trim(), kv[2].trim()]);
  }
  return sections;
}

function tomlValue(raw) {
  const v = raw.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  return v;
}

function tomlEntries(sections, name) {
  return Object.fromEntries((sections[name] ?? []).map(([k, v]) => [k, tomlValue(v)]));
}

test('T-BOUND-1: API worker is private in every env and binds only D1', async () => {
  const sections = parseTomlSections(await readText('api/wrangler.toml'));

  const root = tomlEntries(sections, '__root__');
  assert.ok(root.main, 'api/wrangler.toml must set main to the built shim');
  assert.equal(root.workers_dev, false, 'API must not expose workers.dev');
  assert.equal(root.preview_urls, false, 'API must not expose preview URLs');
  assert.ok(!('routes' in root) && !('route' in root), 'API must not define routes');

  const staging = tomlEntries(sections, 'env.staging');
  assert.ok(!('routes' in staging) && !('route' in staging), 'staging API must not define routes');
  if ('workers_dev' in staging) assert.equal(staging.workers_dev, false);
  if ('preview_urls' in staging) assert.equal(staging.preview_urls, false);

  assert.equal(tomlEntries(sections, 'd1_databases').binding, 'DB', 'API must bind D1 as DB');
  assert.equal(tomlEntries(sections, 'env.staging.d1_databases').binding, 'DB', 'staging API must bind D1 as DB');
  assert.ok(tomlEntries(sections, 'vars').BUILD_REVISION, 'API should set BUILD_REVISION');

  for (const name of Object.keys(sections)) {
    assert.ok(!/(kv_|r2_|queues|services)/.test(name), `unexpected binding section in api/wrangler.toml: ${name}`);
  }
});

test('T-AUTH-4/T-BOUND-1: web staging is Access-only, previewless, and never binds D1', async () => {
  const web = await readJsonc('web/wrangler.jsonc');

  assert.equal(web.vars?.ENVIRONMENT, 'local', 'local vars must set ENVIRONMENT=local');
  assert.equal(web.vars?.AUTH_MODE, 'local', 'local vars must set AUTH_MODE=local');

  assert.ok(web.env?.staging, 'web/wrangler.jsonc must define env.staging');
  const vars = web.env.staging.vars ?? {};
  assert.equal(vars.ENVIRONMENT, 'staging', 'staging must set ENVIRONMENT=staging');
  assert.equal(vars.AUTH_MODE, 'access', 'staging must set AUTH_MODE=access');
  assert.ok(vars.ACCESS_TEAM_DOMAIN, 'staging requires ACCESS_TEAM_DOMAIN');
  assert.ok(vars.ACCESS_AUD, 'staging requires ACCESS_AUD');
  assert.ok(vars.OWNER_EMAIL, 'staging requires OWNER_EMAIL');
  assert.ok(!('LOCAL_OWNER_EMAIL' in vars), 'staging must never enable local auth');
  assert.ok(!('LOCAL_OWNER_EMAIL' in (web.vars ?? {})), 'LOCAL_OWNER_EMAIL belongs in .dev.vars, not wrangler.jsonc');

  assert.equal(web.env.staging.workers_dev, true, 'staging web is exposed on workers.dev');
  assert.equal(web.env.staging.preview_urls, false, 'staging web must not expose preview URLs');
  assert.ok(!('routes' in web) && !('route' in web), 'web must not define custom routes');
  assert.ok(!('routes' in web.env.staging) && !('route' in web.env.staging), 'web staging must not define custom routes');

  const services = web.services ?? [];
  assert.ok(services.some((s) => s.binding === 'API' && s.service), 'web must bind the API service');
  const stagingServices = web.env.staging.services ?? [];
  assert.ok(stagingServices.some((s) => s.binding === 'API' && s.service), 'web staging must bind the API service');

  assert.ok(!('d1_databases' in web), 'web must not bind D1');
  assert.ok(!('d1_databases' in web.env.staging), 'web staging must not bind D1');
});
