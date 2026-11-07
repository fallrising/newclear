// Shared wire validation: browser preview and Worker admission use the same rules.
export const INVENTORY_LIMIT = 24576;
const KINDS = ['zones','workers','worker_domains','pages','tunnels','access_apps'];
const ISSUES = ['unexpected','missing','inactive','invalid_status'];
const fail = () => { throw Object.assign(new Error('盤點報告格式或大小無效。'), {code:'INVENTORY_INVALID'}); };
const requireValue = ok => { if (!ok) fail(); };
const fields = (v, keys) => requireValue(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === keys.slice().sort().join(','));
function label(v, min, max) {
 requireValue(typeof v === 'string' && [...v].length >= min && [...v].length <= max && !/[\u0000-\u001f\u007f-\u009f\p{Cs}]/u.test(v));
 return v;
}
const utc = v => {
 if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(v)) return NaN;
 const n=Date.parse(v);return Number.isFinite(n) && new Date(n).toISOString().replace('.000Z','Z')===v ? n : NaN;
};
export function validateInventory(v) {
 fields(v,['schema_version','source','started_at','observed_at','sections']);
 requireValue(v.schema_version==='cloudlab.inventory.v1' && new TextEncoder().encode(JSON.stringify(v)).length<=INVENTORY_LIMIT);
 fields(v.source,['id','revision']);requireValue(v.source.id==='cf-inventory' && /^sha256:[a-f0-9]{64}$/.test(v.source.revision));
 const start=utc(v.started_at),end=utc(v.observed_at);requireValue(Number.isFinite(start)&&Number.isFinite(end)&&start<=end&&end-start<=3600000);
 requireValue(Array.isArray(v.sections)&&v.sections.length===KINDS.length);let count=0;
 const sections=v.sections.map((s,i)=>{
  fields(s,['kind','state','error','resources']);requireValue(s.kind===KINDS[i]&&Array.isArray(s.resources));
  requireValue(s.state==='readable' ? s.error===null : s.state==='unreadable'&&s.resources.length===0&&typeof s.error==='string'&&/^(HTTP_[45][0-9]{2}|NETWORK_ERROR|INVALID_RESPONSE|PAGINATION_INCOMPLETE|LIMIT_EXCEEDED|CREDENTIAL_UNAVAILABLE)$/.test(s.error));
  count+=s.resources.length;requireValue(count<=200);const names=new Set();
  const resources=s.resources.map(r=>{
   fields(r,['name','use','present','status','drift']);label(r.name,1,253);label(r.use,0,160);requireValue(!names.has(r.name));names.add(r.name);
   requireValue(typeof r.present==='boolean');
   if(s.kind==='zones'&&r.present)label(r.status,1,32);else requireValue(r.status===null);
   requireValue(Array.isArray(r.drift)&&r.drift.length<=4&&new Set(r.drift).size===r.drift.length&&r.drift.every(x=>ISSUES.includes(x)));
   requireValue(r.present ? !r.drift.includes('missing') : r.drift.includes('missing'));
   requireValue(!r.drift.includes('unexpected')||r.present);
   requireValue(!r.drift.includes('inactive')||(s.kind==='zones'&&r.present&&r.status!=='active'));
   requireValue(!r.drift.includes('invalid_status')||s.kind==='zones');
   return {name:r.name,use:r.use,present:r.present,status:r.status,drift:ISSUES.filter(x=>r.drift.includes(x))};
  }).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  return {kind:s.kind,state:s.state,error:s.error,resources};
 });
 return {schema_version:v.schema_version,source:{id:v.source.id,revision:v.source.revision},started_at:v.started_at,observed_at:v.observed_at,sections};
}
export function inventoryView(snapshot, now, confirmed=true) {
 if(!snapshot?.report)return {state:'empty',label:'尚未上傳盤點報告',driftCount:0,unreadableCount:0};
 try {
  const report=validateInventory(snapshot.report),time=utc(now),observed=utc(report.observed_at),received=utc(snapshot.received_at);
  requireValue(Number.isFinite(time)&&Number.isFinite(received)&&observed<=time&&received<=time);
  const unreadableCount=report.sections.filter(s=>s.state==='unreadable').length;
  const driftCount=report.sections.reduce((n,s)=>n+s.resources.filter(r=>r.drift.length).length,0);
  const state=!confirmed?'unconfirmed':time-observed>86400000?'stale':unreadableCount?'partial':'recorded';
  const labels={unconfirmed:'上次讀取的報告 · 連線未確認',stale:'盤點已過期（超過24小時）',partial:'部分區段無法讀取',recorded:'已保存盤點（不是健康判斷）'};
  return {state,label:labels[state],report,driftCount,unreadableCount};
 }catch{return {state:'unknown',label:'報告或時間無法確認',driftCount:0,unreadableCount:0};}
}
const TITLES={zones:'網域',workers:'Workers',worker_domains:'Worker入口',pages:'Pages',tunnels:'Tunnel',access_apps:'Access應用'};
const DRIFT={unexpected:'未登記',missing:'期望項未觀測到',inactive:'網域未active',invalid_status:'期望狀態無效'};
export function renderInventory(document,snapshot,now,confirmed=true){
 const make=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
 const root=document.createElement('div'),v=inventoryView(snapshot,now,confirmed);
 root.append(make('p',v.label));if(!v.report)return root;
 root.append(make('p',`觀測 ${v.report.observed_at} · 收集開始 ${v.report.started_at} · 保存 ${snapshot.received_at}`),make('p',`來源 ${v.report.source.id} · ${v.report.source.revision}`),make('p',`${v.driftCount}項資源有差異 · ${v.unreadableCount}個區段未知`));
 for(const s of v.report.sections){const section=document.createElement('section');section.append(make('h3',TITLES[s.kind]));
  if(s.state==='unreadable')section.append(make('p',`未知：無法讀取（${s.error}）`));
  else if(!s.resources.length)section.append(make('p','已讀取，沒有資源或期望項目'));
  else {const list=document.createElement('ul');for(const r of s.resources)list.append(make('li',`${r.name} — ${r.use||'用途未填'} · ${r.present?'已觀測到':'此次盤點未列出'}${r.status?' · provider狀態 '+r.status:''} · ${r.drift.map(x=>DRIFT[x]).join('、')||'與清單一致'}`));section.append(list);}
  root.append(section);
 }
 return root;
}

export function inventoryPanel(document,client,context,onAuthError){
 const box=document.getElementById('inventory'),read=document.getElementById('inventory-refresh'),upload=document.getElementById('inventory-upload'),file=document.getElementById('inventory-file'),note=document.getElementById('inventory-message');
 let snapshot=null,busy=false,confirmed=false,version=0,key='',message='';
 const current=()=>context();
 const allowed=(c,cap)=>c.bootstrap?.capabilities?.includes(cap)===true;
 function clear(){version++;snapshot=null;busy=false;confirmed=false;message='';file.value='';box.replaceChildren();}
 function render(){const c=current(),next=JSON.stringify([c.bootstrap?.workspace_id,c.revision]);
  if(next!==key||!allowed(c,'inventory:read')){clear();key=next;}
  const canRead=allowed(c,'inventory:read');read.disabled=busy||!c.confirmed||!canRead;
  upload.disabled=busy||!c.confirmed||!canRead||!allowed(c,'inventory:publish');file.disabled=upload.disabled;
  note.textContent=message||(!canRead?'尚未授予盤點讀取權限。':'手動讀取或選擇報告後上傳，不會執行資源操作。');
  box.replaceChildren(renderInventory(document,snapshot,c.now,confirmed&&c.confirmed));
 }
 async function run(publish=false){render();if((publish?upload:read).disabled)return;const token=version;busy=true;message='';render();
  try{let data;
   if(publish){const selected=file.files?.[0];if(!selected||selected.size>INVENTORY_LIMIT)fail();const raw=await selected.text();if(token!==version)return;validateInventory(JSON.parse(raw));data=await client.publishInventory(raw);}
   else data=await client.inventory();
   if(token!==version)return;
   requireValue(data?.schema_version==='cloudlab.inventory-snapshot.v1'&&data.workspace_id===current().bootstrap?.workspace_id);
   if(data.report===null){requireValue(!publish&&data.received_at===null&&data.digest===null);}
   else {validateInventory(data.report);requireValue(Number.isFinite(utc(data.received_at))&&typeof data.digest==='string'&&/^sha256:[a-f0-9]{64}$/.test(data.digest));}
   requireValue(Number.isFinite(utc(data.now)));
   snapshot=data;confirmed=true;message=publish?'報告已保存。':'報告已讀取。';
  }catch(error){if(token!==version)return;confirmed=false;message='盤點操作未完成；'+(error.status===409?'較新或同時間不同報告已存在，請重新讀取。':error.status===401||error.status===403?'授權未確認。':'請檢查連線、報告格式或服務狀態。');if(error.status===401||error.status===403)onAuthError(error);}
  finally{if(token===version){busy=false;render();}}
 }
 read.addEventListener('click',()=>run());upload.addEventListener('click',()=>run(true));
 return {render,clear,refresh:()=>run(),publish:()=>run(true)};
}
