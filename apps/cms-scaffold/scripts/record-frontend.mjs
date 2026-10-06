import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const kinds = {'measure:bundle':'BUNDLE','measure:vitals':'VITALS','e2e:mock':'MOCK','test:visual':'VISUAL',e2e:'REAL'};
const surfaces = ['front','back','admin'];
function requireValue(ok, message) { if (!ok) throw new Error(message); }
function text(value, name, empty = false) { requireValue(typeof value === 'string' && (empty || value.length > 0), `${name} must be text`); }
function number(value, name, integer = false) { requireValue(Number.isFinite(value) && value >= 0 && (!integer || Number.isInteger(value)), `${name} must be a nonnegative ${integer?'integer':'number'}`); }
function array(value, name, count) { requireValue(Array.isArray(value) && (count === undefined || value.length === count), `${name} has an invalid count`); }
function equals(actual, expected, name) { requireValue(actual === expected, `${name} must equal ${expected}`); }
function relativeArtifact(value) { text(value,'artifact'); requireValue(!value.startsWith('/') && !value.includes('\\') && !value.split('/').includes('..'), 'artifact must be relative'); }
function strings(value, name) { array(value,name); requireValue(value.length>0,`${name} must not be empty`); value.forEach(v=>text(v,name)); }
function note(value) { text(value,'notes',true); }
function resultIs(value, passed) { equals(value.result,passed?'passed':'failed','result'); }

export function validateEnvelope(value) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value),'measurement must be an object');
  equals(value.schemaVersion,1,'schemaVersion');
  requireValue(typeof value.measuredAt==='string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value.measuredAt) && Number.isFinite(Date.parse(value.measuredAt)), 'measuredAt must be UTC ISO-8601');
  requireValue(typeof value.gitCommit==='string' && /^[a-f0-9]{40}$/.test(value.gitCommit),'gitCommit must be a full SHA');
  requireValue(typeof value.dirty==='boolean','dirty must be boolean');
  text(value.node,'node');
  requireValue(value.chromium===null || typeof value.chromium==='string' && value.chromium.length>0,'chromium must be a version or null');
  requireValue(Object.hasOwn(kinds,value.command),'unknown command');
  relativeArtifact(value.artifact);
  requireValue(['passed','failed'].includes(value.result),'result must be passed or failed');
  return value;
}

export function formatCell(value) { return String(value ?? '—').replace(/\|/g,'\\|').replace(/\r?\n|\r/g,' '); }
function row(cells) { return `| ${cells.map(formatCell).join(' | ')} |`; }
function prefix(v,id) { return [id,v.measuredAt,v.gitCommit,v.dirty?'yes':'no']; }
function ids(v,records) {
  const date=v.measuredAt.slice(0,10).replaceAll('-','');
  const expression=new RegExp(`^W5-${kinds[v.command]}-${date}-(\\d{2})$`);
  const numbers=records.map(r=>{const m=expression.exec(r.recordId);requireValue(m && +m[1]>0,'invalid record id');return +m[1];});
  numbers.forEach((n,i)=>requireValue(i===0 || n===numbers[i-1]+1,'record ids must be unique and consecutive'));
}
function bundleRows(v) {
  array(v.apps,'apps',3); ids(v,v.apps);
  v.apps.forEach((a,i)=>{
    equals(a.app,surfaces[i],'app order'); strings(a.roots,'roots'); strings(a.closureKeys,'closureKeys');
    array(a.files,'files'); requireValue(a.files.length>0,'files must not be empty');
    a.files.forEach(f=>{relativeArtifact(f.file);number(f.gzipBytes,'gzipBytes',true);});
    equals(new Set(a.files.map(f=>f.file)).size,a.files.length,'unique files');
    number(a.total,'total',true); equals(a.total,a.files.reduce((sum,f)=>sum+f.gzipBytes,0),'total');
    equals(a.limit,i===0?92160:163840,'limit'); equals(a.delta,a.total-a.limit,'delta'); note(a.notes);
  });
  resultIs(v,v.apps.every(a=>a.delta<=0));
  return v.apps.map(a=>row([...prefix(v,a.recordId),a.app,a.total,a.limit,a.delta,'npm run measure:bundle',v.artifact,a.delta<=0?'passed':'failed',a.notes]));
}
const targets=[['front','http://127.0.0.1:4173/album'],['front','http://127.0.0.1:4173/clinic'],['front','http://127.0.0.1:4173/projects'],['back','http://127.0.0.1:4174/'],['admin','http://127.0.0.1:4175/']];
function median(values) { return [...values].sort((a,b)=>a-b)[2]; }
function vitalsRows(v) {
  array(v.samples,'samples',25); array(v.summaries,'summaries',5); ids(v,v.summaries);
  const passes=[];
  v.summaries.forEach((s,i)=>{
    const [surface,url]=targets[i]; equals(s.surface,surface,'surface'); equals(s.url,url,'target');
    equals(s.viewport,'1280x800','viewport'); equals(s.networkCpu,'150ms/1.6Mbps/750Kbps/4x','throttle'); equals(s.runs,5,'runs');
    text(s.limits,'limits'); text(s.routeLog,'routeLog'); note(s.notes);
    const samples=v.samples.filter(x=>x.surface===surface && x.url===url);
    array(samples,'target samples',5);
    equals(new Set(samples.map(x=>x.run)).size,5,'distinct run numbers');
    samples.forEach(x=>{number(x.run,'run',true);requireValue(x.run>=1 && x.run<=5,'invalid run');number(x.cls,'cls');if(surface==='front')number(x.lcpMs,'lcpMs');else equals(x.lcpMs,null,'non-Front LCP');});
    equals(s.medianCls,median(samples.map(x=>x.cls)),'medianCls'); equals(s.maxCls,Math.max(...samples.map(x=>x.cls)),'maxCls');
    if(surface==='front') { equals(s.medianLcpMs,median(samples.map(x=>x.lcpMs)),'medianLcpMs'); equals(s.maxLcpMs,Math.max(...samples.map(x=>x.lcpMs)),'maxLcpMs'); }
    else {equals(s.medianLcpMs,null,'medianLcpMs');equals(s.maxLcpMs,null,'maxLcpMs');}
    passes.push(s.maxCls <= (surface==='front'?0.05:0.1) && (surface!=='front' || s.medianLcpMs<=2500 && s.maxLcpMs<=3125));
  });
  resultIs(v,passes.every(Boolean));
  return v.summaries.map((s,i)=>row([...prefix(v,s.recordId),s.surface,s.url,s.viewport,s.networkCpu,s.runs,s.medianLcpMs,s.maxLcpMs,s.medianCls,s.maxCls,s.limits,'npm run measure:vitals',v.artifact,passes[i]?'passed':'failed',`${s.routeLog}; ${s.notes}`]));
}
function mockRows(v) {
  requireValue([1,2,3].includes(v.repetition),'invalid repetition'); text(v.playwright,'playwright');
  number(v.passed,'passed',true); equals(v.total,93,'total'); requireValue(v.passed<=v.total,'passed exceeds total');
  const axe=[v.axePassed,v.axeTotal,v.critical,v.serious];
  if(axe.every(x=>x===null)) { /* An earlier repetition may precede the separate axe run. */ }
  else {axe.forEach(x=>number(x,'axe count',true));equals(v.axeTotal,60,'axeTotal');requireValue(v.axePassed<=60,'axePassed exceeds total');}
  note(v.notes); resultIs(v,v.passed===93 && (v.axeTotal===null || v.axePassed===60 && v.critical===0 && v.serious===0));
  return [row([...prefix(v,v.recordId),v.repetition,v.playwright,v.chromium,`${v.passed} / ${v.total}`,v.axeTotal===null?null:`${v.axePassed} / ${v.axeTotal}`,v.critical,v.serious,'npm run e2e:mock',v.artifact,v.result,v.notes])];
}
function visualRows(v) {
  text(v.os,'os'); equals(v.desktopCases,52,'desktopCases'); equals(v.mobileCases,15,'mobileCases'); equals(v.stateCases,3,'stateCases');
  equals(v.threshold,0.2,'threshold'); equals(v.maxDiffPixelRatio,0.001,'maxDiffPixelRatio'); relativeArtifact(v.hashManifest);text(v.authorization,'authorization');note(v.notes);
  return [row([...prefix(v,v.recordId),v.os,v.chromium,v.desktopCases,v.mobileCases,v.threshold,v.maxDiffPixelRatio,v.hashManifest,'npm run test:visual',v.artifact,v.result,`${v.authorization}; ${v.notes}`])];
}
function realRows(v) {
  number(v.attempt,'attempt',true);requireValue(v.attempt>=1,'attempt starts at one');
  for(const key of ['os','jdk','dockerCompose','stack'])text(v[key],key);
  number(v.passed,'passed',true);equals(v.total,14,'total');requireValue(v.passed<=14,'passed exceeds total');number(v.durationSeconds,'durationSeconds');number(v.exitCode,'exitCode',true);text(v.failureClass,'failureClass',true);note(v.notes);
  resultIs(v,v.exitCode===0 && v.passed===14);
  return [row([...prefix(v,v.recordId),v.attempt,v.os,v.jdk,v.dockerCompose,v.stack,`${v.passed} / ${v.total}`,v.durationSeconds,'npm run e2e',v.artifact,v.result,`${v.failureClass}; ${v.notes}`])];
}
export function rowsFor(value) {
  const v=validateEnvelope(value);
  if(v.command==='measure:bundle')return bundleRows(v);
  if(v.command==='measure:vitals')return vitalsRows(v);
  ids(v,[v]);
  if(v.command==='e2e:mock')return mockRows(v);
  if(v.command==='test:visual')return visualRows(v);
  return realRows(v);
}
export async function main(argv) {
  if(argv.length!==1) {process.exitCode=2;console.error('Usage: record-frontend.mjs <measurement.json>');return;}
  try { const rows=rowsFor(JSON.parse(await readFile(argv[0],'utf8'))); console.log(rows.join('\n')); }
  catch(error) { process.exitCode=1;console.error(error.message); }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))await main(process.argv.slice(2));
