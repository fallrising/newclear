/** Pure C2 verdicts (SPEC-T006R-harness-repair-c2 C203). Inputs are reduced records; nothing here touches a browser. */
const api='/api/p0/v1';
export function netError(message){const m=/net::(ERR_[A-Z_]+)/.exec(String(message??''));return m?m[1]:'OTHER';}
const result=reasons=>({passed:reasons.length===0,reasons});
export function tlsVerdict({positive,wrongName,untrusted,plain}){const reasons=[];
 if(positive?.status!==200||positive?.streamConnected!==true)reasons.push('POSITIVE');
 if(wrongName?.error!=='ERR_CERT_COMMON_NAME_INVALID'||wrongName?.requests!==0)reasons.push('WRONG_NAME');
 if(untrusted?.error!=='ERR_CERT_AUTHORITY_INVALID'||untrusted?.requests!==0)reasons.push('UNTRUSTED_CA');
 const servedPlain=plain?.error===null&&plain?.status===200&&String(plain?.finalURL).startsWith('http:');if(!plain||servedPlain||plain.requests!==0)reasons.push('PLAIN_HTTP');
 return result(reasons);}
export function r06Verdict({requests,ws,fixtureTurns}){const reasons=[];const count=(method,path)=>requests.filter(r=>r.method===method&&r.path===path).length;
 if(count('POST',api+'/operator/session')!==1)reasons.push('BOOTSTRAP_COUNT');if(count('POST',api+'/session/turns')!==1)reasons.push('TURN_COUNT');
 if(requests.some(r=>r.afterSubmit&&r.method!=='GET'))reasons.push('MUTATION_AFTER_SUBMIT');if(fixtureTurns!==17)reasons.push('FIXTURE_TURNS');
 const gaps=ws.map((f,i)=>({...f,i})).filter(f=>f.dir==='received'&&f.type==='error'&&f.code==='history_gap');
 if(gaps.length!==1||gaps[0].oldest_available!==5||gaps[0].latest_available!==68)reasons.push('GAP_FRAME');
 else{const next=ws.slice(gaps[0].i+1).find(f=>f.dir==='sent'&&f.type==='subscribe');if(next?.after_seq!==68)reasons.push('RESUBSCRIBE_CURSOR');}
 return result(reasons);}
export function traversalVerdict(steps,required=['event-list','diff-output']){const reasons=[];for(const id of required){const step=steps.find(s=>s.id===id);if(!step)reasons.push('NOT_REACHED_'+id);else if(step.focusVisible!==true||!step.outlineStyle||step.outlineStyle==='none'||!(step.outlineWidth>0))reasons.push('NO_FOCUS_RING_'+id);}return result(reasons);}
export function nameVerdict(regions){const reasons=[];for(const r of regions){if(!r.expected)reasons.push('NO_HEADING_'+r.id);if(r.playwrightId!==r.id)reasons.push('PLAYWRIGHT_NAME_'+r.id);if(r.axRole!=='region'||r.axName!==r.expected)reasons.push('AX_NAME_'+r.id);}return result(reasons);}
export function scrollVerdict({overflowing,before,afterArrow,afterPage}){const reasons=[];if(overflowing!==true)reasons.push('NOT_OVERFLOWING');else{if(!(afterArrow>before))reasons.push('ARROW_DID_NOT_SCROLL');if(!(afterPage>afterArrow))reasons.push('PAGE_DID_NOT_SCROLL');}return result(reasons);}
export function frameRecord(dir,text){let f;try{f=JSON.parse(text);}catch{return {dir,type:'UNPARSEABLE'};}if(!f||typeof f!=='object')return {dir,type:'UNPARSEABLE'};const out={dir,type:typeof f.type==='string'?f.type:'UNKNOWN'};for(const k of ['code'])if(typeof f[k]==='string'&&/^[a-z_]{1,40}$/.test(f[k]))out[k]=f[k];for(const k of ['after_seq','high_water_seq','oldest_available','latest_available','supported_version'])if(Number.isSafeInteger(f[k]))out[k]=f[k];if(Number.isSafeInteger(f.envelope?.seq))out.seq=f.envelope.seq;return out;}
