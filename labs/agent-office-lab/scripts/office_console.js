'use strict';
const $=id=>document.getElementById(id), el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
const titles={opencode:'OpenCode',grok:'Grok',pi:'Pi',cursor:'Cursor'};
const models={opencode:'Strata · Qwen3.8 Flash Next Q2_0',grok:'grok-4.6',pi:'DeepSeek · deepseek-flash',cursor:'Composer 2.5'};
const labels={completed:'完成且產物已核對',failed:'失敗',stopped:'已停止',cancelled:'已取消',startup_only:'僅啟動檢查',incomplete:'尚無最終報告',unverified:'證據不足',invalid:'無效紀錄'};
const modes={text:'本地文字任務',task:'合成檔案任務',terminal:'合成任務＋保留原生終端',http_401:'本機 401 故障檢查',http_429:'本機 429 故障檢查',crash:'本機 CLI 崩潰檢查',cancel:'本機原生取消檢查',resume:'原生 session 重新連接檢查'};
const errors={project_text_unavailable:'來源目錄無法讀取，或超出文字檔限制。請查看登記目錄及操作說明。',unknown_project:'請先選擇已登記的工作目錄。',plan_changed:'來源檔案已變更，請重新查看計畫。',cleanup_unconfirmed:'上次執行的清理尚未確認。請先核對所屬程序，再依 CLI 流程確認；重啟頁面不會解除阻擋。',execution_state_unavailable:'無法確認共用執行狀態，暫停派工。請檢查本機狀態檔與權限。',forbidden:'連線未授權。請使用啟動時顯示的登入網址。',execution_busy:'已有工作執行中。請等候清理完成。',plan_expired_or_used:'計畫已使用或逾時，請重新查看計畫。',remote_execution_requires_cli:'遠端付費執行需使用已授權的 CLI 流程。',retry_limit_reached:'此任務已用完兩次重試。',retry_requires_latest_attempt:'請選擇這個任務最新的失敗紀錄。',retry_source_changed:'執行程式已更新，此舊紀錄不能直接重試。',retry_history_unavailable_or_invalid:'這筆紀錄沒有可驗證的重試歷史。',retry_requires_clean_failed_run:'只有已失敗且清理完成的任務可以重試。'};
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.get('token')){sessionStorage.setItem('office-token',fragment.get('token'));history.replaceState(null,'',location.pathname);}
let token=sessionStorage.getItem('office-token')||'',provider='opencode',currentPlan=null,state=null,fetching=false,planGeneration=0,jobsSignature='',runsSignature='';
async function api(path,data){
 const response=await fetch(path,{method:data===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)}),cache:'no-store'});
 const value=await response.json();if(!response.ok)throw new Error(errors[value.error]||'目前無法執行此操作。請檢查環境或紀錄後再試。');return value;
}
function executionBlocked(){return !!state?.active_job||state?.shared_execution?.status!=='available';}
function showExecution(){
 const status=state?.shared_execution?.status||'unavailable',owned=!!state?.active_job;
 const text=owned?['本操作台有工作執行中','請等待工作清理完成，或使用下方的停止按鈕。']:status==='available'?['可以開始一項工作','沒有偵測到持鎖工作或尚未確認的中斷紀錄。']:status==='busy'?['其他入口有工作執行中','請回到啟動該工作的終端或操作台查看。此頁不接管或停止它，也不會重送任務。']:status==='cleanup_unconfirmed'?['上次執行的清理尚未確認','重啟不會解除阻擋。請先核對所有所屬程序已退出，再依 CLI 的中斷確認流程處理；原紀錄會保留。']:['無法確認執行狀態','暫停派工。請檢查本機狀態檔與權限；請勿直接刪除中斷紀錄。'];
 $('execution-state').dataset.state=owned?'owned':status;$('execution-title').textContent=text[0];$('execution-note').textContent=text[1];
}
function message(text){$('message').textContent=text;}
function invalidate(){planGeneration++;currentPlan=null;$('plan-card').hidden=true;}
function selectProvider(next){
 provider=next;invalidate();$('selected').textContent=titles[provider];$('model').textContent=models[provider];
 for(const button of $('providers').children)button.setAttribute('aria-pressed',String(button.dataset.provider===provider));
 $('mode').replaceChildren();
 const available=provider==='opencode'?['task','terminal','text']:provider==='pi'?['task','http_401','http_429','crash','cancel','resume']:['task'];
 for(const mode of available){const option=el('option',modes[mode]);option.value=mode;$('mode').append(option);}
 updateNote();showCheck();
}
function updateNote(){invalidate();const mode=$('mode').value;$('text-fields').hidden=mode!=='text';$('mode-note').textContent=mode==='text'?'使用本地 Strata 閱讀文字檔，依你的要求產生一份可下載的文件。':mode==='terminal'?'任務完成後保留本地模型與原生終端，直到你停止執行。':mode==='resume'?'用本機錯誤建立歷史，再明確接回同一 session；不重送任務、不呼叫模型。':mode==='cancel'?'讓真實 Pi 等待本機請求，再驗證原生取消；不呼叫模型。':mode.startsWith('http_')||mode==='crash'?'使用真實 Pi CLI 與本機故障，不呼叫模型。':provider==='opencode'?'使用本機 Strata，讀取合成 input.json 並寫入 result.json。':'此工位目前可查看計畫，頁面不啟動付費任務。';}
function showCheck(){const check=state?.checks[provider];$('check').textContent=!check?'尚未檢查環境。':!check.cli_compatible?'CLI 缺失或版本不相容。':!Object.values(check.runtime).every(Boolean)?'CLI 相容；執行環境尚未齊備。':check.credentials==='not_required'?'本地 CLI 與 Strata 環境已就緒，不需要遠端登入。':check.credentials==='missing'?'CLI 與環境就緒；尚無登入資料。Pi 本機故障檢查不需要登入。':check.credentials!=='present_unverified'?'CLI 與環境就緒；登入資料尚需處理。':'CLI 與環境就緒。登入資料存在不代表已驗證帳號或取得付費授權。';}
async function makePlan(selection){
 const generation=++planGeneration;
 try{message('');const received=await api('/api/plan',selection);if(generation!==planGeneration)return;currentPlan=received;const p=currentPlan.plan;$('plan-fields').replaceChildren();
  for(const [name,value] of [['工位',titles[p.provider]],['模型',p.model],['執行位置',p.remote?'遠端服務':'本機'],['操作',p.retry_of?`明確重試 ${p.attempt} / 2`:modes[selection.mode]]])$('plan-fields').append(el('dt',name),el('dd',value));
  if(p.task==='local_text')for(const [name,value]of [['來源',p.project],['任務',p.prompt],['讀取檔案',p.source_files.join('、')],['交付檔案',p.output]])$('plan-fields').append(el('dt',name),el('dd',value));
  $('plan-note').textContent=p.task==='local_text'?'使用上述檔案的副本；原目錄保留不動。完成後請檢查產物內容。':p.remote?'此計畫需另行取得付費授權，請使用 CLI 執行。':p.keep_open?'本地模型會持續載入，完成操作後請按「停止執行」。':'只啟動這一次，不會自動重試或切換模型。';
  $('execute').disabled=!currentPlan.executable||executionBlocked();$('plan-card').hidden=false;
 }catch(e){message(e.message);}
}
const resultLabel=run=>run.task_kind==='local_text'&&run.status==='completed'?'已產生文件，待確認':labels[run.status];
function showDetail(run){const d=$('detail');d.replaceChildren(el('h3',`${titles[run.provider]||run.provider} · ${resultLabel(run)}`),el('p',run.id),el('p',`模型：${run.model||'未記錄'}；清理：${run.cleanup_verified?'已確認':'尚未確認'}`));
 if(run.test_scenario==='native_pi_resume')d.append(el('p',run.resume_check_passed?'同 session 重新連接驗收通過；原任務未完成，沒有模型推論。':'重新連接驗收尚未通過。'));
 else if(run.test_scenario==='native_pi_cancel')d.append(el('p',run.cancel_check_passed?'原生取消驗收通過，沒有模型推論。':'取消驗收尚未通過，沒有模型推論。'));
 else if(run.test_scenario)d.append(el('p','本機故障注入；沒有模型推論。'),el('p',run.failure_check_passed?'故障驗收通過，任務仍為失敗。':'故障驗收證據不足。'));
 if(run.retry)d.append(el('p',`原始紀錄：${run.retry.root}；${run.retry.attempt===0?'首次執行':`明確重試 ${run.retry.attempt} / 2`}`));
 if(run.task_kind==='local_text')d.append(el('p','本地文字任務；執行狀態與檔案 hash 已核對，內容仍需你確認。'));
 if(run.artifact.kind==='text'&&run.artifact.status==='verified'){d.append(el('h3','output.md'),el('pre',run.artifact.text),el('p',`SHA-256：${run.artifact.sha256}`));const download=el('button','下載 output.md');download.className='download';download.onclick=()=>{const url=URL.createObjectURL(new Blob([run.artifact.text],{type:'text/plain;charset=utf-8'})),a=el('a','');a.href=url;a.download='output.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};d.append(download);}
 else if(run.artifact.content)d.append(el('pre',JSON.stringify(run.artifact.content,null,2)),el('p',`SHA-256：${run.artifact.sha256}`));else d.append(el('p','沒有可顯示的已核對產物。'));
 const close=el('button','關閉詳細內容');close.className='quiet';close.onclick=()=>d.hidden=true;d.append(close);d.hidden=false;d.focus();
}
function renderRuns(){if(!state)return;const signature=JSON.stringify([state.results.runs,$('filter').value]);if(signature===runsSignature)return;runsSignature=signature;const rows=state.results.runs.filter(r=>$('filter').value==='all'||r.provider===$('filter').value);$('count').textContent=`${rows.length} 筆紀錄 · 更新頁面不會重跑任務`;$('runs').replaceChildren();
 for(const run of rows){const tr=el('tr',''),agent=el('td',titles[run.provider]||run.provider);agent.append(el('small',run.model||'未記錄模型'));const id=el('td',run.id);if(run.retry)id.append(el('small',run.retry.attempt?`明確重試 ${run.retry.attempt} / 2`:'首次執行'));
 const status=el('td',resultLabel(run));if(run.status==='completed')status.className='success';const actions=el('td',''),detail=el('button','查看結果');detail.className='quiet';detail.onclick=()=>showDetail(run);actions.append(detail);
 if(run.provider==='pi'&&run.status==='failed'&&run.retry&&run.id.startsWith('1:')){const retry=el('button','重試計畫');retry.className='quiet';retry.onclick=()=>{selectProvider('pi');makePlan({retry_id:run.id.slice(2)});$('plan-card').scrollIntoView({block:'nearest'});};actions.append(retry);}
 tr.append(agent,id,status,actions);$('runs').append(tr);}
}
function renderJobs(){const signature=JSON.stringify(state.jobs);if(signature===jobsSignature)return;jobsSignature=signature;const jobs=$('jobs');jobs.replaceChildren();if(!state.jobs.length){const empty=el('p','目前沒有從此操作台啟動的工作。');empty.className='empty';jobs.append(empty);}
 for(const job of state.jobs){const box=el('article','');box.className='job';box.dataset.job=job.id;box.dataset.phase=job.phase;box.append(el('strong',titles[job.provider]),el('small',job.run_id||'正在準備執行環境'));
 box.append(el('p',job.phase==='stopping'?'正在停止與清理，請稍候。':job.terminal_url?'原生終端已就緒；本地模型保持載入。':job.phase==='running'?'正在執行，完成後會顯示核對結果。':job.result?resultLabel(job.result):'執行已退出，尚無可核對報告。'));
 if(job.terminal_url){const a=el('a','開啟原生終端');const opened=`office-terminal-${job.id}`;const login=new URL(job.terminal_url);login.search='?next=/lite';a.href=sessionStorage.getItem(opened)?new URL('/lite',login).href:login.href;a.onclick=()=>{sessionStorage.setItem(opened,'1');jobsSignature='';};a.target='_blank';a.rel='noopener noreferrer';a.className='terminal';box.append(a);}
 if(job.phase!=='finished'){const stop=el('button','停止執行');stop.className='stop';stop.disabled=job.phase==='stopping';stop.onclick=async()=>{stop.disabled=true;try{await api('/api/stop',{job_id:job.id});await refresh();}catch(e){message(e.message);}};box.append(stop);}
 if(job.result&&job.phase==='finished'){const button=el('button','查看本次結果');button.className='quiet';button.onclick=()=>showDetail(job.result);box.append(button);}jobs.append(box);}
}
async function refresh(){if(fetching)return;fetching=true;try{state=await api('/api/state');const projects=state.projects||[],signature=JSON.stringify(projects);if($('project').dataset.signature!==signature){const selected=$('project').value;$('project').replaceChildren();for(const p of projects){const option=el('option',p.name);option.value=p.id;$('project').append(option);}if(projects.some(p=>p.id===selected))$('project').value=selected;$('project').dataset.signature=signature;} $('project-help').textContent=projects.length?'只讀取已登記目錄的支援文字檔。':'尚未登記來源目錄。啟動操作台時使用 --project 指定文字檔目錄。';showExecution();showCheck();renderJobs();renderRuns();if(currentPlan)$('execute').disabled=!currentPlan.executable||executionBlocked();}catch(e){state=null;showExecution();$('execute').disabled=true;message(e.message);}finally{fetching=false;}}
for(const [id,title]of Object.entries(titles)){const b=el('button','');b.className='provider';b.dataset.provider=id;b.append(el('strong',title),el('small',id==='opencode'?'本地模型':id==='pi'?'遠端模型 / 本機故障驗收':'遠端模型'));b.onclick=()=>selectProvider(id);$('providers').append(b);}
$('mode').onchange=updateNote;$('filter').onchange=renderRuns;$('refresh').onclick=refresh;
$('project').onchange=invalidate;$('prompt').oninput=invalidate;
$('plan').onclick=()=>makePlan({provider,mode:$('mode').value,...($('mode').value==='text'?{project:$('project').value,prompt:$('prompt').value}:{})});
$('detect').onclick=async()=>{const target=provider;$('detect').disabled=true;try{message('正在檢查 CLI 與執行環境…');await api('/api/detect',{provider:target});message('環境檢查完成。');await refresh();}catch(e){message(e.message);}finally{$('detect').disabled=false;}};
$('execute').onclick=async()=>{if(!currentPlan)return;const chosen=currentPlan;invalidate();$('execute').disabled=true;try{await api('/api/execute',{plan_id:chosen.plan_id});message('已啟動。重新整理或關閉分頁都不會重送任務。');await refresh();}catch(e){message(e.message);}};
selectProvider('opencode');refresh();setInterval(refresh,2000);
