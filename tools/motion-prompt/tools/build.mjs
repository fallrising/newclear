#!/usr/bin/env node
// Motion Prompt build: packs/*/{meta.json,source.js}  ->  api/v1/**  +  assets/catalog.js  +  packs/**/README*.md
// Node 18+, no dependencies. Doubles as the validator: any problem is listed and the exit code is 1.
//
//   node tools/build.mjs                 build the repo
//   node tools/build.mjs --check         validate source and reject stale outputs, write nothing
//   node tools/build.mjs --root <dir>    use <dir>/packs and write into <dir> (used for scratch builds)
//   node tools/build.mjs --partial       allow missing packs in the order sequence (IDs then differ; dev only)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SITE = './';
const REPO = 'https://github.com/showheyohtaki/motion-prompt';
const LICENCE = 'MIT License (c) 2026 Shohei Ohtaki';
const VERSION = 1;
const LANGS = ['zh-Hant', 'en'];   // languages of the gallery, the API folders and the copyable prompt
const BASE_LANG = 'en';       // every text field needs this one; both supported languages are required; ja is preserved as source

const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const ROOT = path.resolve(opt('--root') || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const CHECK_ONLY = flag('--check');
const PARTIAL = flag('--partial');

const errors = [];
const warns = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warns.push(`${where}: ${msg}`);
const pad3 = n => String(n).padStart(3, '0');
const isStr = v => typeof v === 'string' && v.trim() !== '';

// ---------------------------------------------------------------- prompt template
// This function is also written into assets/catalog.js (as source text), so the site's
// "copy prompt" button and api/v1/<lang>/p/<id>.txt can never drift apart. Keep it self-contained.
function mpPrompt(el, packTitle, lang, base = './') {
  if (!['zh-Hant', 'en'].includes(lang)) throw new Error('Unsupported language: ' + lang);
  const en = lang === 'en';
  const name = en ? el.name.en : el.name[lang] + '（' + el.name.en + '）';
  return [en ? 'Please use "' + name + '" from "' + packTitle + '".' : '請使用「' + name + '」，分類為「' + packTitle + '」。',
    'Motion Prompt #' + el.id + ' · ' + el.pack + '/' + el.slug, '',
    (en ? 'Meaning: ' : '意思：') + el.meaning[lang],
    (en ? 'Example request (adapt to your project): ' : '向 AI 描述的例句（可依專案調整）：') + el.ask[lang],
    (en ? 'What this demo shows: ' : '此示範的內容：') + el.summary[lang],
    en ? 'Demo specification (independent of the example request):' : '示範規格（與提問例句分開）：',
    ...el.spec[lang].map(s => '- ' + s),
    (en ? 'When to use it: ' : '使用情境：') + el.use[lang], '',
    (en ? 'Local demo: ' : '本地示範：') + base + '?lang=' + lang + '#' + el.id,
    (en ? 'Local specification and code: ' : '本地規格與程式碼：') + base + 'api/v1/' + lang + '/e/' + el.id + '.txt',
    (en ? 'Local helper code: ' : '本地輔助程式碼：') + base + 'api/v1/kit/' + lang + '/' + el.pack + '.js',
    en ? 'Keep the demo geometry, timing and easing unless I explicitly request changes. Adapt text, colours and assets to my project.' : '除非我明確要求調整，請保留示範的幾何形狀、時間與緩動；文字、色彩與素材則依我的專案更換。',
    en ? 'Upstream source: https://github.com/showheyohtaki/motion-prompt (MIT, Shohei Ohtaki).' : '上游來源：https://github.com/showheyohtaki/motion-prompt（MIT，Shohei Ohtaki）。'
  ].join('\n');
}

// ---------------------------------------------------------------- pack.js: cut on markers
const MARK = /^ {2}\/\/ @(kit|shared|end|element (\d{2}))$/;
const LOOSE = /^\s*\/\/\s*@(kit|shared|end|element)\b/;

function dedent(lines) {
  const out = lines.map(l => (l.startsWith('  ') ? l.slice(2) : l.trimStart() === '' ? '' : l));
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  while (out.length && out[0].trim() === '') out.shift();
  return out.join('\n');
}

function cutPack(src, where) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let cur = null;
  let ended = false;
  lines.forEach((line, i) => {
    const m = MARK.exec(line);
    if (!m) {
      if (LOOSE.test(line)) err(where, `line ${i + 1}: marker is not exactly "  // @kit | @element NN | @shared | @end" -> ${JSON.stringify(line)}`);
      if (cur) cur.lines.push(line);
      return;
    }
    if (ended) err(where, `line ${i + 1}: marker after @end`);
    cur = null;
    if (m[1] === 'end') { ended = true; return; }
    cur = { type: m[2] ? 'element' : m[1], no: m[2] || null, line: i + 1, lines: [line] };
    blocks.push(cur);
  });
  if (!ended) err(where, 'no "  // @end" marker');
  const kits = blocks.filter(b => b.type === 'kit');
  if (kits.length !== 1) err(where, `expected exactly one @kit block, found ${kits.length}`);
  else if (blocks[0].type !== 'kit') err(where, '@kit must be the first block');
  const elements = blocks.filter(b => b.type === 'element');
  elements.forEach((b, i) => {
    const want = String(i + 1).padStart(2, '0');
    if (b.no !== want) err(where, `line ${b.line}: found "@element ${b.no}" where "@element ${want}" was expected (numbers must run 01..N in order)`);
    if (!b.lines.slice(1).some(l => l.trim() !== '')) err(where, `@element ${b.no} is empty`);
  });
  const kitText = blocks.filter(b => b.type !== 'element').map(b => dedent(b.lines)).join('\n\n');
  return { elements: elements.map(b => ({ no: b.no, code: dedent(b.lines) })), kitText };
}

// ---------------------------------------------------------------- pack.js: read width/height/cycle/fonts
// pack.js is browser code. Run its factory against inert stand-ins for the DOM, only to read the
// returned { width, height, cycle, cells, fonts }. Nothing is drawn here (tools/check.mjs does that).
function inert() {
  const target = function () {};
  const p = new Proxy(target, {
    get(_, key) {
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      return p;
    },
    set() { return true; },
    apply() { return p; },
    construct() { return p; },
  });
  return p;
}

function evalPack(src, file, where) {
  let got = null;
  const any = inert();
  const sandbox = {
    MotionPrompt: { packs: {}, pack(id, factory) { const r = factory(); got = { id, r }; return r; }, loadFonts: async () => {} },
    document: { createElement: () => any, fonts: any, baseURI: SITE, documentElement: any, body: any },
    Image: any, Path2D: any, OffscreenCanvas: any, FontFace: any, DOMMatrix: any, ImageData: any,
    performance: { now: () => 0 }, devicePixelRatio: 1, location: { search: '', href: SITE, hash: '' },
    console: { log() {}, warn() {}, error() {}, info() {} },
    requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout() {},
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  try {
    vm.runInNewContext(src, sandbox, { filename: file, timeout: 8000 });
  } catch (e) {
    err(where, `pack.js could not be evaluated outside a browser (${e && e.message}). Top-level kit code must not depend on real canvas results.`);
    return null;
  }
  if (!got) { err(where, 'pack.js never called MotionPrompt.pack(id, factory)'); return null; }
  return got;
}

// ---------------------------------------------------------------- meta.json validation
// A text field is an object keyed by language code: { en: "...", ja: "...", es: "..." }.
// Both runtime languages are required; any preserved source language must not be empty.
function bi(obj, where, key) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { err(where, `${key} is missing (needs at least { ${BASE_LANG}: "..." })`); return; }
  for (const lang of LANGS) if (!isStr(obj[lang])) err(where, `${key}.${lang} is missing or empty`);
  for (const l of Object.keys(obj)) if (!isStr(obj[l])) err(where, `${key}.${l} is empty`);
}
const LANG_CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
// Languages a pack is written in = the keys of its title. Only the two supported runtime languages are generated.
function packLangs() { return LANGS; }

function validateMeta(meta, where) {
  if (!isStr(meta.pack)) err(where, 'pack is missing');
  if (!Number.isInteger(meta.order) || meta.order < 1) err(where, 'order must be a positive integer');
  bi(meta.title, where, 'title');
  for (const l of packLangs(meta)) if (!LANG_CODE.test(l)) err(where, `title has a key "${l}" that is not a language code (use codes such as en, ja, es, zh-Hans)`);
  if (!Array.isArray(meta.categories) || !meta.categories.length) err(where, 'categories is missing or empty');
  const slugs = new Set();
  for (const c of meta.categories || []) {
    if (!isStr(c.slug)) err(where, 'a category has no slug');
    else if (slugs.has(c.slug)) err(where, `category slug "${c.slug}" is used twice`);
    slugs.add(c.slug);
    for (const lang of LANGS) if (!isStr(c[lang])) err(where, `category ${c.slug}: ${lang} is missing`);
  }
  if (!Array.isArray(meta.elements) || !meta.elements.length) { err(where, 'elements is missing or empty'); return; }
  const seen = new Set();
  meta.elements.forEach((e, i) => {
    const want = String(i + 1).padStart(2, '0');
    const w = `${where} element ${e && e.no ? e.no : `[${i}]`}`;
    if (!e || typeof e !== 'object') { err(w, 'not an object'); return; }
    if (e.no !== want) err(w, `no should be "${want}" (elements must be listed 01..N in order)`);
    if (!isStr(e.slug)) err(w, 'slug is missing');
    else {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.slug)) err(w, `slug "${e.slug}" must be lowercase kebab-case`);
      if (seen.has(e.slug)) err(w, `slug "${e.slug}" is used twice in this pack`);
      seen.add(e.slug);
    }
    if (!isStr(e.category)) err(w, 'category is missing');
    else if (!slugs.has(e.category)) err(w, `category "${e.category}" is not in categories`);
    bi(e.name, w, 'name');
    bi(e.meaning, w, 'meaning');
    if (e.ask == null) err(w, 'ask is missing');
    else bi(e.ask, w, 'ask');
    bi(e.summary, w, 'summary');
    bi(e.use, w, 'use');
    if (!e.spec || typeof e.spec !== 'object' || Array.isArray(e.spec)) err(w, `spec is missing (needs at least { ${BASE_LANG}: [] })`);
    else {
      for (const lang of LANGS) if (!Array.isArray(e.spec[lang])) err(w, `spec.${lang} is missing`);
      for (const l of Object.keys(e.spec)) {
        const s = e.spec[l];
        if (!Array.isArray(s) || !s.length) err(w, `spec.${l} is missing or empty`);
        else {
          if (s.some(x => !isStr(x))) err(w, `spec.${l} has an empty line`);
          if (s.length < 3 || s.length > 6) warn(w, `spec.${l} has ${s.length} lines (contract: 3-6)`);
          if (Array.isArray(e.spec[BASE_LANG]) && s.length !== e.spec[BASE_LANG].length) err(w, `spec.${l} has ${s.length} lines but spec.${BASE_LANG} has ${e.spec[BASE_LANG].length}`);
        }
      }
    }
    if (!Array.isArray(e.tags) || !e.tags.length) err(w, 'tags is missing or empty');
    else {
      if (e.tags.some(t => !isStr(t))) err(w, 'tags has an empty entry');
      else if (e.tags.some(t => t !== t.toLowerCase() || /[\t\n,]/.test(t))) err(w, 'tags must be lowercase, without commas or tabs');
      if (e.tags.length < 4 || e.tags.length > 8) warn(w, `${e.tags.length} tags (contract: 4-8)`);
    }
  });
}

// Original drawing sources stay byte-identical. Only approved text literals and system fonts
// are transformed; each language gets its own factory, including cached offscreen canvases.
const canvasLabels = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales/canvas.json'), 'utf8'));
const uiLocale = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales/ui.json'), 'utf8'));
for (const lang of LANGS) for (const key of Object.keys(uiLocale.en))
  if (!isStr(uiLocale[lang]?.[key])) err('locales/ui.json', `${lang}.${key} missing`);
function localizeSource(src, pack, lang) {
  const labels = canvasLabels[pack];
  for (const [from, to] of Object.entries(labels)) {
    if (to.length !== 2 || to.some(x => !x || (Array.isArray(x) && !x.length))) err(pack, 'incomplete canvas label ' + from);
    const val = to[lang === 'en' ? 1 : 0];
    src = src.split("'" + from + "'").join(JSON.stringify(val));
  }
  // Source comments remain in source.js; generated standalone code has no Japanese prose.
  src = src.split('\n').map(line => {
    const i = line.indexOf('//');
    return (i >= 0 && /[\u3040-\u30ff\u3400-\u9fff]/.test(line.slice(i)) ? line.slice(0, i) : line).trimEnd();
  }).join('\n');
  src = src.replace(/const JP = [^;]+;/g, `const JP = 'system-ui, "PingFang TC", "Microsoft JhengHei", sans-serif';`);
  return src;
}
function cleanEnglish(value, pack) {
  if (typeof value !== 'string') return value;
  for (const [from, to] of Object.entries(canvasLabels[pack]).sort((a,b) => b[0].length-a[0].length))
    if (/[\u3040-\u30ff\u3400-\u9fff]/.test(from)) value = value.split(from).join(Array.isArray(to[1]) ? to[1].join('') : to[1]);
  return value.replace(/ \(in Japanese\)/g, '').replace(/in Japanese/g, 'in the selected language').trimEnd();
}

// ---------------------------------------------------------------- read packs
const packsDir = path.join(ROOT, 'packs');
const dirs = fs.existsSync(packsDir)
  ? fs.readdirSync(packsDir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name).sort()
  : [];
const packs = [];
for (const dir of dirs) {
  const where = `packs/${dir}`;
  const metaFile = path.join(packsDir, dir, 'meta.json');
  const packFile = path.join(packsDir, dir, 'source.js');
  const hasMeta = fs.existsSync(metaFile), hasPack = fs.existsSync(packFile);
  if (!hasMeta && !hasPack) continue; // an empty folder: someone has only just started
  if (!hasMeta || !hasPack) {
    const msg = `${hasMeta ? 'pack.js' : 'meta.json'} is missing`;
    if (PARTIAL) warn(where, msg + ' — pack skipped (--partial)'); else err(where, msg);
    continue;
  }
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (e) { err(`${where}/meta.json`, `invalid JSON (${e.message})`); continue; }
  const before = errors.length;
  validateMeta(meta, `${where}/meta.json`);
  const langs = packLangs(meta);
  const raw = JSON.parse(JSON.stringify(meta)); // as written; the pack READMEs are made from this

  if (meta.pack !== dir) err(`${where}/meta.json`, `pack is "${meta.pack}" but the folder is "${dir}"`);
  const original = fs.readFileSync(packFile, 'utf8');
  const sources = Object.fromEntries(LANGS.map(lang => [lang, localizeSource(original, dir, lang)]));
  const src = sources['zh-Hant'];
  const cuts = Object.fromEntries(LANGS.map(lang => [lang, cutPack(sources[lang], `${where}/${lang}`)]));
  for (const e of meta.elements) {
    for (const key of ['meaning', 'ask', 'summary', 'use']) e[key].en = cleanEnglish(e[key].en, dir);
    e.spec.en = e.spec.en.map(x => cleanEnglish(x, dir));
  }
  const cut = cutPack(src, `${where}/pack.js`);
  const got = evalPack(src, packFile, `${where}/pack.js`);
  if (!src.split('\n')[0].includes('MIT License')) warn(`${where}/pack.js`, 'first line is not the licence header from the contract');
  const nMeta = Array.isArray(meta.elements) ? meta.elements.length : 0;
  if (cut.elements.length !== nMeta) err(where, `pack.js has ${cut.elements.length} @element blocks but meta.json lists ${nMeta} elements`);
  let info = null;
  if (got) {
    const r = got.r || {};
    if (got.id !== dir) err(`${where}/pack.js`, `MotionPrompt.pack('${got.id}', …) does not match the folder name`);
    for (const k of ['width', 'height', 'cycle']) if (!(typeof r[k] === 'number' && r[k] > 0)) err(`${where}/pack.js`, `factory result has no positive number "${k}"`);
    if (!Array.isArray(r.cells)) err(`${where}/pack.js`, 'factory result has no cells array');
    else {
      if (r.cells.length !== nMeta) err(where, `cells has ${r.cells.length} entries but meta.json lists ${nMeta} elements`);
      for (let i = 0; i < r.cells.length; i++) if (typeof r.cells[i] !== 'function') err(`${where}/pack.js`, `cells[${i}] is not a function`);
    }
    const fonts = Array.isArray(r.fonts) ? r.fonts.map(f => ({ family: String(f.family), url: String(f.url) })) : [];
    for (const f of fonts) if (!fs.existsSync(path.join(packsDir, dir, f.url))) err(`${where}/pack.js`, `font file "${f.url}" is declared but not in the pack folder`);
    info = { width: r.width, height: r.height, cycle: r.cycle, fonts };
  }
  if (errors.length === before && info) packs.push({ dir, meta, raw, cut, info, src, langs, sources, cuts });
}

packs.sort((a, b) => a.meta.order - b.meta.order);
for (let i = 1; i < packs.length; i++) if (packs[i].meta.order === packs[i - 1].meta.order)
  err('packs', `"${packs[i].dir}" and "${packs[i - 1].dir}" share order ${packs[i].meta.order}`);
if (!dirs.length || (!packs.length && !errors.length)) err('packs', `no packs found in ${packsDir}`);
packs.forEach((p, i) => {
  if (p.meta.order !== i + 1) {
    const msg = `order ${i + 1} is missing before "${p.dir}" (order ${p.meta.order}); global IDs would shift`;
    if (PARTIAL) warn('packs', msg + ' — allowed by --partial'); else err('packs', msg);
  }
});

// ---------------------------------------------------------------- assemble
// Scaling the 2D context is only safe when the code never addresses device pixels directly.
const PIXEL_BOUND = /\b(setTransform|resetTransform|getTransform|getImageData|putImageData|createImageData)\b|\.canvas\b/;

// The catalog version changes whenever pack source or locale data changes.
const contentHash = crypto.createHash('sha256');
for (const d of fs.readdirSync(path.join(ROOT, 'packs')).sort()) {
  for (const f of ['source.js', 'meta.json']) {
    const fp = path.join(ROOT, 'packs', d, f);
    if (fs.existsSync(fp)) contentHash.update(d + '/' + f + '\0').update(fs.readFileSync(fp));
  }
}
contentHash.update(JSON.stringify(canvasLabels)).update(JSON.stringify(uiLocale));
const catalog = { version: `${VERSION}.${contentHash.digest('hex').slice(0, 10)}`, site: SITE, repo: REPO, count: 0, packs: [], elements: [] };
const codeById = {};
let n = 0;
for (const p of packs) {
  const { meta, info, cut } = p;
  const first = n + 1;
  meta.elements.forEach((e, i) => {
    n += 1;
    const id = pad3(n);
    catalog.elements.push({
      id, pack: meta.pack, no: e.no, slug: e.slug, category: e.category,
      width: info.width, height: info.height, cycle: info.cycle,
      name: e.name, meaning: e.meaning, ...(e.ask ? { ask: e.ask } : {}), summary: e.summary, spec: e.spec, use: e.use, tags: e.tags,
    });
    for (const lang of LANGS) codeById[lang + '/' + id] = p.cuts[lang].elements[i].code;
  });
  catalog.packs.push({
    pack: meta.pack, order: meta.order, title: meta.title, langs: p.langs, categories: meta.categories,
    count: meta.elements.length, first: pad3(first), last: pad3(n),
    width: info.width, height: info.height, cycle: info.cycle, fonts: info.fonts,
    scalable: !PIXEL_BOUND.test(p.src),
  });
}
catalog.count = n;
const packOf = Object.fromEntries(catalog.packs.map(p => [p.pack, p]));
const kitOf = Object.fromEntries(packs.flatMap(p => LANGS.map(lang => [lang + '/' + p.dir, p.cuts[lang].kitText])));

// ---------------------------------------------------------------- text renderers
const T = {
  'zh-Hant': { what: '示範內容', spec: '動作／視覺規格', use: '使用情境', size: '尺寸', cycle: '週期', needs: '需要', demo: '本地示範', pack: '分類組', cat: '分類', tags: '關鍵字',
    sig: 'cells[i](k, w, h, u)：k = CanvasRenderingContext2D，呼叫端先清除畫布並以 save/restore 包覆；w、h 為尺寸，u 為 [0, cycle) 內的秒數。畫面只取決於 u。',
    code: '下方是元素程式碼；CELLS、常數與輔助函式位於 kit。' },
  en: { what: 'What happens', spec: 'Motion spec', use: 'When to use it', size: 'Size', cycle: 'Cycle', needs: 'Needs', demo: 'Live demo', pack: 'Pack', cat: 'Category', tags: 'Tags',
    sig: 'cells[i](k, w, h, u): k = CanvasRenderingContext2D (already cleared and wrapped in save/restore by the caller), w,h = size, u = seconds in [0, cycle). The picture depends only on u.',
    code: 'Element code starts here. CELLS, constants and helpers live in the kit.' },
};

function elementTxt(el, lang) {
  const t = T[lang], p = packOf[el.pack];
  const cat = p.categories.find(c => c.slug === el.category);
  const name = lang === 'en' ? el.name.en : `${el.name[lang]}（${el.name.en}）`;
  const head = [
    `Motion Prompt #${el.id} · ${LICENCE} · ${SITE}#${el.id}`,
    '',
    name,
    `${t.pack}: ${el.pack} (${p.title[lang]}) · element ${el.no} · ${t.cat}: ${cat ? cat[lang] : el.category}`,
    `${t.what}: ${el.summary[lang]}`,
    `${t.spec}:`,
    ...el.spec[lang].map(s => `  - ${s}`),
    `${t.use}: ${el.use[lang]}`,
    `${t.tags}: ${el.tags.join(', ')}`,
    `${t.size}: ${el.width}x${el.height} px · ${t.cycle}: ${el.cycle} s`,
    `${t.needs}: kit ${el.pack} -> ${SITE}api/v1/kit/${lang}/${el.pack}.js`,
    `${t.demo}: ${SITE}?lang=${lang}#${el.id}`,
    '',
    t.sig,
    t.code,
  ].map(l => (l ? `// ${l}` : '//'));
  return head.join('\n') + '\n\n' + codeById[lang + '/' + el.id] + '\n';
}

function kitJs(p, lang) {
  const range = p.first === p.last ? `#${p.first}` : `#${p.first}-${p.last}`;
  const W = p.width, H = p.height, C = p.cycle;
  const head = [
    `Motion Prompt ${range} · ${LICENCE} · ${SITE}#${p.first}`,
    '',
    `Kit for pack "${p.pack}" (${p.title[lang]}): the constants and helpers its elements share.`,
    `Elements ${range} · ${W}x${H} px · cycle ${C} s. Element code: ${SITE}api/v1/${lang}/e/<id>.txt.`,
    ...(p.fonts.length ? [`Fonts used: ${p.fonts.map(f => `${f.family} (${SITE}packs/${p.pack}/${f.url})`).join(', ')}. Load them before drawing.`] : []),
    '',
    'Run one element standalone in a browser:',
    '  1. paste this file into a <script>,',
    '  2. paste the element code below it (it assigns CELLS[n - 1], n = the element number inside the pack),',
    '  3. then add:',
    `       const c = document.createElement('canvas'); c.width = ${W}; c.height = ${H}; document.body.append(c);`,
    `       const k = c.getContext('2d'), cell = CELLS.find(Boolean), t0 = performance.now();`,
    '       (function loop() {',
    `         const u = ((performance.now() - t0) / 1000) % ${C};   // seconds, 0 <= u < ${C}`,
    `         k.setTransform(1, 0, 0, 1, 0, 0); k.clearRect(0, 0, ${W}, ${H});`,
    `         k.save(); cell(k, ${W}, ${H}, u); k.restore();`,
    '         requestAnimationFrame(loop);',
    '       })();',
    'Every cell is a pure function of u, so the same call renders video frames: u = frame / fps.',
  ].map(l => (l ? `// ${l}` : '//'));
  return head.join('\n') + '\n\n' + kitOf[lang + '/' + p.pack] + '\n';
}

const tsvCell = s => String(s).replace(/[\t\r\n]+/g, ' ').trim();
function catalogTsv(lang) {
  const head = `# Motion Prompt catalog (${lang}) · ${catalog.count} elements · ${SITE} · columns: id\tpack\tcategory\ttitle\ttags\tsummary`;
  const rows = catalog.elements.map(el => {
    const cat = packOf[el.pack].categories.find(c => c.slug === el.category);
    const title = lang === 'en' ? el.name.en : `${el.name[lang]}（${el.name.en}）`;
    return [el.id, el.pack, cat ? cat[lang] : el.category, title, el.tags.join(','), el.summary[lang]].map(tsvCell).join('\t');
  });
  return [head, ...rows].join('\n') + '\n';
}

// ---------------------------------------------------------------- packs/<pack>/README*.md (the name lists, readable on GitHub)
// One file per language the pack is written in: README.md (en), README.<lang>.md (the others).
// Only supported languages with complete heading translations are generated.
const DOC = {
  en: { gen: 'Generated by tools/build.mjs from meta.json. Edit meta.json, not this file.', names: 'names', pack: 'pack', langs: 'Languages',
    intro: 'Find the name, then say it to your AI. Add how long, how strong and what moves, and the result gets closer to what you had in mind.',
    no: '#', name: 'Name', en: 'English', meaning: 'What it is', ask: 'How to ask an AI',
    more: 'Each number opens the moving sample in the gallery. Timings, easing values and reference code for one name:', all: 'All packs', preview: 'preview' },
  'zh-Hant': { gen: '由 tools/build.mjs 從 meta.json 產生，請修改來源資料。', names: '項術語', pack: '分類組', langs: '語言',
    intro: '觀看示範、找到名稱，並複製提示詞交給 AI。提問例句與示範規格分開呈現，請依用途選擇。',
    no: '編號', name: '繁中名稱', en: '英文名稱', meaning: '意思', ask: '向 AI 描述的例句',
    more: '編號連至本地動畫示範；完整規格與參考程式碼：', all: '全部分類組', preview: '示範' },
};
const LANG_NAME = { en: 'English', ja: '日本語', zh: '中文', 'zh-Hans': '简体中文', 'zh-Hant': '繁體中文', ko: '한국어', es: 'Español', fr: 'Français', de: 'Deutsch', pt: 'Português', it: 'Italiano', id: 'Bahasa Indonesia', vi: 'Tiếng Việt', th: 'ไทย', hi: 'हिन्दी', ar: 'العربية', ru: 'Русский', tr: 'Türkçe' };
const readmeName = lang => (lang === BASE_LANG ? 'README.md' : `README.${lang}.md`);
const tx = (o, lang) => o[lang];
const mdCell = s => String(s).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim();

function packReadme(src, p, lang) {
  // src = the pack as written (before fallbacks were filled), p = its catalog entry
  const d = DOC[lang], meta = src.raw;
  const apiLang = LANGS.includes(lang) ? lang : BASE_LANG;
  const others = src.langs.filter(l => l !== lang).map(l => `[${LANG_NAME[l] || l}](${readmeName(l)})`);
  const out = [
    `<!-- ${d.gen} -->`,
    '',
    `# ${tx(meta.title, lang)}`,
    '',
    `${p.count} ${d.names} · #${p.first}–${p.last} · ${d.pack} \`${p.pack}\`` + (others.length ? ` · ${d.langs}: ${others.join(' / ')}` : ''),
    '',
    d.intro,
    '',
  ];
  if (fs.existsSync(path.join(ROOT, 'assets', `preview-${p.pack}.gif`))) out.push(`![${tx(meta.title, lang)} — ${d.preview}](../../assets/preview-${p.pack}.gif)`, '');
  const withEn = lang !== BASE_LANG;
  for (const c of meta.categories) {
    const els = catalog.elements.filter(e => e.pack === p.pack && e.category === c.slug);
    if (!els.length) continue;
    out.push(`## ${tx(c, lang)}`, '');
    out.push(`| ${[d.no, d.name, ...(withEn ? [d.en] : []), d.meaning, d.ask].join(' | ')} |`);
    out.push(`|${Array(withEn ? 5 : 4).fill('---').join('|')}|`);
    for (const el of els) {
      const raw = meta.elements.find(e => e.slug === el.slug);
      out.push(`| ${[`[#${el.id}](../../index.html?lang=${lang}#${el.id})`, `**${mdCell(tx(raw.name, lang))}**`, ...(withEn ? [mdCell(raw.name[BASE_LANG])] : []), mdCell(tx(raw.meaning, lang)), mdCell(tx(raw.ask, lang))].join(' | ')} |`);
    }
    out.push('');
  }
  out.push(`${d.more} \`api/v1/${apiLang}/e/<id>.txt\` ([#${p.first}](../../api/v1/${apiLang}/e/${p.first}.txt)).`, '');
  out.push(`[${d.all}](../README.md)`, '');
  return out.join('\n');
}

function packsIndex() {
  const out = [
    `<!-- ${DOC.en.gen} -->`,
    '',
    '# Packs',
    '',
    'A pack is one field\'s set of names. Each list below is readable here on GitHub; the gallery shows the same names moving.',
    '',
    '| Numbers | Pack | Names | Lists |',
    '|---|---|---|---|',
  ];
  for (const src of packs) {
    const p = packOf[src.dir];
    const lists = src.langs.map(l => `[${LANG_NAME[l] || l}](${p.pack}/${readmeName(l)})`).join(' · ');
    out.push(`| ${p.first}–${p.last} | \`${p.pack}\` — ${mdCell(src.raw.title[BASE_LANG])} | ${p.count} | ${lists} |`);
  }
  out.push('', 'To add a pack for your field, or a language to an existing pack, see [FORMAT.md](../FORMAT.md).', '');
  return out.join('\n');
}

// ---------------------------------------------------------------- report + write
const report = () => {
  for (const w of warns) console.warn(`warn  ${w}`);
  for (const e of errors) console.error(`ERROR ${e}`);
};
if (errors.length) {
  report();
  console.error(`\nbuild failed: ${errors.length} error(s), ${warns.length} warning(s). Nothing was written.`);
  process.exit(1);
}

const files = new Map();
const escapeHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
files.set('index.html', fs.readFileSync(path.join(ROOT,'site.template.html'),'utf8').replace(/\{\{([A-Za-z0-9]+)\}\}/g, (_, key) => {
  if (!uiLocale['zh-Hant'][key]) throw new Error('Missing template key: ' + key);
  return escapeHtml(uiLocale['zh-Hant'][key].replace('{n}', catalog.count));
}));
files.set('api/v1/catalog.json', JSON.stringify(catalog, null, 1) + '\n');
for (const lang of LANGS) {
  files.set(`api/v1/${lang}/catalog.tsv`, catalogTsv(lang));
  for (const el of catalog.elements) {
    files.set(`api/v1/${lang}/e/${el.id}.txt`, elementTxt(el, lang));
    files.set(`api/v1/${lang}/p/${el.id}.txt`, mpPrompt(el, packOf[el.pack].title[lang], lang) + '\n');
  }
}
for (const p of catalog.packs) for (const lang of LANGS) files.set(`api/v1/kit/${lang}/${p.pack}.js`, kitJs(p, lang));
for (const p of packs) for (const lang of LANGS) files.set(`packs/${p.dir}/pack${lang === 'en' ? '.en' : ''}.js`, p.sources[lang]);
files.set('assets/locale.js', '/* Generated from locales/ui.json */\nwindow.MP_I18N = ' + JSON.stringify(uiLocale) + ';\n');
for (const src of packs) for (const lang of src.langs) files.set(`packs/${src.dir}/${readmeName(lang)}`, packReadme(src, packOf[src.dir], lang));
files.set('packs/README.md', packsIndex());
files.set('assets/catalog.js',
  `/* Generated by tools/build.mjs — do not edit. Source of truth: packs/<pack>/{meta.json,source.js} */\n` +
  `window.MP_CATALOG = ${JSON.stringify(catalog)};\n` +
  `window.MP_PROMPT = ${mpPrompt.toString()};\n`);

if (CHECK_ONLY) {
  for (const [rel, text] of files) if (!fs.existsSync(path.join(ROOT, rel)) || fs.readFileSync(path.join(ROOT, rel), 'utf8') !== text) err(rel, 'stale generated output; run build');
  const walk = dir => fs.existsSync(dir) ? fs.readdirSync(dir, {withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : [path.join(dir,e.name)]) : [];
  for (const f of walk(path.join(ROOT,'api/v1'))) if (!files.has(path.relative(ROOT,f))) err(f,'unexpected generated file');
}
report();
if (errors.length) process.exit(1);
if (!CHECK_ONLY) {
  fs.rmSync(path.join(ROOT, 'api', 'v1'), { recursive: true, force: true }); // generated only; drop stale IDs
  for (const [rel, text] of files) {
    const f = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
}
const summary = catalog.packs.map(p => `${p.pack} ${p.first}-${p.last}`).join(', ');
console.log(`${CHECK_ONLY ? 'checked' : 'built'} ${catalog.count} elements in ${catalog.packs.length} pack(s): ${summary}`);
console.log(`${CHECK_ONLY ? 'would write' : 'wrote'} ${files.size} files under ${ROOT}${warns.length ? ` · ${warns.length} warning(s)` : ''}`);
