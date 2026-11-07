/** Pure shared-capture verdicts (SPEC-T006R-shared-capture V01). Inputs are reduced records; nothing here starts a process or a browser. */
export const origin='https://127.0.0.1:8443',outDir='/output/capture';
export const viewports=Object.freeze([['desktop',1440,900],['tablet',834,1112],['mobile',390,844]]);
export const planLines=Object.freeze([`control-plane: ${origin} (1 pages) start=undefined`,'  - home: /',`out: ${outDir}`]);
export const bootstrapConsole='[error] Failed to load resource: the server responded with a status of 401 (Unauthorized)';
export const bootstrapFailed=`GET ${origin}/api/p0/v1/session HTTP 401`;
// W08: Chromium's automatic GET /favicon.ico reaches the transport because capture.mjs installs no route; Playwright hides it from request events but Chromium logs this line.
export const faviconConsole='[error] Failed to load resource: the server responded with a status of 404 (Not Found)';
const result=reasons=>({passed:reasons.length===0,reasons});
const same=(a,b)=>Array.isArray(a)&&a.length===b.length&&a.every((x,i)=>x===b[i]);
// Exact lines: the text must end with one newline and contain no blank line.
export const lines=text=>{const t=String(text??'');if(!t.endsWith('\n'))return null;const out=t.slice(0,-1).split('\n');return out.includes('')?null:out;};
export function targetsVerdict(t){const reasons=[];const app=t?.apps?.[0];
 if(t?.project!=='fanzloud'||t?.locale!=='en-US'||!same(t?.colorSchemes,['dark'])||'viewports' in (t??{}))reasons.push('TARGETS_SHAPE');
 if(t?.apps?.length!==1||app?.name!=='control-plane'||app?.kind!=='server'||app?.baseUrl!==origin||'start' in (app??{})||'storageState' in (app??{}))reasons.push('TARGETS_APP');
 if(app?.pages?.length!==1||app.pages[0].id!=='home'||app.pages[0].path!=='/'||Object.keys(app.pages[0]).length!==2)reasons.push('TARGETS_PAGES');
 return result(reasons);}
export function planVerdict({code,stdout,stderr,outputExists}){const reasons=[];
 if(code!==0)reasons.push('EXIT');if(stderr!=='')reasons.push('STDERR');if(!same(lines(stdout),planLines))reasons.push('PLAN');if(outputExists!==false)reasons.push('OUTPUT_WRITTEN');
 return result(reasons);}
export function captureVerdict({code,stdout,stderr,manifest,pngs,transport,fixture}){const reasons=[];
 if(code!==0)reasons.push('EXIT');if(stderr!=='')reasons.push('STDERR');
 const out=lines(stdout)??[],oks=viewports.map(([name])=>`ok   control-plane home ${name} dark`);
 if(out.length!==4||!same(out.slice(0,3),oks)||!/^wrote .*capture\.json$/.test(out[3]??'')||out.some(l=>l.startsWith('FAIL')))reasons.push('STDOUT');
 const results=manifest?.results;if(manifest?.project!=='fanzloud'||manifest?.axe!==true||!Array.isArray(results)||results.length!==3)reasons.push('MANIFEST');
 else viewports.forEach(([name,width,height],i)=>{const r=results[i],tag=name.toUpperCase();
  if(r.app!=='control-plane'||r.page!=='home'||r.viewport!==name||r.colorScheme!=='dark'||r.url!==origin+'/')reasons.push('RECORD_'+tag);
  if(r.status!==200||'error' in r||r.title!=='Codebox operator'||r.horizontalOverflow!==false)reasons.push('LOAD_'+tag);
  const seen=Array.isArray(r.consoleErrors)?[...r.consoleErrors].sort():null;
  if(!same(r.pageErrors,[])||!(same(seen,[bootstrapConsole])||same(seen,[bootstrapConsole,faviconConsole].sort()))||!same(r.failedRequests,[bootstrapFailed]))reasons.push('HEALTH_'+tag);
  if(i===0?!Array.isArray(r.axeViolations)||r.axeViolations.some(v=>['critical','serious'].includes(v?.impact)):'axeViolations' in r)reasons.push('AXE_'+tag);
  const png=pngs?.[r.screenshot];if(!png||png.width!==width||!(png.height>=height))reasons.push('PNG_'+tag);});
 const f=transport?.unknownFavicon;if(!Number.isInteger(f)||f<0||f>3||transport?.unknownRequests!==f||transport?.requests!==15+f||transport?.upgrades!==0||transport?.rejectedUpgrades!==0)reasons.push('TRANSPORT');
 else if(faviconSummary({manifest,transport}).consoleLines>f)reasons.push('FAVICON_CONSOLE');
 const counts=fixture?.counts??{};if(Object.keys(counts).length!==1||counts['GET /api/p0/v1/session']!==3||fixture?.effects!==0||fixture?.turnStarts!==0)reasons.push('FIXTURE');
 return result(reasons);}
export const faviconSummary=({manifest,transport})=>({requests:transport?.unknownFavicon??null,consoleLines:(Array.isArray(manifest?.results)?manifest.results:[]).reduce((n,r)=>n+(Array.isArray(r?.consoleErrors)?r.consoleErrors:[]).filter(l=>l===faviconConsole).length,0)});
export function pngSize(buffer){const sig=[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];if(!Buffer.isBuffer(buffer)||buffer.length<24||!sig.every((b,i)=>buffer[i]===b)||buffer.toString('latin1',12,16)!=='IHDR')return null;return {width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20)};}
