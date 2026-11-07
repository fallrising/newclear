/** SPEC-T006F: pure, fail-closed acceptance of reduced browser/fixture observations. */
const session='/api/p0/v1/session';
const result=reasons=>({passed:reasons.length===0,reasons});
export function healthVerdict({pageErrors,requestFailed,responses,console:lines}){
 const reasons=[];if(pageErrors!==0)reasons.push('PAGE_ERRORS');if(requestFailed.length)reasons.push('REQUEST_FAILED');
 const bad=responses.filter(r=>r.status>=400);if(bad.length!==1||bad[0].method!=='GET'||bad[0].path!==session||bad[0].status!==401||bad[0].phase!=='bootstrap')reasons.push('HTTP_FAILURE');
 if(lines.length>1||lines.some(m=>m.type!=='error'||m.path!==session||m.text!=='Failed to load resource: the server responded with a status of 401 (Unauthorized)'))reasons.push('CONSOLE');
 return result(reasons);
}
export function layoutVerdict(r){const reasons=[];
 if(!Number.isFinite(r.gap)||r.gap<12)reasons.push('GAP');if(!Number.isFinite(r.scrollWidth)||!Number.isFinite(r.innerWidth)||r.innerWidth<=0||r.scrollWidth>r.innerWidth)reasons.push('OVERFLOW');
 if(r.bearerEmpty!==true||r.screenshotBeforeBearer!==true)reasons.push('UNSAFE_CAPTURE');
 if(!Number.isSafeInteger(r.favicon?.gets)||r.favicon.gets<1||r.favicon.heads!==0||r.favicon.rejected!==0||r.favicon.status!==200||!/^[a-f0-9]{64}$/.test(r.iconSha256)||r.favicon.sha256!==r.iconSha256)reasons.push('FAVICON');return result(reasons);
}
export function streamVerdict(r){const reasons=[];
 if(r.injected!==1||r.malformedReceived!==1)reasons.push('INJECTION');if(r.closesBeforeRefresh!==1||r.clientsBeforeRefresh!==0||r.disconnected!==true)reasons.push('CLOSE');
 if(r.errorText!=='The session stream returned an invalid frame.')reasons.push('ERROR_TEXT');
 if(!Number.isFinite(r.quietMs)||r.quietMs<1500||r.quietUpgrades!==0||r.quietMutations!==0||r.quietClients!==0)reasons.push('QUIET');
 if(r.refreshClicks!==1||r.refreshUpgrades!==1||r.refreshSubscribes!==1||r.connectedAfterRefresh!==true)reasons.push('REFRESH');
 if(r.mutationsAfterRefresh!==0||r.turnStarts!==0||r.cancels!==0)reasons.push('MUTATIONS');return result(reasons);
}
