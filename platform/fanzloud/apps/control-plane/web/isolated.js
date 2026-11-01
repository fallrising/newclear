import {readCandidate, readReview, reviewResult} from './candidate.js';
const element = (id) => document.getElementById(id);
const states = {queued: '排隊中', provisioning: '建立隔離工作區', running: 'Agent 執行中', finalizing: '收集 diff 與執行檢查', succeeded: '完成', failed: '失敗', interrupted: '結果不確定，已停止自動執行', cancelling: '取消中', cancelled: '已取消'};
let csrf = '';
let runId = sessionStorage.getItem('fanz-current-run') || '';
let timer;
let selected = [];
let agents = [];
let lastState = '';
let pendingSubmission = null;
try { pendingSubmission = JSON.parse(sessionStorage.getItem('fanz-submission') || 'null'); }
catch { pendingSubmission = {unknown: true}; }
let lockedSubmission = Boolean(pendingSubmission && (pendingSubmission.unknown || typeof pendingSubmission.runId !== 'string' || !pendingSubmission.runId));
if (lockedSubmission) element('submit-status').textContent = '已有提交紀錄待對帳；重新整理不會重送。';
let finalDiff = null;
let authenticated = false;
let currentRun = null;
let candidate = null;
let candidateGeneration = 0;
let candidateLoading = false;
function clearCandidate() {
  candidateGeneration++; candidate = null; candidateLoading = false;
  element('candidate-status').textContent = '尚未取得固定候選；審查尚未開始。';
  element('download-candidate').disabled = true;
  element('load-candidate').disabled = true;
  element('start-review').disabled = true;
  element('start-rework').disabled = true;
  element('download-review').disabled = true;
  element('review-status').textContent = '尚無審查結果';
}
clearCandidate();
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
  if (!authenticated) clearCandidate();
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
  agents = profiles.items.filter(p => ['claude-subscription', 'codex-subscription'].includes(p.backend));
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
  updateHandoff();
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
    const label = `${item.request?.title || (item.request?.route?.endsWith('/reviews') ? '審查' : item.request?.route?.endsWith('/rework') ? '返工' : '提交')} · ${item.state === 'confirmed' ? '已受理' : item.state === 'rejected' ? '已拒絕' : '待對帳，不會重送'}`;
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
  clearCandidate();
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
  element('load-candidate').disabled = candidateLoading || run.state !== 'succeeded' || typeof run.result?.diff !== 'string';
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
    finalDiff = typeof run.result.diff === 'string' ? run.result.diff : null;
    element('diff-output').textContent = finalDiff ?? '此任務為唯讀審查；未產生程式 diff。';
    element('download-diff').disabled = finalDiff === null;
  }
  renderReview(); updateHandoff();
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
element('load-candidate').addEventListener('click', async () => {
  if (!authenticated || !currentRun || element('load-candidate').disabled) return;
  const run = currentRun; clearCandidate(); const generation = candidateGeneration;
  candidateLoading = true; element('candidate-status').textContent = '正在核對固定成果…';
  try {
    const loaded = await readCandidate(run, api);
    if (generation !== candidateGeneration || !authenticated || run.id !== runId) return;
    candidate = loaded;
    element('candidate-status').textContent = `候選 SHA256：${loaded.sha256}\n來源 base：${loaded.base_sha}\nWriter profile：${loaded.profile_revision}\nDiff SHA256：${loaded.diff_sha256}\n檢查結果：${JSON.stringify(loaded.verification, null, 2)}\n此候選包含原任務、diff 與檢查結果；審查尚未開始。`;
    element('download-candidate').disabled = false; updateHandoff();
  } catch {
    if (generation === candidateGeneration && authenticated && run.id === runId) element('candidate-status').textContent = '固定審查候選無法確認；未開始審查，請重新讀取。';
  } finally {
    if (generation === candidateGeneration && authenticated && run.id === runId) {
      candidateLoading = false; element('load-candidate').disabled = false;
    }
  }
});
element('download-candidate').addEventListener('click', async () => {
  if (!authenticated || !candidate || candidate.run_id !== runId || element('download-candidate').disabled) return;
  const saved = candidate, run = currentRun, generation = candidateGeneration;
  element('download-candidate').disabled = true;
  try {
    // Reauthorize and enforce archive expiry again; cached bytes cannot bypass AP.
    const checked = await readCandidate(run, api);
    if (generation !== candidateGeneration || !authenticated || saved.run_id !== runId) return;
    if (checked.sha256 !== saved.sha256 || checked.raw !== saved.raw) throw new Error('candidate changed');
    const url = URL.createObjectURL(new Blob([saved.raw], {type: 'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = `candidate-${saved.sha256}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    element('download-candidate').disabled = false; updateHandoff();
  } catch {
    if (generation === candidateGeneration && authenticated && saved.run_id === runId) {
      clearCandidate(); element('load-candidate').disabled = false;
      element('candidate-status').textContent = '固定審查候選無法確認；未下載，請重新讀取。';
    }
  }
});
function updateHandoff() {
  const prior = element('review-agent').value;
  const options = agents.filter(p => currentRun && p.backend !== currentRun.backend && ['claude-subscription','codex-subscription'].includes(currentRun.backend));
  element('review-agent').replaceChildren(...options.map(p => new Option(p.name, p.id)));
  if (options.some(p => p.id === prior)) element('review-agent').value = prior;
  element('start-review').disabled = !authenticated || lockedSubmission || !candidate || candidate.run_id !== runId || !options.length || currentRun?.purpose === 'review';
  let rework = false;
  try { rework = reviewResult(currentRun).verdict === 'request_changes' && currentRun.review_context.review_round === 1; } catch { /* Not an eligible review result. */ }
  element('start-rework').disabled = !authenticated || lockedSubmission || !rework;
}
function renderReview() {
  element('download-review').disabled = true;
  if (currentRun?.purpose !== 'review') return;
  const context = currentRun.review_context;
  element('review-status').textContent = `審查第 ${context?.review_round || '?'} 輪 · ${states[currentRun.state] || currentRun.state}\n候選 SHA256：${context?.candidate_sha256 || '尚未確認'}`;
  if (currentRun.state !== 'succeeded') return;
  try {
    const result = reviewResult(currentRun);
    const verdicts = {accept:'接受候選', request_changes:'要求返工', reject:'拒絕候選'};
    element('review-status').textContent += `\n判定：${verdicts[result.verdict]}\n${result.reasons.join('\n')}\n此判定不會自動結案。`;
    element('download-review').disabled = false;
  } catch { element('review-status').textContent = '審查成果綁定無法確認；未接受判定。'; }
}
async function handoff(action) {
  updateHandoff();
  if (element(action === 'reviews' ? 'start-review' : 'start-rework').disabled) return;
  const source = currentRun, selectedAtSubmit = runId, key = crypto.randomUUID(), generation = ++submissionGeneration;
  const body = action === 'reviews' ? {artifact_id:candidate.artifact_id,candidate_sha256:candidate.sha256,profile_revision:element('review-agent').value} : {};
  pendingSubmission = {key, unknown:true}; sessionStorage.setItem('fanz-submission', JSON.stringify(pendingSubmission)); updateSubmitLock();
  element('submit-status').textContent = action === 'reviews' ? '正在提交唯讀審查…' : '正在提交有界返工…';
  try {
    const value = await api(`/runs/${source.id}/${action}`, {method:'POST', key, body});
    if (generation !== submissionGeneration || !authenticated) return;
    pendingSubmission = {key,runId:value.run.id}; sessionStorage.setItem('fanz-submission',JSON.stringify(pendingSubmission)); updateSubmitLock();
    element('submit-status').textContent = '交接已受理'; if (runId === selectedAtSubmit) observe(value.run.id);
    try { await recent(); } catch (error) { fail(error); }
  } catch (error) {
    if (generation !== submissionGeneration || !authenticated) return;
    element('submit-status').textContent = '交接結果尚未確認；請重新讀取持久紀錄，不會自動重送。'; fail(error);
  }
}
element('start-review').addEventListener('click', () => handoff('reviews'));
element('start-rework').addEventListener('click', () => handoff('rework'));
element('download-review').addEventListener('click', async () => {
  if (!authenticated || element('download-review').disabled) return;
  const run = currentRun, generation = candidateGeneration;
  element('download-review').disabled = true;
  try {
    const value = await readReview(run, api);
    if (generation !== candidateGeneration || !authenticated || runId !== run.id) return;
    const url = URL.createObjectURL(new Blob([value.raw], {type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = `review-${value.sha256}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000); element('download-review').disabled = false;
  } catch {
    if (generation === candidateGeneration && authenticated && runId === run.id) element('review-status').textContent = '審查成果無法確認或已過期；未下載。';
  }
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
