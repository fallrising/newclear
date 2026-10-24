import assert from 'node:assert/strict';
import {readFile, writeFile, copyFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {selectNotificationRepair} from './capture-selection.mjs';

export async function sharedCapture({origin, seed, evidence, state, output, start, hash, env, compatibleHashes}) {
  const repairing = process.env.FE_REVIEW_PHASE === 'final-repair';
  const storageFile = join(state, 'capture.storage.json');
  await writeFile(storageFile, JSON.stringify(await seed.a.context.storageState()), {flag: 'wx', mode: 0o600});
  const exactText = text => ':has-text(' + JSON.stringify(text) + ')';
  const targets = {
    project: 'phark', locale: 'en-US', colorSchemes: ['light'],
    viewports: [{name: 'mobile', width: 390, height: 844}, {name: 'tablet', width: 834, height: 1112}, {name: 'desktop', width: 1440, height: 900}],
    apps: [{name: 'web', kind: 'spa', baseUrl: origin, cwd: fileURLToPath(new URL('../frontend/', import.meta.url)), storageState: storageFile,
      pages: [
        {id: 'home', path: '/', waitFor: 'body:has(button:text-is("Sign out")) main' + exactText(seed.texts.second)},
        {id: 'notifications', path: '/notifications', waitFor: 'body:has(button:text-is("Sign out")) main:has(h1:text-is("Notifications"))' + exactText(seed.texts.home)},
        {id: 'search', path: '/search?q=fe-review', waitFor: 'body:has(button:text-is("Sign out")) main:has(h1:text-is("Search"))' + exactText(seed.texts.home)},
        {id: 'profile', path: '/profiles/' + seed.a.handle, waitFor: 'body:has(button:text-is("Sign out")) main:has(h1:text-is(' + JSON.stringify(seed.a.displayName) + '))' + exactText(seed.texts.home)}
      ].map(page => ({...page, timeoutMs: 10000}))
    }]
  };
  if (repairing) targets.apps[0].pages = targets.apps[0].pages.filter(page => page.id === 'notifications');
  const targetsFile = join(state, 'capture.targets.json');
  await writeFile(targetsFile, JSON.stringify(targets), {flag: 'wx', mode: 0o600});
  const script = fileURLToPath(new URL('../../../docs/fe-review/capture.mjs', import.meta.url));
  const directory = join(state, 'shared');
  const child = await start('shared-capture', process.execPath, [script, targetsFile, '--out', directory], {
    ...env, PLAYWRIGHT_MODULE: process.env.PLAYWRIGHT_MODULE,
    AXE_PLAYWRIGHT_MODULE: process.env.AXE_MODULE,
    CHROMIUM_EXECUTABLE: process.env.CHROMIUM_EXECUTABLE,
    PLAYWRIGHT_SKIP_BROWSER_GC: '1'
  });
  await child.ended;
  const raw = await readFile(join(directory, 'capture.json'));
  const manifest = JSON.parse(raw);
  const records = []; const keys = new Set();
  for (const item of manifest.results) {
    const key = item.page + '/' + item.viewport + '/' + item.colorScheme;
    assert(!keys.has(key), 'REVIEW_SHARED_DUPLICATE'); keys.add(key);
    assert(['home', 'notifications', 'search', 'profile'].includes(item.page) && ['mobile', 'tablet', 'desktop'].includes(item.viewport) && item.colorScheme === 'light', 'REVIEW_SHARED_KEY');
    const expectedPNG = 'screenshots/web__' + item.page + '__' + item.viewport + '__light.png';
    assert.equal(item.screenshot, expectedPNG, 'REVIEW_SHARED_SCREENSHOT_PATH');
    const record = {page: item.page, viewport: item.viewport, colorScheme: item.colorScheme, sourceRun: evidence.id, status: item.status, error: Boolean(item.error), horizontalOverflow: item.horizontalOverflow, consoleErrors: item.consoleErrors?.length ?? null, pageErrors: item.pageErrors?.length ?? null, failedRequests: item.failedRequests?.length ?? null, axeViolations: (item.axeViolations ?? []).map(v => ({id: v.id, impact: v.impact, nodes: v.nodes}))};
    if (!item.error) {
      const bytes = await readFile(join(directory, expectedPNG));
      const name = 'shared-' + item.page + '-' + item.viewport + '.png';
      await copyFile(join(directory, expectedPNG), join(output, 'screenshots', name), constants.COPYFILE_EXCL);
      record.screenshot = 'screenshots/' + name; record.sha256 = hash(bytes); record.bytes = bytes.length;
      evidence.captures.push({name: name.slice(0, -4), path: record.screenshot, sha256: record.sha256, bytes: record.bytes, controlled: false, shared: true});
    }
    records.push(record);
  }
  evidence.sharedCapture = {tool: 'docs/fe-review/capture.mjs', toolSHA256: hash(await readFile(script)), rawManifestSHA256: hash(raw), ownedServersAlreadyRunning: true, startFlagUsed: false, storageStatePrivate: true, records};
  assert.equal(child.exit.code, 0, 'REVIEW_SHARED_EXIT');
  assert.equal(keys.size, repairing ? 3 : 12, 'REVIEW_SHARED_COUNT');
  assert(records.every(record => !record.error && record.status === 200), 'REVIEW_SHARED_LOADED');
  assert(records.every(record => !record.horizontalOverflow), 'REVIEW_SHARED_OVERFLOW');
  assert(records.every(record => record.consoleErrors === 0 && record.pageErrors === 0 && record.failedRequests === 0), 'REVIEW_SHARED_HEALTH');
  assert(records.every(record => record.axeViolations.every(v => !['critical', 'serious'].includes(v.impact))), 'REVIEW_SHARED_AXE');
  if (repairing) {
    const previousBytes = await readFile(new URL('./runs/final-001/result.json', import.meta.url));
    assert.equal(hash(previousBytes), '958e68cc089c5572cf25fc629a0e3479700a306116c085f4c621d6b0463fc51e', 'REVIEW_ORIGINAL_CAPTURE_CHANGED');
    const previous = JSON.parse(previousBytes);
    for (const file of Object.keys(previous.sourceHashes).filter(file => file.startsWith('frontend/'))) assert.equal(compatibleHashes[file], previous.sourceHashes[file], 'REVIEW_RETAINED_SOURCE_CHANGED');
    assert.equal(evidence.sharedCapture.toolSHA256, previous.sharedCapture.toolSHA256, 'REVIEW_SHARED_TOOL_CHANGED');
    evidence.sharedCapture.newRecords = records;
    evidence.sharedCapture.records = selectNotificationRepair(previous.sharedCapture.records, records);
    evidence.sharedCapture.selection = {retainedRun: 'final-001', retainedRunSHA256: hash(previousBytes), retained: 9, replacements: 3, unique: 12, sourceDelta: evidence.exactNotificationStyleDelta};
  }
}
