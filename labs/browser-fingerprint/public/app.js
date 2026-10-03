'use strict';
const $ = (selector) => document.querySelector(selector);
const state = { tasks: [], filter: 'all', project: 'all', query: '', loaded: false };
const projects = { '設計': 'design', '開發': 'development', '生活': 'life' };
const priorities = { high: '高', medium: '中', low: '低' };
let toastTimer;
let editingId = null;
let deletingId = null;
let searchTimer;
const tutorial = { active: false, step: 0, taskId: null, id: null, receipts: [], recordingStatus: null, advancing: false };
const tutorialSteps = [
  ['1 / 5 · 新增任務', '點選「新增任務」，建立一個教學用的任務。'],
  ['2 / 5 · 編輯任務', '點選剛建立的任務名稱，修改名稱或優先程度，再儲存。'],
  ['3 / 5 · 完成任務', '點選該任務左側的方框，將它設為已完成。'],
  ['4 / 5 · 搜尋任務', '在搜尋欄輸入該任務名稱的至少兩個字，確認能找到它。'],
  ['5 / 5 · 刪除任務', '點選該任務右側的 ×，確認刪除，完成這次 CRUD 教學。'],
  ['教學完成 · 5 / 5', '操作已完成，正在確認觀測與事件的記錄結果。']
];
const record = (type, details, event, generation = tutorial.id) => {
  // Logging failures must not undo a successful task action or stop the tutorial.
  const receipt = Promise.resolve().then(() => window.daylightObservation?.record(type, details, event)).then(result => result === true, () => false);
  if (tutorial.active && generation === tutorial.id && tutorial.recordingStatus !== 'complete' && tutorial.recordingStatus !== 'incomplete') tutorial.receipts.push(receipt);
  return receipt;
};
function renderTutorial() {
  $('#tutorial-progress').hidden = !tutorial.active;
  $('#tutorial-progress').classList.toggle('completed', tutorial.step === 5);
  $('#tutorial-title').textContent = tutorialSteps[tutorial.step][0];
  $('#tutorial-instruction').textContent = tutorialSteps[tutorial.step][1];
  if (tutorial.step === 5 && tutorial.recordingStatus === 'complete') $('#tutorial-instruction').textContent = '新增、讀取、編輯、完成、搜尋與刪除都已操作；觀測與事件已寫入實驗日誌。';
  if (tutorial.step === 5 && tutorial.recordingStatus === 'incomplete') $('#tutorial-instruction').textContent = '操作已完成，但觀測或事件記錄不完整；不需要重做已成功的操作。';
  $('#start-tutorial').disabled = tutorial.active && tutorial.step < 5;
  $('#start-tutorial').textContent = tutorial.step === 5 ? '再跑一次教學 ↗' : '開始操作教學 ↗';
}
async function advanceTutorial(action, task, event, generation = tutorial.id) {
  if (!tutorial.active || tutorial.step >= 5 || tutorial.advancing || generation !== tutorial.id) return;
  const tutorialId = tutorial.id;
  const step = tutorial.step;
  const expected = ['create', 'update', 'complete', 'search', 'delete'][step];
  if (action !== expected || (step > 0 && task?.id !== tutorial.taskId)) return;
  const receipts = tutorial.receipts;
  tutorial.advancing = true;
  try {
    if (step === 0) tutorial.taskId = task.id;
    await record('tutorial_step', { step: step + 1, action, taskId: tutorial.taskId, tutorialId }, event);
    if (!tutorial.active || tutorial.id !== tutorialId || tutorial.step !== step) return;
    tutorial.step = step + 1;
    if (tutorial.step === 5) tutorial.recordingStatus = 'pending';
    renderTutorial();
    if (tutorial.step === 5) {
      await record('tutorial_complete', { step: 5, tutorialId }, event);
      const recorded = (await Promise.all(receipts)).every(receipt => receipt === true);
      if (!tutorial.active || tutorial.id !== tutorialId) return;
      tutorial.recordingStatus = recorded ? 'complete' : 'incomplete';
      renderTutorial();
    }
  } finally {
    if (tutorial.id === tutorialId) tutorial.advancing = false;
  }
}

$('#today').textContent = new Intl.DateTimeFormat('zh-TW', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());

async function api(path, options = {}) {
  if (options.method && options.method !== 'GET') await window.daylightObservation?.ready;
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(10000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '目前無法完成操作，請稍後重試。');
  return data;
}

function setConnection(connected) {
  const connection = $('#connection');
  connection.classList.toggle('offline', !connected);
  connection.replaceChildren(document.createElement('span'), document.createTextNode(connected ? '已連線' : '連線中斷'));
}

function showToast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3200);
}

function showError(message) {
  $('#error-message').textContent = message;
  $('#error-box').hidden = false;
}

function render() {
  const completed = state.tasks.filter(task => task.completed).length;
  const total = state.tasks.length;
  const percent = total ? Math.round(completed / total * 100) : 0;
  $('#total').textContent = total;
  $('#remaining').textContent = total - completed;
  $('#completed').textContent = completed;
  $('#percent').textContent = percent;
  $('#progress-ring').style.setProperty('--progress', `${percent}%`);
  $('#progress-ring').setAttribute('aria-label', `已完成 ${percent}%`);
  $('#progress-message').textContent = total === 0 ? '從一件小事開始' : completed === total ? '今天的重要小事，都完成了！' : completed ? `已完成 ${completed} 件，很棒的開始` : '準備好了，就從第一件開始';
  $('#all-count').textContent = total;
  $('#task-summary').textContent = `${total - completed} 件待辦 · ${completed} 件已完成`;
  for (const project of Object.keys(projects)) {
    document.querySelector(`[data-count="${project}"]`).textContent = state.tasks.filter(task => task.project === project && !task.completed).length;
  }
  const tasks = state.tasks.filter(task => (state.filter === 'all' || task.completed === (state.filter === 'completed')) && (state.project === 'all' || task.project === state.project) && task.title.toLocaleLowerCase().includes(state.query.toLocaleLowerCase()));
  const list = $('#task-list');
  list.replaceChildren();
  list.setAttribute('aria-busy', 'false');
  $('#visible-count').textContent = `顯示 ${tasks.length} 件任務`;
  if (!tasks.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    const title = document.createElement('strong');
    title.textContent = total ? '這裡暫時沒有任務' : '為今天留下一件重要的事';
    const text = document.createElement('span');
    text.textContent = total ? '試試其他搜尋文字或篩選條件。' : '點選「新增任務」，開始你的第一步。';
    empty.append(title, text);
    list.append(empty);
  }
  for (const task of tasks) {
    const row = document.createElement('li');
    row.className = `task-row${task.completed ? ' done' : ''}`;
    const main = document.createElement('div');
    main.className = 'task-main';
    const check = document.createElement('button');
    check.className = 'check-button';
    check.setAttribute('aria-label', `${task.completed ? '將任務設為待辦' : '完成任務'}：${task.title}`);
    check.setAttribute('aria-pressed', String(task.completed));
    check.dataset.taskId = task.id;
    if (task.completed) {
      check.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
    }
    const title = document.createElement('button');
    title.className = 'task-title task-title-button';
    title.textContent = task.title;
    title.setAttribute('aria-label', `編輯任務：${task.title}`);
    title.addEventListener('click', () => openTaskEditor(task));
    main.append(check, title);
    const project = document.createElement('span');
    project.className = 'task-project';
    const dot = document.createElement('span');
    dot.className = `project-dot ${projects[task.project] || ''}`;
    project.append(dot, document.createTextNode(task.project));
    const priority = document.createElement('span');
    priority.className = `priority ${Object.hasOwn(priorities, task.priority) ? task.priority : 'medium'}`;
    priority.textContent = `${priorities[task.priority] || '中'}優先`;
    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const remove = document.createElement('button');
    remove.className = 'delete-task-button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `刪除任務：${task.title}`);
    remove.addEventListener('click', () => {
      deletingId = task.id;
      $('#delete-description').textContent = task.title;
      $('#delete-dialog').showModal();
      $('#cancel-delete').focus();
    });
    actions.append(priority, remove);
    row.append(main, project, actions);
    check.addEventListener('click', async event => {
      const tutorialGeneration = tutorial.id;
      check.disabled = true;
      try {
        const { task: updated } = await api(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'PATCH', body: JSON.stringify({ completed: !task.completed }) });
        state.tasks = state.tasks.map(item => item.id === updated.id ? updated : item);
        $('#error-box').hidden = true;
        setConnection(true);
        render();
        const nextCheck = Array.from(document.querySelectorAll('[data-task-id]')).find(button => button.dataset.taskId === updated.id);
        if (nextCheck) nextCheck.focus({ preventScroll: true });
        showToast(updated.completed ? '又完成一件事，好好給自己鼓勵。' : '已移回待辦任務。');
        await record('task_update', { taskId: updated.id, action: updated.completed ? 'complete' : 'reopen' }, event, tutorialGeneration);
        if (updated.completed) await advanceTutorial('complete', updated, event, tutorialGeneration);
      } catch (error) {
        check.disabled = false;
        showError(error.message);
      }
    });
    list.append(row);
  }
  document.querySelectorAll('.project-link').forEach(button => button.classList.toggle('selected', button.dataset.project === state.project));
}

async function loadTasks() {
  $('#retry').disabled = true;
  try {
    const { tasks } = await api('/api/tasks');
    state.tasks = tasks;
    state.loaded = true;
    $('#error-box').hidden = true;
    setConnection(true);
    render();
  } catch (error) {
    setConnection(false);
    showError('無法載入任務，請確認連線後再試一次。');
    $('#task-list').setAttribute('aria-busy', 'false');
    if (!state.loaded) {
      $('#task-list').replaceChildren();
      $('#task-summary').textContent = '暫時無法載入任務';
    }
  } finally { $('#retry').disabled = false; }
}

document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', event => {
  state.filter = button.dataset.filter;
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab === button);
    tab.setAttribute('aria-pressed', String(tab === button));
  });
  if (state.loaded) render();
  record('filter_change', { action: 'status', status: state.filter }, event);
}));
$('#search').addEventListener('input', event => {
  const tutorialGeneration = tutorial.id;
  state.query = event.target.value.trim();
  if (state.loaded) render();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    await record('search', { queryLength: state.query.length, action: 'search' }, event, tutorialGeneration);
    const task = state.tasks.find(item => item.id === tutorial.taskId);
    if (task && state.query.length >= 2 && task.title.toLocaleLowerCase().includes(state.query.toLocaleLowerCase())) await advanceTutorial('search', task, event, tutorialGeneration);
  }, 350);
});
function selectProject(project, event = null) { state.project = project; $('#project-filter').value = project; if (state.loaded) render(); if (event) record('filter_change', { action: 'project', project }, event); }
$('#project-filter').addEventListener('change', event => selectProject(event.target.value, event));
document.querySelectorAll('.project-link').forEach(button => button.addEventListener('click', event => selectProject(state.project === button.dataset.project ? 'all' : button.dataset.project, event)));
$('#retry').addEventListener('click', loadTasks);
const dialog = $('#task-dialog');
$('#add-task').addEventListener('click', () => {
  editingId = null;
  $('#task-form').reset();
  $('#dialog-title').textContent = '新增一件重要的事';
  $('#save-task').textContent = '建立任務 ↗';
  $('#form-error').hidden = true;
  if (state.project !== 'all') $('#task-project').value = state.project;
  dialog.showModal();
  $('#task-title').focus();
});
function openTaskEditor(task) {
  editingId = task.id;
  $('#dialog-title').textContent = '編輯任務';
  $('#save-task').textContent = '儲存變更 ↗';
  $('#task-title').value = task.title;
  $('#task-project').value = task.project;
  $('#task-priority').value = task.priority;
  $('#form-error').hidden = true;
  dialog.showModal();
  $('#task-title').focus();
}
$('#close-dialog').addEventListener('click', () => dialog.close());
$('#cancel-task').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
$('#task-form').addEventListener('submit', async event => {
  event.preventDefault();
  const tutorialGeneration = tutorial.id;
  const title = $('#task-title').value.trim();
  if (!title) { $('#form-error').textContent = '請寫下一個任務名稱。'; $('#form-error').hidden = false; $('#task-title').focus(); return; }
  $('#save-task').disabled = true;
  $('#form-error').hidden = true;
  try {
    const wasEditing = editingId !== null;
    const { task } = await api(wasEditing ? `/api/tasks/${encodeURIComponent(editingId)}` : '/api/tasks', { method: wasEditing ? 'PATCH' : 'POST', body: JSON.stringify({ title, project: $('#task-project').value, priority: $('#task-priority').value }) });
    if (wasEditing) state.tasks = state.tasks.map(item => item.id === task.id ? task : item);
    else state.tasks.unshift(task);
    state.loaded = true;
    setConnection(true);
    $('#error-box').hidden = true;
    state.query = '';
    $('#search').value = '';
    state.filter = 'all';
    document.querySelectorAll('.tab').forEach(tab => { tab.classList.toggle('active', tab.dataset.filter === 'all'); tab.setAttribute('aria-pressed', String(tab.dataset.filter === 'all')); });
    selectProject('all');
    dialog.close();
    showToast(wasEditing ? '任務已更新。' : '任務已建立，準備好就開始吧。');
    await record(wasEditing ? 'task_update' : 'task_create', { taskId: task.id, action: wasEditing ? 'edit' : 'create', project: task.project }, event, tutorialGeneration);
    await advanceTutorial(wasEditing ? 'update' : 'create', task, event, tutorialGeneration);
  } catch (error) { $('#form-error').textContent = error.message; $('#form-error').hidden = false; }
  finally { $('#save-task').disabled = false; }
});
$('#cancel-delete').addEventListener('click', () => $('#delete-dialog').close());
$('#confirm-delete').addEventListener('click', async event => {
  const tutorialGeneration = tutorial.id;
  const task = state.tasks.find(item => item.id === deletingId);
  if (!task) return;
  $('#confirm-delete').disabled = true;
  try {
    await api(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'DELETE' });
    state.tasks = state.tasks.filter(item => item.id !== task.id);
    $('#delete-dialog').close();
    render();
    showToast('任務已刪除。');
    await record('task_delete', { taskId: task.id, action: 'delete' }, event, tutorialGeneration);
    await advanceTutorial('delete', task, event, tutorialGeneration);
  } catch (error) { $('#delete-dialog').close(); showError(error.message); }
  finally { $('#confirm-delete').disabled = false; }
});
$('#start-tutorial').addEventListener('click', async event => {
  tutorial.active = true; tutorial.step = 0; tutorial.taskId = null; tutorial.id = crypto.randomUUID(); tutorial.receipts = []; tutorial.recordingStatus = null; tutorial.advancing = false;
  state.query = ''; $('#search').value = ''; state.filter = 'all';
  document.querySelectorAll('.tab').forEach(tab => { tab.classList.toggle('active', tab.dataset.filter === 'all'); tab.setAttribute('aria-pressed', String(tab.dataset.filter === 'all')); });
  selectProject('all');
  renderTutorial();
  await record('tutorial_start', { tutorialId: tutorial.id, action: 'start' }, event);
});
$('#stop-tutorial').addEventListener('click', event => {
  if (tutorial.step < 5) record('tutorial_step', { tutorialId: tutorial.id, status: 'cancelled', step: tutorial.step }, event);
  tutorial.active = false; renderTutorial();
});
document.addEventListener('keydown', event => { if (event.key === '/' && !dialog.open && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !document.activeElement.isContentEditable) { event.preventDefault(); $('#search').focus(); } });
loadTasks();
