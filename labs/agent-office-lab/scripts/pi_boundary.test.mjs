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
