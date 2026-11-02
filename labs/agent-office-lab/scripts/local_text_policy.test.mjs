import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {textBoundary} from './local_text_policy.mjs';
test('text tools cannot escape source files, write sources, use shell or follow links',t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'text-policy-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'source'));fs.writeFileSync(path.join(root,'source/brief.md'),'notes');
 const check=textBoundary(root,{'brief.md':'notes'});
 check('read',{filePath:'source/brief.md'});check('write',{filePath:'output.md',content:'summary'});
 for(const [tool,args]of [['bash',{command:'true'}],['read',{filePath:'/etc/passwd'}],['read',{filePath:'source/unknown.md'}],['write',{filePath:'source/brief.md',content:'bad'}],['write',{filePath:'output.md',content:'x'.repeat(65537)}],['edit',{filePath:'output.md'}]])assert.throws(()=>check(tool,args));
 fs.symlinkSync(path.join(root,'source/brief.md'),path.join(root,'output.md'));assert.throws(()=>check('write',{filePath:'output.md',content:'bad'}));
 fs.unlinkSync(path.join(root,'output.md'));fs.symlinkSync(path.join(root,'missing.md'),path.join(root,'output.md'));assert.throws(()=>check('write',{filePath:'output.md',content:'bad'}));
 const limited=textBoundary(root,{'brief.md':'notes'});for(let i=0;i<24;i++)limited('read',{filePath:'source/brief.md'});assert.throws(()=>limited('read',{filePath:'source/brief.md'}));
});
test('revision requires a read of the selected target before output, without allowing source writes',t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'revision-policy-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'source'));fs.writeFileSync(path.join(root,'source/calc.py'),'before');fs.writeFileSync(path.join(root,'source/notes.md'),'notes');
 const files={'calc.py':'before','notes.md':'notes'},check=textBoundary(root,files,'calc.py');
 assert.throws(()=>textBoundary(root,files,'unknown.py'));
 assert.throws(()=>check('write',{filePath:'output.md',content:'after'}));
 check('read',{filePath:'source/notes.md'});assert.throws(()=>check('write',{filePath:'output.md',content:'after'}));
 check('read',{filePath:'source/calc.py'});check('write',{filePath:'output.md',content:'after'});
 assert.throws(()=>check('write',{filePath:'source/calc.py',content:'after'}));
});
