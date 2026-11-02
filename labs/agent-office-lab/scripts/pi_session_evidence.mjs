// Read only the bounded synthetic worker's native Pi session; never expose its contents to HTTP.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export function readPiSession(workspace, workerId, sessionId) {
  assert(/^[a-zA-Z0-9_-]{1,100}$/.test(workerId));assert(/^[0-9a-f-]{36}$/.test(sessionId));
  let dir=workspace;
  for(const part of ['.agent-office','pi-sessions',workerId]) {
    dir=path.join(dir,part);assert(fs.lstatSync(dir).isDirectory()&&!fs.lstatSync(dir).isSymbolicLink());
  }
  const names=fs.readdirSync(dir).filter(n=>n.endsWith('_'+sessionId+'.jsonl'));assert.equal(names.length,1);
  const file=path.join(dir,names[0]),fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  let bytes;
  try {const info=fs.fstatSync(fd);assert(info.isFile()&&info.size<=2*1024*1024);const buffer=Buffer.alloc(2*1024*1024+1);const n=fs.readSync(fd,buffer,0,buffer.length,null);assert(n<=2*1024*1024);bytes=buffer.subarray(0,n);}finally{fs.closeSync(fd);}
  const entries=bytes.toString('utf8').trim().split('\n').map(s=>JSON.parse(s));
  assert(entries[0].type==='session'&&entries[0].id===sessionId);
  assert(entries.some(e=>e.type==='message'&&e.message?.role==='user'));
  assert(entries.some(e=>e.type==='message'&&e.message?.role==='assistant'&&e.message.stopReason==='error'));
  return {bytes,sha256:createHash('sha256').update(bytes).digest('hex'),entries:entries.length};
}
