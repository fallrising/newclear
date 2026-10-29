/** Pure journey verdicts (SPEC-T006R-focused-journeys V01). Inputs are reduced records; nothing here touches a browser. */
const api='/api/p0/v1';
export const messages=Object.freeze({requestFailed:'The request could not be completed safely.',stateChanged:'Current state changed; status was refreshed.',protocolError:'The session stream returned an invalid frame.',authRequired:'Authentication is required.'});
import {frameRecord} from './conformance-browser-verdicts.mjs';
const result=reasons=>({passed:reasons.length===0,reasons});
const count=(requests,method,path,phase)=>requests.filter(r=>r.method===method&&r.path===path&&(phase===undefined||r.phase===phase)).length;
const mutations=(requests,phases)=>requests.filter(r=>r.method!=='GET'&&phases.includes(r.phase)).length;
const served=(responses,method,path,status,code)=>responses.filter(r=>r.method===method&&r.path===path&&(status===undefined||r.status===status)&&(code===undefined||r.code===code)).length;
export function healthVerdict({pageErrors,requestFailed,console:lines=[]},{failures=[],statuses=[]}={}){const reasons=[];if(pageErrors!==0)reasons.push('PAGE_ERRORS');
 const left=[...failures];for(const f of requestFailed){const i=left.findIndex(a=>a.method===f.method&&a.path===f.path);if(i<0){reasons.push('REQUEST_FAILED');break;}left.splice(i,1);}
 // D04: each warning/error console line names an expected status or one of the named request failures, at most once each.
 const codes=[...statuses];let nets=failures.length;for(const m of lines){const x=/^Failed to load resource: (?:the server responded with a status of (\d{3})|net::ERR_[A-Z_]+)/.exec(String(m?.text??''));
  const i=x?.[1]?codes.indexOf(Number(x[1])):-1;if(x?.[1]&&i>=0)codes.splice(i,1);else if(x&&!x[1]&&nets>0)nets--;else{reasons.push('CONSOLE');break;}}
 return result(reasons);}
export const journeyFrame=(dir,payload)=>typeof payload==='string'?frameRecord(dir,payload):{dir,type:'BINARY'};
export function canaryScan(sources,secrets){
 // D04: report only which source contains a secret; never the value or its position.
 const values=secrets.filter(s=>typeof s==='string'&&s.length>=8);if(values.length!==secrets.length)throw Error('REVIEW_CANARY_INPUT');
 return Object.entries(sources).filter(([,text])=>values.some(v=>String(text??'').includes(v))).map(([name])=>name).sort();}
export function j01Verdict({requests,ws,fixtureTurns,highWater}){const reasons=[];
 if(count(requests,'POST',api+'/session/turns')!==1)reasons.push('TURN_COUNT');if(fixtureTurns!==1)reasons.push('FIXTURE_TURNS');
 if(mutations(requests,['after-submit','after-reload'])!==0)reasons.push('MUTATION_AFTER_SUBMIT');
 const after=ws.filter(f=>f.phase==='after-reload');const sub=after.find(f=>f.dir==='sent'&&f.type==='subscribe');
 if(!Number.isSafeInteger(highWater)||sub?.after_seq!==highWater)reasons.push('SUBSCRIBE_CURSOR');if(after.some(f=>f.dir==='received'&&f.type==='error'))reasons.push('ERROR_FRAME');
 return result(reasons);}
export function j02RestartVerdict({requests,authHeading,bearerEmpty,storedCursor,newFixtureMutations,upgradesInWindow}){const reasons=[];
 const first=requests.find(r=>r.phase==='after-restart');if(first?.method!=='GET'||first?.path!==api+'/session'||first?.status!==401)reasons.push('FIRST_REQUEST');
 if(authHeading!==true||bearerEmpty!==true)reasons.push('NOT_BOOTSTRAP');if(storedCursor!==false)reasons.push('STORED_CURSOR');
 if(mutations(requests,['after-restart'])!==0||newFixtureMutations!==0)reasons.push('MUTATION_AFTER_RESTART');if(upgradesInWindow!==0)reasons.push('UPGRADE_IN_WINDOW');
 return result(reasons);}
export function j01FutureVerdict({requests,ws,fixtureTurns,errorsSeen,errorText,connected,storedSeq}){const reasons=[];
 if(count(requests,'POST',api+'/session/turns')!==1||fixtureTurns!==1)reasons.push('TURN_COUNT');if(mutations(requests,['after-submit','after-refresh'])!==0)reasons.push('MUTATION_AFTER_SUBMIT');
 const i=ws.findIndex(f=>f.dir==='received'&&f.type==='error'&&f.code==='future_cursor');const futures=ws.filter(f=>f.dir==='received'&&f.code==='future_cursor');
 if(futures.length!==1||futures[0].latest_available!==2)reasons.push('FUTURE_FRAME');else if(ws.slice(i+1).find(f=>f.dir==='sent'&&f.type==='subscribe')?.after_seq!==2)reasons.push('RESUBSCRIBE_CURSOR');
 if(connected!==true)reasons.push('NOT_CONNECTED');if(!errorsSeen?.includes(messages.stateChanged)||errorText!=='')reasons.push('ERROR_TEXT');if(storedSeq!==2)reasons.push('STORED_CURSOR');
 return result(reasons);}
export function j02InstanceVerdict({requests,override,cancelStatus,effectsChanged,sessionStatus,ws,highWater,errorsSeen,errorText,reconnected}){const reasons=[];
 if(override?.applied!==true||cancelStatus!==409)reasons.push('REVIEW_OVERRIDE_NOT_APPLIED');if(count(requests,'POST',api+'/session/cancel')!==1)reasons.push('CANCEL_COUNT');
 if(effectsChanged!==false||!String(sessionStatus??'').startsWith('running'))reasons.push('CANCEL_EFFECT');if(mutations(requests,['after-cancel','window'])!==0)reasons.push('MUTATION_AFTER_CANCEL');
 const sub=ws.find(f=>f.phase==='after-cancel'&&f.dir==='sent'&&f.type==='subscribe');if(!(highWater>0)||sub?.after_seq!==highWater)reasons.push('RESYNC_CURSOR');
 if(!errorsSeen?.includes(messages.stateChanged)||errorText!=='')reasons.push('ERROR_TEXT');if(reconnected!==true)reasons.push('NOT_CONNECTED');
 return result(reasons);}
export function j03Verdict({requests,responses,held,fixtureTurns,pressToFailMs,requestToFailMs,errorsSeen,errorText,connected,sessionStatus}){const reasons=[];
 if(!(pressToFailMs>=15000)||!(requestToFailMs<=17000))reasons.push('TIMER');if(held?.status!==202||held?.outcome!=='client-closed')reasons.push('HELD');
 if(count(requests,'POST',api+'/session/turns')!==1||fixtureTurns!==1)reasons.push('TURN_COUNT');if(served(responses,'POST',api+'/session/turns',202)!==0)reasons.push('RESPONSE_DELIVERED');
 if(mutations(requests,['after-failure','window'])!==0)reasons.push('RESEND');if(!errorsSeen?.includes(messages.requestFailed)||errorText!==''||connected!==true)reasons.push('ERROR_TEXT');
 if(!String(sessionStatus??'').startsWith('running'))reasons.push('ADMITTED_OUTCOME');
 return result(reasons);}
export const injectedKind=(kind,frame)=>kind==='binary'?frame.type==='BINARY':kind==='malformed'?frame.type==='UNPARSEABLE':kind==='unknown-field'?frame.type==='error'&&frame.code==='subscriber_lagged':false;
export function j04Verdict({kind,injected,ws,errorText,upgradesInWindow,upgradesAfterRefresh,connectedAfterRefresh,requests,fixtureMutations}){const reasons=[];
 if(injected!==1)reasons.push('NOT_INJECTED');if(ws.filter(f=>f.dir==='received'&&injectedKind(kind,f)).length!==1)reasons.push('RECEIVED_KIND');
 if(errorText!==messages.protocolError)reasons.push('ERROR_TEXT');if(upgradesInWindow!==0)reasons.push('AUTOMATIC_RECONNECT');
 if(upgradesAfterRefresh!==1||connectedAfterRefresh!==true)reasons.push('MANUAL_REFRESH');
 if(mutations(requests,['after-auth','window','after-refresh'])!==0||fixtureMutations!==0)reasons.push('MUTATION');
 return result(reasons);}
export function j05Verdict({ws,expiryMs,authHeading,errorText,bearerEmpty,storedCursor,requestsInWindow,upgradesInWindow,requests,fixtureMutations}){const reasons=[];
 if(ws.filter(f=>f.dir==='received'&&f.type==='error'&&f.code==='authentication_expired').length!==1)reasons.push('EXPIRED_FRAME');if(!(expiryMs>=0&&expiryMs<=2000))reasons.push('EXPIRY_BOUND');
 if(authHeading!==true||errorText!==messages.authRequired||bearerEmpty!==true)reasons.push('NOT_BOOTSTRAP');if(storedCursor!==false)reasons.push('STORED_CURSOR');
 if(requestsInWindow!==0||upgradesInWindow!==0)reasons.push('ACTIVITY_IN_WINDOW');if(mutations(requests,['after-auth','window'])!==0||fixtureMutations!==0)reasons.push('MUTATION');
 return result(reasons);}
export function j06LogoutVerdict({requests,responses,openStreams,authHeading,dom,storedCursor,requestsInWindow,upgradesInWindow}){const reasons=[];
 if(count(requests,'DELETE',api+'/operator/session')!==1||served(responses,'DELETE',api+'/operator/session',204)!==1)reasons.push('LOGOUT');
 if(openStreams!==0)reasons.push('OPEN_STREAM');if(authHeading!==true)reasons.push('NOT_BOOTSTRAP');
 for(const k of ['bearerEmpty','promptEmpty','diffEmpty','eventsEmpty','deviceAbsent'])if(dom?.[k]!==true)reasons.push('NOT_CLEARED_'+k);
 if(storedCursor!==false)reasons.push('STORED_CURSOR');if(requestsInWindow!==0||upgradesInWindow!==0)reasons.push('ACTIVITY_IN_WINDOW');
 return result(reasons);}
export function j06DisposeVerdict({requests,held,heldMs,failedHeld,openStreams,requestsInWindow,upgradesInWindow,cleared,reloadedSession,connected,errorText}){const reasons=[];
 if(held?.method!=='GET'||held?.path!==api+'/session'||held?.outcome!=='client-closed'||!(heldMs<=1000)||failedHeld!==1)reasons.push('NOT_DISPOSED');
 if(openStreams!==0)reasons.push('OPEN_STREAM');if(requestsInWindow!==0||upgradesInWindow!==0)reasons.push('ACTIVITY_IN_WINDOW');if(cleared?.events!==true||cleared?.diff!==true)reasons.push('NOT_CLEARED');
 if(reloadedSession!==true||connected!==true||errorText!=='')reasons.push('RELOAD');if(mutations(requests,['after-auth','after-pagehide','after-reload'])!==0)reasons.push('MUTATION');
 return result(reasons);}
