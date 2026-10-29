import test from 'node:test';
import assert from 'node:assert/strict';
import {messages,healthVerdict,canaryScan,journeyFrame,injectedKind,j01Verdict,j01FutureVerdict,j02RestartVerdict,j02InstanceVerdict,j03Verdict,j04Verdict,j05Verdict,j06LogoutVerdict,j06DisposeVerdict} from './journeys-browser-verdicts.mjs';

// SPEC-T006R-focused-journeys V02: each verdict passes its good row and fails, with one exact reason, on each broken condition.
const api='/api/p0/v1',turns=api+'/session/turns',session=api+'/session',boot=api+'/operator/session';
const req=(method,path,phase,status)=>({method,path,phase,...(status===undefined?{}:{status})});
function each(verdict,good,bad){assert.deepEqual(verdict(good),{passed:true,reasons:[]});for(const[name,change,reason]of bad)assert.deepEqual(verdict({...good,...change(structuredClone(good))}).reasons,[reason],name);}

test('J01 stored cursor above the high-water subscribes at the high-water without an error frame',()=>{
 const good={requests:[req('POST',boot,'auth'),req('POST',turns,'submit'),req('GET',session,'after-submit'),req('GET',session,'after-reload')],ws:[{dir:'sent',type:'subscribe',after_seq:0,phase:'before-reload'},{dir:'sent',type:'subscribe',after_seq:2,phase:'after-reload'},{dir:'received',type:'replay_begin',phase:'after-reload'}],fixtureTurns:1,highWater:2};
 each(j01Verdict,good,[
  ['second turn',g=>({requests:[...g.requests,req('POST',turns,'submit')]}),'TURN_COUNT'],
  ['fixture turns',()=>({fixtureTurns:2}),'FIXTURE_TURNS'],
  ['mutation after reload',g=>({requests:[...g.requests,req('POST',api+'/session/cancel','after-reload')]}),'MUTATION_AFTER_SUBMIT'],
  ['stored cursor used',g=>({ws:g.ws.map(f=>f.after_seq===2?{...f,after_seq:50}:f)}),'SUBSCRIBE_CURSOR'],
  ['future cursor received',g=>({ws:[...g.ws,{dir:'received',type:'error',code:'future_cursor',phase:'after-reload'}]}),'ERROR_FRAME']]);
});

test('J02 restart reaches 401 and bootstrap with no mutation or further upgrade',()=>{
 const good={requests:[req('POST',boot,'auth',201),req('GET',session,'after-restart',401)],authHeading:true,bearerEmpty:true,storedCursor:false,newFixtureMutations:0,upgradesInWindow:0};
 each(j02RestartVerdict,good,[
  ['first not 401',g=>({requests:[g.requests[0],req('GET',session,'after-restart',200)]}),'FIRST_REQUEST'],
  ['first not session',g=>({requests:[g.requests[0],req('GET',api+'/login','after-restart',401)]}),'FIRST_REQUEST'],
  ['not bootstrap',()=>({authHeading:false}),'NOT_BOOTSTRAP'],['bearer kept',()=>({bearerEmpty:false}),'NOT_BOOTSTRAP'],
  ['cursor kept',()=>({storedCursor:true}),'STORED_CURSOR'],
  ['browser mutation',g=>({requests:[...g.requests,req('POST',turns,'after-restart')]}),'MUTATION_AFTER_RESTART'],
  ['fixture mutation',()=>({newFixtureMutations:1}),'MUTATION_AFTER_RESTART'],
  ['upgrade',()=>({upgradesInWindow:1}),'UPGRADE_IN_WINDOW']]);
});

test('J01 future_cursor is answered by refresh and a resubscribe at the snapshot high-water',()=>{
 const good={requests:[req('POST',boot,'auth'),req('POST',turns,'submit'),req('GET',session,'after-refresh')],ws:[{dir:'sent',type:'subscribe',after_seq:3},{dir:'received',type:'error',code:'future_cursor',latest_available:2},{dir:'sent',type:'subscribe',after_seq:2}],fixtureTurns:1,errorsSeen:['',messages.stateChanged,''],errorText:'',connected:true,storedSeq:2};
 each(j01FutureVerdict,good,[
  ['second turn',g=>({requests:[...g.requests,req('POST',turns,'submit')]}),'TURN_COUNT'],['fixture turns',()=>({fixtureTurns:2}),'TURN_COUNT'],
  ['mutation after refresh',g=>({requests:[...g.requests,req('POST',api+'/session/cancel','after-refresh')]}),'MUTATION_AFTER_SUBMIT'],
  ['no future frame',g=>({ws:[g.ws[0],g.ws[2]]}),'FUTURE_FRAME'],['wrong latest',g=>({ws:g.ws.map(f=>f.code?{...f,latest_available:3}:f)}),'FUTURE_FRAME'],
  ['two future frames',g=>({ws:[...g.ws.slice(0,2),g.ws[1],g.ws[2]]}),'FUTURE_FRAME'],
  ['retry from the future cursor',g=>({ws:[...g.ws.slice(0,2),{...g.ws[2],after_seq:3}]}),'RESUBSCRIBE_CURSOR'],['retry from zero',g=>({ws:[...g.ws.slice(0,2),{...g.ws[2],after_seq:0}]}),'RESUBSCRIBE_CURSOR'],
  ['not connected',()=>({connected:false}),'NOT_CONNECTED'],['message never shown',()=>({errorsSeen:['']}),'ERROR_TEXT'],['message left',()=>({errorText:messages.stateChanged}),'ERROR_TEXT'],['cursor kept',()=>({storedSeq:3}),'STORED_CURSOR']]);
});

test('J02 stale instance is refused once with 409 and resyncs at the snapshot high-water without resend',()=>{
 const good={requests:[req('POST',boot,'auth'),req('POST',turns,'submit'),req('POST',api+'/session/cancel','cancel'),req('GET',session,'after-cancel')],override:{method:'POST',path:api+'/session/cancel',applied:true},cancelStatus:409,effectsChanged:false,sessionStatus:'running · cloud · sequence 2',ws:[{dir:'sent',type:'subscribe',after_seq:0,phase:'auth'},{dir:'sent',type:'subscribe',after_seq:2,phase:'after-cancel'}],highWater:2,errorsSeen:[messages.stateChanged,''],errorText:'',reconnected:true};
 each(j02InstanceVerdict,good,[
  ['override missed',g=>({override:{...g.override,applied:false}}),'REVIEW_OVERRIDE_NOT_APPLIED'],['cancel accepted',()=>({cancelStatus:200}),'REVIEW_OVERRIDE_NOT_APPLIED'],
  ['resent',g=>({requests:[...g.requests,req('POST',api+'/session/cancel','cancel')]}),'CANCEL_COUNT'],
  ['effect',()=>({effectsChanged:true}),'CANCEL_EFFECT'],['canceled',()=>({sessionStatus:'ready · cloud · sequence 3'}),'CANCEL_EFFECT'],
  ['mutation in window',g=>({requests:[...g.requests,req('POST',turns,'window')]}),'MUTATION_AFTER_CANCEL'],
  ['retry from zero',g=>({ws:[g.ws[0],{...g.ws[1],after_seq:0}]}),'RESYNC_CURSOR'],['zero high-water',()=>({highWater:0,ws:[{dir:'sent',type:'subscribe',after_seq:0,phase:'after-cancel'}]}),'RESYNC_CURSOR'],
  ['wrong message',()=>({errorsSeen:[messages.requestFailed,'']}),'ERROR_TEXT'],['message left',()=>({errorText:messages.stateChanged}),'ERROR_TEXT'],['not connected',()=>({reconnected:false}),'NOT_CONNECTED']]);
});

test('J03 the actual 15 s timer aborts an admitted turn that is never resent',()=>{
 const good={requests:[req('POST',boot,'auth'),req('POST',turns,'submit'),req('GET',session,'after-failure')],responses:[],held:{method:'POST',path:turns,status:202,outcome:'client-closed'},fixtureTurns:1,pressToFailMs:15020,requestToFailMs:15012,errorsSeen:[messages.requestFailed,''],errorText:'',connected:true,sessionStatus:'running · cloud · sequence 2'};
 each(j03Verdict,good,[
  ['shortened timer',()=>({pressToFailMs:14999}),'TIMER'],['late failure',()=>({requestToFailMs:17001}),'TIMER'],
  ['response written',g=>({held:{...g.held,outcome:'released'}}),'HELD'],['not admitted',g=>({held:{...g.held,status:409}}),'HELD'],
  ['resent',g=>({requests:[...g.requests,req('POST',turns,'submit')]}),'TURN_COUNT'],['fixture turns',()=>({fixtureTurns:2}),'TURN_COUNT'],
  ['delivered',()=>({responses:[{method:'POST',path:turns,status:202}]}),'RESPONSE_DELIVERED'],
  ['mutation after failure',g=>({requests:[...g.requests,req('POST',api+'/session/cancel','window')]}),'RESEND'],
  ['wrong message',()=>({errorsSeen:[messages.stateChanged,'']}),'ERROR_TEXT'],['message left',()=>({errorText:messages.requestFailed}),'ERROR_TEXT'],['not reconnected',()=>({connected:false}),'ERROR_TEXT'],['outcome lost',()=>({sessionStatus:'ready · cloud · sequence 2'}),'ADMITTED_OUTCOME']]);
});

test('J04 each injected kind stops automatic reconnect until a manual refresh',()=>{
 const frames={binary:{dir:'received',type:'BINARY'},malformed:{dir:'received',type:'UNPARSEABLE'},'unknown-field':{dir:'received',type:'error',code:'subscriber_lagged'}};
 for(const[kind,frame]of Object.entries(frames)){
  assert.equal(injectedKind(kind,frame),true);for(const other of Object.keys(frames).filter(k=>k!==kind))assert.equal(injectedKind(other,frame),false,kind+' as '+other);
  const good={kind,injected:1,ws:[{dir:'received',type:'replay_end'},frame],errorText:messages.protocolError,upgradesInWindow:0,upgradesAfterRefresh:1,subscribesAfterRefresh:1,connectedAfterRefresh:true,requests:[req('POST',boot,'auth'),req('GET',session,'after-refresh')],fixtureMutations:0};
  each(j04Verdict,good,[
   ['no connection',()=>({injected:0}),'NOT_INJECTED'],['not received',g=>({ws:g.ws.slice(0,1)}),'RECEIVED_KIND'],['twice',g=>({ws:[...g.ws,frame]}),'RECEIVED_KIND'],
   ['wrong text',()=>({errorText:messages.stateChanged}),'ERROR_TEXT'],['auto reconnect',()=>({upgradesInWindow:1}),'AUTOMATIC_RECONNECT'],
   ['refresh no upgrade',()=>({upgradesAfterRefresh:0}),'MANUAL_REFRESH'],['two subscribes',()=>({subscribesAfterRefresh:2}),'MANUAL_REFRESH'],['refresh not connected',()=>({connectedAfterRefresh:false}),'MANUAL_REFRESH'],
   ['browser mutation',g=>({requests:[...g.requests,req('POST',turns,'window')]}),'MUTATION'],['fixture mutation',()=>({fixtureMutations:1}),'MUTATION']]);
 }
 assert.equal(injectedKind('other',frames.binary),false);
});

test('J05 cookie expiry returns to bootstrap within the bound and stays quiet',()=>{
 const good={ws:[{dir:'received',type:'error',code:'authentication_expired'}],expiryMs:300,authHeading:true,errorText:messages.authRequired,bearerEmpty:true,storedCursor:false,requestsInWindow:0,upgradesInWindow:0,requests:[req('POST',boot,'auth')],fixtureMutations:0};
 each(j05Verdict,good,[
  ['no frame',()=>({ws:[]}),'EXPIRED_FRAME'],['slow',()=>({expiryMs:2001}),'EXPIRY_BOUND'],['not bootstrap',()=>({authHeading:false}),'NOT_BOOTSTRAP'],
  ['wrong text',()=>({errorText:''}),'NOT_BOOTSTRAP'],['bearer kept',()=>({bearerEmpty:false}),'NOT_BOOTSTRAP'],['cursor kept',()=>({storedCursor:true}),'STORED_CURSOR'],
  ['request',()=>({requestsInWindow:1}),'ACTIVITY_IN_WINDOW'],['upgrade',()=>({upgradesInWindow:1}),'ACTIVITY_IN_WINDOW'],
  ['browser mutation',g=>({requests:[...g.requests,req('POST',turns,'window')]}),'MUTATION'],['fixture mutation',()=>({fixtureMutations:1}),'MUTATION']]);
});

test('J06 logout clears every volatile field and stays quiet',()=>{
 const dom={bearerEmpty:true,promptEmpty:true,diffEmpty:true,eventsEmpty:true,deviceAbsent:true};
 const good={requests:[req('POST',boot,'auth'),req('DELETE',boot,'logout')],responses:[{method:'DELETE',path:boot,status:204}],openStreams:0,authHeading:true,dom,storedCursor:false,requestsInWindow:0,upgradesInWindow:0};
 each(j06LogoutVerdict,good,[
  ['no delete',g=>({requests:g.requests.slice(0,1)}),'LOGOUT'],['refused',()=>({responses:[{method:'DELETE',path:boot,status:403}]}),'LOGOUT'],
  ['stream open',()=>({openStreams:1}),'OPEN_STREAM'],['not bootstrap',()=>({authHeading:false}),'NOT_BOOTSTRAP'],
  ...Object.keys(dom).map(k=>[k,()=>({dom:{...dom,[k]:false}}),'NOT_CLEARED_'+k]),
  ['cursor kept',()=>({storedCursor:true}),'STORED_CURSOR'],['request',()=>({requestsInWindow:1}),'ACTIVITY_IN_WINDOW'],['upgrade',()=>({upgradesInWindow:1}),'ACTIVITY_IN_WINDOW']]);
});

test('J06 pagehide disposes the controller: the held GET aborts, the stream closes and nothing follows',()=>{
 const good={requests:[req('POST',boot,'auth'),req('GET',session,'refresh'),req('GET',session,'after-reload')],held:{method:'GET',path:session,status:200,outcome:'client-closed'},heldMs:12,failedHeld:1,openStreams:0,requestsInWindow:0,upgradesInWindow:0,cleared:{events:true,diff:true},reloadedSession:true,connected:true,errorText:''};
 each(j06DisposeVerdict,good,[
  ['released',g=>({held:{...g.held,outcome:'released'}}),'NOT_DISPOSED'],['still held',g=>({held:{...g.held,outcome:null}}),'NOT_DISPOSED'],['wrong route',g=>({held:{...g.held,path:api+'/login'}}),'NOT_DISPOSED'],
  ['slow',()=>({heldMs:1001}),'NOT_DISPOSED'],['no failure',()=>({failedHeld:0}),'NOT_DISPOSED'],
  ['stream open',()=>({openStreams:1}),'OPEN_STREAM'],['login read',()=>({requestsInWindow:1}),'ACTIVITY_IN_WINDOW'],['upgrade',()=>({upgradesInWindow:1}),'ACTIVITY_IN_WINDOW'],
  ['events kept',()=>({cleared:{events:false,diff:true}}),'NOT_CLEARED'],['diff kept',()=>({cleared:{events:true,diff:false}}),'NOT_CLEARED'],
  ['no reload session',()=>({reloadedSession:false}),'RELOAD'],['not connected',()=>({connected:false}),'RELOAD'],['error shown',()=>({errorText:messages.requestFailed}),'RELOAD'],
  ['mutation',g=>({requests:[...g.requests,req('POST',turns,'after-pagehide')]}),'MUTATION'],['mutation during refresh',g=>({requests:[...g.requests,req('POST',turns,'refresh')]}),'MUTATION']]);
});

test('health allows only the named failures and console lines for expected statuses',()=>{
 const failed={method:'POST',path:turns},line=status=>({type:'error',text:'Failed to load resource: the server responded with a status of '+status+' ()'});
 assert.equal(healthVerdict({pageErrors:0,requestFailed:[]}).passed,true);assert.equal(healthVerdict({pageErrors:0,requestFailed:[failed]},{failures:[failed]}).passed,true);
 assert.deepEqual(healthVerdict({pageErrors:0,requestFailed:[failed]}).reasons,['REQUEST_FAILED']);
 assert.deepEqual(healthVerdict({pageErrors:0,requestFailed:[failed,failed]},{failures:[failed]}).reasons,['REQUEST_FAILED']);
 assert.deepEqual(healthVerdict({pageErrors:1,requestFailed:[]}).reasons,['PAGE_ERRORS']);
 assert.equal(healthVerdict({pageErrors:0,requestFailed:[],console:[line(401)]},{statuses:[401]}).passed,true);
 assert.deepEqual(healthVerdict({pageErrors:0,requestFailed:[],console:[line(401),line(401)]},{statuses:[401]}).reasons,['CONSOLE']);
 assert.deepEqual(healthVerdict({pageErrors:0,requestFailed:[],console:[line(409)]},{statuses:[401]}).reasons,['CONSOLE']);
 assert.deepEqual(healthVerdict({pageErrors:0,requestFailed:[],console:[{type:'warning',text:'Unexpected'}]},{statuses:[401]}).reasons,['CONSOLE']);
 const net={type:'error',text:'Failed to load resource: net::ERR_ABORTED'};
 assert.equal(healthVerdict({pageErrors:0,requestFailed:[failed],console:[net]},{failures:[failed]}).passed,true);assert.deepEqual(healthVerdict({pageErrors:0,requestFailed:[],console:[net]}).reasons,['CONSOLE']);
});

test('journeyFrame separates binary from unparseable text and keeps only safe fields',()=>{
 assert.deepEqual(journeyFrame('received',Buffer.alloc(4)),{dir:'received',type:'BINARY'});assert.deepEqual(journeyFrame('received','{'),{dir:'received',type:'UNPARSEABLE'});
 assert.deepEqual(journeyFrame('received',JSON.stringify({type:'error',code:'subscriber_lagged',message:'session subscriber fell behind',review_extra:1})),{dir:'received',type:'error',code:'subscriber_lagged'});
 assert.deepEqual(journeyFrame('sent',JSON.stringify({type:'subscribe',protocol_version:1,session_id:'x',after_seq:2})),{dir:'sent',type:'subscribe',after_seq:2});
});

test('canary scan names only the sources that contain a secret',()=>{
 const secrets=['bearer-secret-value-0123456789','Synthetic J03 prompt','cookie-value-abcdefghijklmnop'];
 const clean={dom:'Authenticate',inputs:'',storage:'{"event_seq":2}',console:'401',row:'{"passed":true}'};
 assert.deepEqual(canaryScan(clean,secrets),[]);
 for(const[source,secret]of [['dom',secrets[1]],['inputs',secrets[0]],['storage',secrets[2]],['console',secrets[0]],['row',secrets[1]]])assert.deepEqual(canaryScan({...clean,[source]:'x '+secret+' y'},secrets),[source],source);
 assert.throws(()=>canaryScan(clean,['short']),/REVIEW_CANARY_INPUT/);assert.throws(()=>canaryScan(clean,[undefined]),/REVIEW_CANARY_INPUT/);
});

test('driver pins equal the current harness, verdicts and served assets, except the historical transport pin',async()=>{
 const {readFileSync}=await import('node:fs'),{createHash}=await import('node:crypto'),{fixedAssets}=await import('./fixture.mjs');const sha=b=>createHash('sha256').update(b).digest('hex');
 const driver=readFileSync(new URL('journeys-browser.mjs',import.meta.url),'utf8');const pins=JSON.parse(driver.match(/const expectedSources=(\{[^}]*\})/)[1]);const assets=new Map([...fixedAssets()].map(([path,asset])=>[path,sha(asset.body)]));
 assert.deepEqual(Object.keys(pins).sort(),['/','/assets/p0-app.js','/assets/p0-client.js','/assets/p0.css','baseline-support.mjs','conformance-browser-verdicts.mjs','fixture.mjs','journeys-browser-verdicts.mjs','lifecycle.mjs','remaining-support.mjs','transport.mjs','trust.mjs']);
 // SPEC-T006R-shared-capture: the favicon counter changed transport.mjs after journeys-001 ran; the driver stays pinned to the bytes it ran on.
 const historical={'transport.mjs':'9167d04e5b4937ec1aca3a6788b27b6e9b358f738f516bb3861a9877049b988f'};
 for(const[name,hash]of Object.entries(historical)){assert.equal(pins[name],hash,name);assert.notEqual(sha(readFileSync(new URL(name,import.meta.url))),hash,name);delete pins[name];}
 for(const[name,hash]of Object.entries(pins))assert.equal(name.startsWith('/')?assets.get(name):sha(readFileSync(new URL(name,import.meta.url))),hash,name);
});

test('driver keeps the interception, recording and output boundaries',async()=>{
 const {readFileSync}=await import('node:fs');const driver=readFileSync(new URL('journeys-browser.mjs',import.meta.url),'utf8');
 // D02/D03: no route.fetch (would need ignoreHTTPSErrors), no fulfil, no header or body access; no canonical or earlier run is written.
 for(const forbidden of ['.fetch(','.fulfill(','ignoreHTTPSErrors','allHeaders(','headers()','.body()','postData','/previous','remaining-accepted.json','captures.push','runs/','screenshot('])assert.equal(driver.includes(forbidden),false,forbidden);
 assert.match(driver,/writeFileSync\('\/output\/result\.json'/);assert.match(driver,/mode:'journeys-001'/);assert.match(driver,/not canonical cells/);assert.match(driver,/ports=\[8443\]/);
 assert.match(driver,/setTimeout\(\(\)=>life\.cancel\('deadline'\),200000\)/);assert.match(driver,/sleep\(5000\)\.then\(\(\)=>true\)/);
 for(const seam of ['holdNextResponse','injectFrame','overrideNextInstance','futureNextSubscribe'])assert(driver.includes(seam),seam);
});

test('no canonical runner or earlier driver calls a journey seam',async()=>{
 const {readFileSync,readdirSync}=await import('node:fs');const dir=new URL('./',import.meta.url);
 for(const name of readdirSync(dir).filter(n=>n.endsWith('.mjs')&&!['transport.mjs','journeys-browser.mjs'].includes(n)&&!n.endsWith('.node.mjs')))
  for(const seam of ['holdNextResponse','injectFrame','overrideNextInstance','futureNextSubscribe','releaseHeld'])assert.equal(readFileSync(new URL(name,dir),'utf8').includes(seam),false,name+' '+seam);
});
