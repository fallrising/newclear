const element = (id) => document.getElementById(id);
const states = {queued: '排隊中', provisioning: '建立隔離工作區', running: 'Agent 執行中', finalizing: '收集 diff 與執行檢查', succeeded: '完成', failed: '失敗', interrupted: '結果不確定，已停止自動執行', cancelling: '取消中', cancelled: '已取消'};
let csrf = '';
let runId = sessionStorage.getItem('fanz-current-run') || '';
let timer;
let selected = [];
let lastState = '';
let pendingSubmission = null;
try { pendingSubmission = JSON.parse(sessionStorage.getItem('fanz-submission') || 'null'); }
catch { pendingSubmission = {unknown: true}; }
let lockedSubmission = Boolean(pendingSubmission && (pendingSubmission.unknown || typeof pendingSubmission.runId !== 'string' || !pendingSubmission.runId));
if (lockedSubmission) element('submit-status').textContent = '已有提交紀錄待對帳；重新整理不會重送。';
let finalDiff = null;
let authenticated = false;
let currentRun = null;
let durableReady = false;
let durableBlocked = false;
let recoveryRequest = 0;
let submissionGeneration = 0;
let fallbackRunId = '';
element('submit-task').disabled = true;
let recentRequest = 0;
function reasonText(reason) {
  if (!reason) return '';
  if (reason === 'operator_cancelled') return '已要求取消；是否停止以工作區清理狀態為準。';
  if (/deadline|timeout/.test(reason)) return '任務已逾時；未確認的執行不會自動重送。';
  if (reason === 'verification_failed') return '程式檢查未通過，請查看 diff 與檢查結果。';
  if (/subscription|provider|agent/.test(reason)) return 'Agent 執行結果尚未確認，請對帳或取消；不會自動重送。';
  return '執行受阻，請對帳目前任務；不會自動重送。';
}

async function api(path, {method = 'GET', body, key, text = false} = {}) {
  const headers = {Accept: 'application/json'};
  if (method !== 'GET') {
    headers['X-CSRF-Token'] = csrf;
    if (key) headers['Idempotency-Key'] = key;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`/api/v1${path}`, {method, headers, credentials: 'same-origin', cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body)});
  if (!response.ok) {
    if (response.status === 401) { authenticated = false; clearTimeout(timer); showLogin(); }
    const error = new Error(`請求失敗（${response.status}）；請重新讀取狀態。`); error.status = response.status; throw error;
  }
  return response.status === 204 ? null : text ? response.text() : response.json();
}
function fail(error) { element('error-message').textContent = error.message || '連線失敗'; }
function showLogin() {
  element('login-panel').hidden = authenticated;
  element('task-panel').hidden = !authenticated;
  element('connection-status').textContent = authenticated ? '已登入私人工作區' : '請登入私人工作區';
}
function updateSelection() {
  element('base-sha').textContent = selected[Number(element('project').value)]?.base_sha || '';
}
async function catalog() {
  const [projects, profiles, runtime] = await Promise.all([api('/projects'), api('/agent-profiles'), api('/runtime')]);
  selected = projects.items.flatMap(project => runtime.repositories.filter(r => r.canonical_repo === project.canonical_repo).map(r => ({...r, project_id: project.id, name: project.name})));
  element('project').replaceChildren(...selected.map((item, index) => new Option(`${item.name} · ${item.base_sha.slice(0, 12)}`, String(index))));
  const agents = profiles.items.filter(p => ['claude-subscription', 'codex-subscription'].includes(p.backend));
  element('agent').replaceChildren(...agents.map(p => new Option(p.name, p.id)));
  element('submit-task').disabled = true;
  await recoverSubmissions();
  updateSelection();
  await recent();
}
function updateSubmitLock() {
  const localUnknown = Boolean(pendingSubmission && (pendingSubmission.unknown || typeof pendingSubmission.runId !== 'string' || !pendingSubmission.runId));
  lockedSubmission = !durableReady || durableBlocked || localUnknown;
  element('submit-task').disabled = lockedSubmission || !selected.length || !element('agent').options.length;
}
async function recoverSubmissions() {
  const requested = ++recoveryRequest;
  durableReady = false; updateSubmitLock();
  const saved = await api('/submissions');
  if (requested !== recoveryRequest || !authenticated) return;
  if (!Array.isArray(saved.items) || typeof saved.blocked !== 'boolean') throw new Error('提交紀錄無法確認；請重新讀取。');
  durableBlocked = saved.blocked;
  const matching = saved.items.find(item => item.key === pendingSubmission?.key);
  if (matching?.state === 'confirmed' && matching.receipt?.run?.id) {
    pendingSubmission = {key: matching.key, runId: matching.receipt.run.id};
    sessionStorage.setItem('fanz-submission', JSON.stringify(pendingSubmission));
  } else if (matching?.state === 'rejected') {
    pendingSubmission = null; sessionStorage.removeItem('fanz-submission');
  }
  element('submission-history').replaceChildren(...saved.items.map(item => {
    const entry = document.createElement('li');
    const label = `${item.request?.title || '提交'} · ${item.state === 'confirmed' ? '已受理' : item.state === 'rejected' ? '已拒絕' : '待對帳，不會重送'}`;
    if (item.state === 'confirmed' && item.receipt?.run?.id) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'quiet'; button.textContent = label;
      button.addEventListener('click', () => observe(item.receipt.run.id)); entry.append(button);
    } else { entry.textContent = label; }
    return entry;
  }));
  durableReady = true; updateSubmitLock();
  if (lockedSubmission) element('submit-status').textContent = '已有提交紀錄待對帳；重新整理不會重送。';
  else if (matching?.state === 'confirmed') element('submit-status').textContent = '任務已受理（從持久紀錄恢復）';
  fallbackRunId = saved.items.find(item => item.state === 'confirmed' && item.receipt?.run?.id)?.receipt.run.id || '';
  if (!runId && fallbackRunId) { runId = fallbackRunId; sessionStorage.setItem('fanz-current-run', runId); }
}
async function recent() {
  const requested = ++recentRequest;
  const tasks = await api('/tasks');
  if (requested !== recentRequest || !authenticated) return;
  element('recent-tasks').replaceChildren(...tasks.items.map(task => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'quiet';
    button.textContent = `${task.title} · ${states[task.state] || task.state}`;
    button.addEventListener('click', () => { observe(task.run_id); });
    item.append(button); return item;
  }));
}
function observe(id) {
  clearTimeout(timer); runId = id; sessionStorage.setItem('fanz-current-run', id);
  element('run-id').textContent = id; element('run-status').textContent = '讀取中';
  element('run-reason').textContent = ''; element('error-message').textContent = '';
  currentRun = null; element('cancel-run').disabled = true; element('cancel-status').textContent = '';
  lastState = ''; finalDiff = null; element('activity').textContent = '';
  element('diff-output').textContent = '尚無 diff'; element('download-diff').disabled = true;
  element('verification').textContent = '尚無檢查結果'; element('cleanup').textContent = '';
  void refresh().catch(error => { if (runId === id && authenticated) fail(error); });
}
async function refresh() {
  clearTimeout(timer);
  if (!authenticated || !runId) return;
  const requested = runId;
  let run;
  try { run = await api(`/runs/${requested}`); }
  catch (error) {
    if (error.status === 404 && requested === runId && authenticated && fallbackRunId && fallbackRunId !== requested) {
      const recovered = fallbackRunId; fallbackRunId = ''; observe(recovered); return;
    }
    throw error;
  }
  if (requested !== runId || !authenticated) return;
  element('run-id').textContent = run.id;
  currentRun = run;
  element('run-status').textContent = states[run.state] || run.state;
  element('run-reason').textContent = reasonText(run.reason);
  const terminal = ['succeeded', 'failed', 'cancelled'].includes(run.state);
  element('cancel-run').disabled = terminal || run.state === 'cancelling' || sessionStorage.getItem(`fanz-cancel-${run.id}`) !== null;
  if (run.fanz_history && Array.isArray(run.fanz_history.events)) {
    element('activity').textContent = (run.fanz_history.history_truncated ? '僅顯示最近保留的狀態紀錄\n' : '') + run.fanz_history.events.map(item => `#${item.cursor} · ${states[item.state] || item.state}`).join('\n');
  } else if (lastState !== `${run.state}:${run.state_version}`) {
    element('activity').textContent += `${new Date().toLocaleTimeString()} · ${states[run.state] || run.state}\n`;
    lastState = `${run.state}:${run.state_version}`;
  }
  const neverAllocated = run.state === 'cancelled' && run.cleanup_state === 'not_allocated';
  const cleanupComplete = run.cleanup_state === 'confirmed' || neverAllocated;
  element('cleanup').textContent = neverAllocated ? '任務已取消，未建立工作區' : run.cleanup_state === 'confirmed' ? '隔離工作區已停止並清理' : '隔離工作區清理尚未確認';
  if (run.result) {
    const checks = run.result.verification;
    element('verification').textContent = checks.status === 'passed' ? '檢查通過' : checks.status === 'failed' ? '檢查失敗' : '檢查結果不確定';
    element('diff-output').textContent = run.result.diff;
    finalDiff = run.result.diff;
    element('download-diff').disabled = false;
  }
  if (!['succeeded', 'failed', 'cancelled'].includes(run.state) || !cleanupComplete) {
    timer = setTimeout(() => { void refresh().catch(fail); }, 500);
  } else {
    if (pendingSubmission?.runId === run.id) {
      pendingSubmission = null; lockedSubmission = false; sessionStorage.removeItem('fanz-submission');
      updateSubmitLock();
    }
    await recent();
  }
}
element('login-form').addEventListener('submit', async (event) => {
  event.preventDefault(); element('error-message').textContent = ''; element('login').disabled = true;
  const body = {username: element('username').value, password: element('password').value};
  element('password').value = '';
  try {
    const session = await api('/session', {method: 'POST', body});
    csrf = session.csrf_token; authenticated = session.authenticated; showLogin(); await catalog(); await refresh();
  } catch (error) { fail(error); } finally { body.password = ''; element('login').disabled = false; }
});
element('task-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (lockedSubmission) return;
  const source = selected[Number(element('project').value)];
  if (!source) return;
  const key = crypto.randomUUID(); const generation = ++submissionGeneration;
  const selectedAtSubmit = runId;
  pendingSubmission = {key, unknown: true};
  sessionStorage.setItem('fanz-submission', JSON.stringify(pendingSubmission));
  lockedSubmission = true; element('submit-task').disabled = true; element('error-message').textContent = '';
  element('submit-status').textContent = '正在提交…';
  try {
    const value = await api('/tasks', {method: 'POST', key, body: {project_id: source.project_id, base_sha: source.base_sha, profile_revision: element('agent').value, title: element('title').value, goal: element('prompt').value}});
    if (generation !== submissionGeneration || !authenticated) return;
    pendingSubmission = {key, runId: value.run.id};
    sessionStorage.setItem('fanz-submission', JSON.stringify(pendingSubmission));
    updateSubmitLock();
    element('submit-status').textContent = '任務已受理'; if (runId === selectedAtSubmit) observe(value.run.id);
    try { await recent(); } catch (error) { fail(error); }
  } catch (error) {
    if (generation !== submissionGeneration || !authenticated) return;
    element('submit-status').textContent = '提交結果尚未確認。請從最近任務對帳；不會自動重送。'; fail(error);
    try { await recent(); } catch { /* The first uncertainty remains visible. */ }
  }
});
element('download-diff').addEventListener('click', async () => {
  if (!runId || finalDiff === null) return;
  const requested = runId;
  try {
    const diff = await api(`/runs/${requested}/result.diff`, {text: true});
    if (requested !== runId || diff !== finalDiff) throw new Error('diff 與目前任務不符，請重新讀取。');
    const url = URL.createObjectURL(new Blob([diff], {type: 'text/plain;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url; link.download = `run-${requested}.diff`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { fail(error); }
});
element('cancel-run').addEventListener('click', async () => {
  if (!currentRun || element('cancel-run').disabled) return;
  const requested = currentRun; const key = crypto.randomUUID();
  sessionStorage.setItem(`fanz-cancel-${requested.id}`, key); element('cancel-run').disabled = true;
  element('cancel-status').textContent = '正在要求取消…';
  try {
    await api(`/runs/${requested.id}/actions`, {method: 'POST', key, body: {action: 'cancel', expected_state_version: requested.state_version}});
    if (requested.id !== runId || !authenticated) return;
    element('cancel-status').textContent = '取消已受理；等待後端確認停止與清理。';
    await refresh();
  } catch (error) {
    if (requested.id !== runId || !authenticated) return;
    element('cancel-status').textContent = '取消結果尚未確認，請重新讀取狀態；不會自動重送。'; fail(error);
  }
});
element('refresh').addEventListener('click', () => { void (async () => { await recoverSubmissions(); await refresh(); })().catch(fail); });
element('project').addEventListener('change', updateSelection);
element('logout').addEventListener('click', async () => {
  try { await api('/session', {method: 'DELETE'}); authenticated = false; csrf = ''; durableReady = false; recoveryRequest++; submissionGeneration++; updateSubmitLock(); clearTimeout(timer); showLogin(); }
  catch (error) { fail(error); }
});
try {
  const session = await api('/session'); csrf = session.csrf_token; authenticated = session.authenticated; showLogin();
  if (authenticated) { await catalog(); await refresh(); }
} catch (error) { fail(error); }
