import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { permittedTool } from './pi_boundary.mjs';
import { onePiTask } from './pi_office_policy.mjs';

test('Pi tools accept only fixture read/write and reject traversal, symlinks and excess output', t => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pi-tools-')));t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  fs.writeFileSync(path.join(dir,'input.json'),'{}');
  assert(permittedTool(dir,'read',{path:'input.json'}));assert(permittedTool(dir,'write',{path:'result.json',content:'{}'}));
  for(const [tool,input] of [['bash',{path:'input.json'}],['read',{path:'../input.json'}],['write',{path:'input.json',content:'x'}],['write',{path:'result.json',content:'x'.repeat(4097)}]])assert(!permittedTool(dir,tool,input));
  fs.symlinkSync(path.join(dir,'input.json'),path.join(dir,'result.json'));
  assert(!permittedTool(dir,'write',{path:'result.json',content:'x'}));
  fs.unlinkSync(path.join(dir,'result.json'));fs.symlinkSync(path.join(dir,'missing'),path.join(dir,'result.json'));
  assert(!permittedTool(dir,'write',{path:'result.json',content:'x'}));
});
test('Pi floor allows one fixed model and refuses other providers, shell, worktrees and resume', () => {
  const calls=[];const floor={project:{},workers:{officeDefault:{provider:'pi'},spawn(...args){calls.push(args);return {id:'fixture'};}}};onePiTask(floor);
  assert.equal(typeof floor.workers.spawn('desk','by','p',false,'agent','cloud'),'string');
  assert.equal(typeof floor.workers.spawn('desk','by','p',false,'shell','pi'),'string');
  assert.equal(typeof floor.workers.spawn('desk','by','p',true,'agent','pi'),'string');
  assert.equal(typeof floor.workers.spawn('desk','by','p',false,'agent','pi','other'),'string');
  floor.workers.spawn('desk','by','p',false,'agent');
  assert.equal(calls.length,1);assert.equal(calls[0][6],'deepseek/deepseek-flash');
  assert.equal(typeof floor.workers.spawn('desk','by','p',false,'agent','pi'),'string');
  assert.equal(typeof floor.workers.resume('fixture'),'string');assert.equal(typeof floor.workers.prompt('fixture','more'),'string');
});

test('Pi reconnect must be explicitly armed once for an exited matching session without a prompt', () => {
  const calls=[],w={info:{id:'fixture',kind:'agent',provider:'pi',model:'deepseek/deepseek-flash',sessionId:'saved',status:'exited'}};
  const floor={project:{},workers:{officeDefault:{provider:'pi'},workers:new Map([['fixture',w]]),spawn(){},resume(...args){calls.push(args);}}};
  const gate=onePiTask(floor,{allowReconnect:true});
  assert.equal(typeof floor.workers.resume('fixture'),'string');
  for(const mutation of [()=>w.info.status='working',()=>w.info.provider='grok',()=>w.interrupted=true,()=>w.pty={}]){
    mutation();assert.equal(gate.armReconnect('fixture','saved'),false);
    w.info.status='exited';w.info.provider='pi';delete w.interrupted;delete w.pty;
  }
  assert.equal(gate.armReconnect('foreign','saved'),false);assert.equal(gate.armReconnect('fixture','other'),false);
  assert(gate.armReconnect('fixture','saved'));assert.equal(gate.armReconnect('fixture','saved'),false);
  assert.equal(typeof floor.workers.resume('fixture','retry now'),'string');assert.equal(typeof floor.workers.resume('other'),'string');
  assert.equal(floor.workers.resume('fixture'),undefined);assert.deepEqual(calls,[['fixture']]);
  assert.equal(typeof floor.workers.resume('fixture'),'string');assert.equal(gate.armReconnect('fixture','saved'),false);
});

test('Pi reconnect stays disabled by default and consumes permission even on native failure', () => {
  const w={info:{id:'fixture',kind:'agent',provider:'pi',model:'deepseek/deepseek-flash',sessionId:'saved',status:'exited'}};
  const make=()=>({project:{},workers:{officeDefault:{provider:'pi'},workers:new Map([['fixture',w]]),spawn(){},resume(){throw Error('native failure');}}});
  const disabled=make();assert.equal(onePiTask(disabled).armReconnect('fixture','saved'),false);
  const floor=make(),gate=onePiTask(floor,{allowReconnect:true});assert(gate.armReconnect('fixture','saved'));
  assert.throws(()=>floor.workers.resume('fixture'),/native failure/);assert.equal(typeof floor.workers.resume('fixture'),'string');
});
