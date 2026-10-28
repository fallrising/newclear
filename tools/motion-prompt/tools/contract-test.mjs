#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'motion-prompt-contract-'));
const run=(script,args=[])=>spawnSync(process.execPath,[path.join(tmp,'tools',script),...args],{encoding:'utf8',cwd:tmp});
const digest=dir=>fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>{
 const f=path.join(dir,e.name);return e.isDirectory()?digest(f):[[path.relative(tmp,f),crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]];
});
try{
 fs.cpSync(root,tmp,{recursive:true,filter:s=>!/(^|\/)(node_modules|\.git)(\/|$)/.test(s)});
 let r=run('build.mjs');assert.equal(r.status,0,r.stderr);const first=digest(tmp);
 r=run('build.mjs');assert.equal(r.status,0,r.stderr);assert.deepEqual(digest(tmp),first,'repeated build must be byte-identical');
 const p=path.join(tmp,'packs/motion/meta.json'),original=fs.readFileSync(p,'utf8'),m=JSON.parse(original);
 delete m.elements[0].name['zh-Hant'];fs.writeFileSync(p,JSON.stringify(m));r=run('build.mjs');assert.notEqual(r.status,0);assert.match(r.stderr,/name.zh-Hant is missing/);
 fs.writeFileSync(p,original);const changed=JSON.parse(original);changed.elements[0].spec['zh-Hant'][0]=changed.elements[0].spec['zh-Hant'][0].replace('2.35','2.36');fs.writeFileSync(p,JSON.stringify(changed));
 r=run('validate.mjs');assert.notEqual(r.status,0);assert.match(r.stderr,/spec 1 numbers/);
 fs.writeFileSync(p,original);fs.appendFileSync(path.join(tmp,'api/v1/en/p/001.txt'),'stale');r=run('build.mjs',['--check']);assert.notEqual(r.status,0);assert.match(r.stderr,/stale generated output/);
 console.log('PASS AC-02-locales AC-03-fidelity AC-11-build: byte-identical repeated builds; missing translation, changed numeric specification and stale output are rejected.');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
