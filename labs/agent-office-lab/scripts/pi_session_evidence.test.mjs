import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readPiSession} from './pi_session_evidence.mjs';

test('native saved session evidence is bounded, same-session and includes real error history', t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'pi-session-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const session='00000000-0000-0000-0000-000000000001',dir=path.join(root,'.agent-office/pi-sessions/worker');fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,'time_'+session+'.jsonl'),rows=[{type:'session',id:session},{type:'message',message:{role:'user'}},{type:'message',message:{role:'assistant',stopReason:'error'}}];
 const raw=rows.map(x=>JSON.stringify(x)).join('\n')+'\n';fs.writeFileSync(file,raw);
 assert.equal(readPiSession(root,'worker',session).entries,3);assert.equal(readPiSession(root,'worker',session).bytes.toString(),raw);
 for(const id of ['../worker','worker/else'])assert.throws(()=>readPiSession(root,id,session));
 fs.writeFileSync(file,raw.replace(session,'00000000-0000-0000-0000-000000000002'));assert.throws(()=>readPiSession(root,'worker',session));
 fs.writeFileSync(file,'x'.repeat(2*1024*1024+1));assert.throws(()=>readPiSession(root,'worker',session));
 fs.unlinkSync(file);const outside=path.join(root,'outside');fs.writeFileSync(outside,raw);fs.symlinkSync(outside,file);assert.throws(()=>readPiSession(root,'worker',session));
 fs.unlinkSync(file);fs.writeFileSync(file,raw);fs.renameSync(dir,dir+'-saved');fs.symlinkSync(dir+'-saved',dir);assert.throws(()=>readPiSession(root,'worker',session));
});
