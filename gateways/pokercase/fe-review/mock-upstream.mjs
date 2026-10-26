import http from 'node:http';
import assert from 'node:assert/strict';
import {UPSTREAM} from './guards.mjs';

export function createMock(key) {
  const counters={requests:0,success:0,errors:0,rejected:0};
  const server=http.createServer(async(req,res)=>{
    try {
      counters.requests++;
      if(req.headers.authorization!=='Bearer '+key){counters.rejected++;res.writeHead(401,{'Content-Type':'application/json'});res.end('{"error":{"message":"synthetic unauthorized"}}');return;}
      if(req.method!=='POST'||req.url!=='/v1/chat/completions'){counters.rejected++;res.writeHead(404);res.end();return;}
      const chunks=[];let bytes=0;
      for await(const chunk of req){bytes+=chunk.length;if(bytes>32768){res.writeHead(413);res.end();req.destroy();return;}chunks.push(chunk);}
      const input=JSON.parse(Buffer.concat(chunks).toString());
      assert(input.stream!==true,'REVIEW_MOCK_STREAM_NOT_REQUESTED');
      if(input.model==='review-error'){counters.errors++;res.writeHead(500,{'Content-Type':'application/json'});res.end('{"error":{"message":"Synthetic upstream failure"}}');return;}
      assert(input.model==='review-model','REVIEW_MOCK_MODEL');
      counters.success++;res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({id:'chatcmpl-synthetic',object:'chat.completion',model:'review-model',choices:[{index:0,message:{role:'assistant',content:'合成回覆'},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:3,total_tokens:15}}));
    } catch {counters.rejected++;if(!res.headersSent)res.writeHead(400,{'Content-Type':'application/json'});res.end('{"error":{"message":"Synthetic fixture rejected request"}}');}
  });
  server.requestTimeout=5000;server.headersTimeout=5000;
  return {server,counters,origin:UPSTREAM};
}
