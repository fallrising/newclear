#!/usr/bin/env node
// Content contract: immutable upstream mapping, complete locales, numeric/unit parity, local links.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root,f),'utf8');
const json = f => JSON.parse(read(f));
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const lock = json('upstream-lock.json'), catalog = json('api/v1/catalog.json');
const stripZh = o => Array.isArray(o) ? o.map(stripZh) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).filter(([k])=>k!=='zh-Hant').map(([k,v])=>[k,stripZh(v)])) : o;
const errors=[];
const same=(a,b,where)=>{try{assert.deepEqual(a,b);}catch{errors.push(where+': '+JSON.stringify(a)+' != '+JSON.stringify(b));}};
// Compare numeric lexemes (including decimal precision, colour hexes and exponents),
// independently per spec line. Chinese word order may differ, so compare multisets.
const numbers = s => (s.replace(/\d,\d{3}/g,x=>x.replace(',','')).match(/#[0-9A-Fa-f]{6}\b|\d+(?:\.\d+)?/g)||[]).sort();
const units = s => [...s.matchAll(/\d\s*(px|rad|fps|mm|EV|s|m|%|°|″)(?![a-z])/g)].map(m=>m[1]).sort();
let total=0,specs=0;
for (const [pack,base] of Object.entries(lock.packs)) {
 const m=json(`packs/${pack}/meta.json`);
 same(sha(read(`packs/${pack}/source.js`)),lock.files[`packs/${pack}/pack.js`],pack+' original source');
 same(sha(JSON.stringify(stripZh(m))),base.metadataSha256,pack+' original metadata');
 same(m.order,base.order,pack+' order');
 same(m.categories.map(c=>c.slug),base.categories,pack+' categories');
 same(m.elements.map(e=>({no:e.no,slug:e.slug,name:e.name.en,category:e.category})),base.elements,pack+' ID/slug/name mapping');
 for (const l of ['zh-Hant','en']) {
  if(!m.title[l]?.trim()) errors.push(pack+' title '+l);
  for(const c of m.categories)if(!c[l]?.trim())errors.push(pack+' category '+l);
 }
 for(const e of m.elements) {
  total++;
  for(const field of ['name','meaning','ask','summary','use','spec']) for(const l of ['zh-Hant','en']) {
   const values=Array.isArray(e[field]?.[l])?e[field][l]:[e[field]?.[l]];
   if(!values.length||values.some(x=>typeof x!=='string'||!x.trim()))errors.push(`${pack}/${e.no} ${field}.${l} incomplete`);
   if(l==='zh-Hant'&&values.some(x=>/[\u3040-\u30ff]/.test(x)))errors.push(`${pack}/${e.no} ${field} Japanese text`);
  }
  for (const field of ['meaning','ask','summary','use']) same(numbers(e[field]['zh-Hant']),numbers(e[field].en),`${pack}/${e.no} ${field} numbers`);
  same(e.spec['zh-Hant'].length,e.spec.en.length,`${pack}/${e.no} spec line count`);
  e.spec.en.forEach((s,i)=>{specs++;same(numbers(e.spec['zh-Hant'][i]),numbers(s),`${pack}/${e.no} spec ${i+1} numbers`);same(units(e.spec['zh-Hant'][i]),units(s),`${pack}/${e.no} spec ${i+1} units`);});
 }
 for(const lang of ['zh-Hant','en']) {
  const src=read(`packs/${pack}/pack${lang==='en'?'.en':''}.js`);
  if(/[\u3040-\u30ff]/.test(src))errors.push(pack+' '+lang+' Japanese remains in generated drawing');
 }
}
same(total,120,'total');same(catalog.count,total,'catalog count');
for (const f of ['LICENSE','THIRD-PARTY-NOTICES.md'])same(sha(read(f)),lock.files[f],f+' preserved');
for(const el of catalog.elements)for(const lang of ['zh-Hant','en']) {
 const prompt=read(`api/v1/${lang}/p/${el.id}.txt`);
 if(!prompt.includes(el.slug)||!prompt.includes(el.name.en))errors.push(el.id+' prompt identity');
 for(const field of ['name','meaning','ask','summary','use','spec'])if(lang==='en'&&/[\u3040-\u30ff\u3400-\u9fff]/.test(JSON.stringify(el[field].en)))errors.push(el.id+' generated English '+field+' contains CJK');
 for(const m of prompt.matchAll(/\.\/api\/v1\/[^\s]+/g)) if(!fs.existsSync(path.join(root,m[0])))errors.push('broken prompt path '+m[0]);
}
const ui=json('locales/ui.json');same(Object.keys(ui['zh-Hant']).sort(),Object.keys(ui.en).sort(),'UI locale keys');
for(const [k,v] of Object.entries(ui['zh-Hant']))if(!/[\u3400-\u9fff]/.test(v)&&!['enOption','authorName'].includes(k))errors.push('UI Chinese missing '+k);
const walk = dir => fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const docs = ['README.md','FORMAT.md','UPSTREAM.md','evidence/VERIFICATION.md',...walk(path.join(root,'packs')).filter(f=>f.endsWith('.md')).map(f=>path.relative(root,f))];
for(const rel of ['index.html',...docs]) {
 const body=read(rel), pattern=rel.endsWith('.html')?/(?:href|src)="([^"]+)"/g:/\[[^\]]*\]\(([^)]+)\)/g;
 for(const match of body.matchAll(pattern)) {
  const url=match[1];if(/^(?:[a-z]+:|#)/i.test(url))continue;
  const target=url.split(/[?#]/)[0];if(target&&!fs.existsSync(path.resolve(root,path.dirname(rel),target)))errors.push(rel+' broken local link '+url);
 }
}
if(errors.length){console.error(errors.join('\n'));process.exit(1);}
console.log(`PASS AC-01-source AC-02-locales AC-03-fidelity AC-12-provenance: ${total} entries, 5 packs, ${specs} paired spec lines; IDs, original source/English/Japanese, locale completeness, numbers, units, API paths.`);
