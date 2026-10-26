const DELIVERY = {
  accepted: '已接受，等待派送', dispatching: '派送中', awaiting_result: '等待執行結果',
  reconciling: '對帳中，結果未知', result_recorded: '已保存結果',
  expired_before_dispatch: '派送前已到期', cancelled_before_dispatch: '派送前已取消',
};
const TERMINAL = new Set(['result_recorded', 'expired_before_dispatch', 'cancelled_before_dispatch']);
const utc = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)) return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().replace('.000Z', 'Z') === value ? parsed : NaN;
};
const text = value => value == null ? '—' : String(value);
export const can = (capabilities, capability) => Array.isArray(capabilities) && capabilities.includes(capability);

export function observation(record, now) {
  const result = record?.result;
  const unknown = { state: 'unknown', label: '未知', tone: 'muted', ageSeconds: null };
  if (!result || record.delivery === 'reconciling' || result.owner_outcome !== 'succeeded' ||
      !['healthy', 'unhealthy'].includes(result.health)) return unknown;
  const finished = utc(result.finished_at), current = utc(now);
  const maxAge = record.command?.parameters?.max_sample_age_seconds;
  if (!Number.isFinite(finished) || !Number.isFinite(current) || finished > current || !Number.isInteger(maxAge) || maxAge < 0) return unknown;
  const ageSeconds = Math.floor((current - finished) / 1000);
  if (ageSeconds > maxAge) return { state: 'stale', label: '觀測已過期', tone: 'warning', ageSeconds };
  if (result.validation?.status !== 'passed') return { state: 'unverified', label: '驗證未通過', tone: 'warning', ageSeconds };
  return { state: result.health, label: result.health === 'healthy' ? 'Collector 正常' : 'Collector 異常',
    tone: result.health === 'healthy' ? 'good' : 'bad', ageSeconds };
}

export function commandView(record, capabilities, now) {
  return {
    ...observation(record, now), status: DELIVERY[record.delivery] || '未知派送狀態',
    canCancel: can(capabilities, 'commands:cancel-request') && !record.cancel_requested && !TERMINAL.has(record.delivery),
    cancelLabel: record.cancel_requested ? '已記錄取消意圖；尚不代表程序停止' : '要求取消',
    artifactAvailable: can(capabilities, 'artifact:read') && Boolean(record.result?.artifact_sha256) &&
      Number.isFinite(utc(record.result?.artifact_expires_at)) && utc(now) < utc(record.result.artifact_expires_at),
  };
}

export function makeSubmission(bootstrap, now, idempotencyKey) {
  const start = utc(now);
  if (!Number.isFinite(start)) throw new Error('伺服器時間無效，請重新整理。');
  const stamp = offset => new Date(start + offset * 1000).toISOString().replace('.000Z', 'Z');
  return {
    schema_version: 'cloudlab.command.v1', schema_minor: 0, workspace_id: bootstrap.workspace_id,
    resource_ref: bootstrap.resource_ref, recipe_ref: bootstrap.recipe_ref,
    parameters: { max_sample_age_seconds: 30 }, idempotency_key: idempotencyKey,
    not_before: stamp(0), dispatch_deadline: stamp(60), execution_deadline: stamp(120),
    timeout_seconds: 10, output_budget_bytes: 16384,
  };
}

export function createClient(fetcher = globalThis.fetch.bind(globalThis)) {
  async function request(path, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetcher(path, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Cloud-Lab': '1' },
        ...(body === undefined ? {} : { body }), signal: controller.signal,
      });
      const raw = await response.text();
      if (new TextEncoder().encode(raw).byteLength > 32768) throw new Error('回應超過允許大小。');
      let data;
      try { data = JSON.parse(raw); } catch { throw new Error('回應不是 JSON；Access 工作階段可能已失效，請重新載入頁面。'); }
      if (!response.ok) {
        const error = new Error(text(data.message || '請求未完成'));
        Object.assign(error, { status: response.status, code: data.code, requestId: data.request_id, retryable: data.retryable === true });
        throw error;
      }
      return data;
    } finally { clearTimeout(timeout); }
  }
  const route = id => `/api/commands/${encodeURIComponent(id)}`;
  return {
    bootstrap: () => request('/api/bootstrap'), commands: () => request('/api/commands'),
    command: id => request(route(id)), submit: raw => request('/api/commands', raw),
    cancel: id => request(`${route(id)}/cancel`, '{}'), artifact: id => request(`${route(id)}/artifact`),
  };
}

function element(document, tag, content, className) {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = text(content);
  if (className) node.className = className;
  return node;
}
function metric(document, label, value, className) {
  const pair = element(document, 'div', undefined, 'metric');
  pair.append(element(document, 'dt', label), element(document, 'dd', value, className));
  return pair;
}
export function renderCommand(document, record, capabilities, now, actions) {
  const view = commandView(record, capabilities, now);
  const card = element(document, 'article', undefined, 'command-card');
  card.setAttribute('data-command-id', record.command_id);
  const heading = element(document, 'div', undefined, 'command-heading');
  const identity = element(document, 'div');
  identity.append(element(document, 'h3', record.command_id, 'command-id'), element(document, 'p', view.status, 'secondary'));
  heading.append(identity, element(document, 'span', view.label, `badge ${view.tone}`));
  const meta = element(document, 'dl', undefined, 'metadata');
  meta.append(metric(document, '提交時間 UTC', record.created_at), metric(document, '觀測完成 UTC', record.result?.finished_at),
    metric(document, '結果收到 UTC', record.result?.received_at), metric(document, '驗證', record.result?.validation?.status),
    metric(document, '執行器結果', record.result?.owner_outcome), metric(document, '觀測年齡', view.ageSeconds === null ? '未知' : `${view.ageSeconds} 秒`, 'observation-age'));
  card.append(heading, meta);
  if (record.cancel_requested) card.append(element(document, 'p', view.cancelLabel, 'notice warning-text'));
  if (record.result?.late) card.append(element(document, 'p', '結果晚於執行期限收到；保留原始時間與結果。', 'notice warning-text'));
  const buttons = element(document, 'div', undefined, 'actions');
  if (view.canCancel) {
    const cancel = element(document, 'button', '要求取消', 'button secondary-button');
    cancel.type = 'button'; cancel.addEventListener('click', () => actions.cancel?.(record.command_id, cancel)); buttons.append(cancel);
  }
  if (view.artifactAvailable) {
    const artifact = element(document, 'button', '下載 JSON 成果', 'button secondary-button');
    artifact.type = 'button'; artifact.addEventListener('click', () => actions.artifact?.(record.command_id, artifact)); buttons.append(artifact);
  } else if (record.result?.artifact_sha256) {
    buttons.append(element(document, 'span', can(capabilities, 'artifact:read') ? '成果已到期或期限未知' : '成果下載需要 artifact:read 權限', 'secondary'));
  }
  const details = element(document, 'details');
  details.append(element(document, 'summary', '命令與證據詳情'));
  const detailMeta = element(document, 'dl', undefined, 'metadata');
  detailMeta.append(metric(document, '版本', record.revision), metric(document, '執行來源', record.external_ref?.owner),
    metric(document, '協調模式', record.attempt?.mode), metric(document, '租約期限 UTC', record.attempt?.lease_expires_at),
    metric(document, '成果到期 UTC', record.result?.artifact_expires_at), metric(document, '成果 SHA-256', record.result?.artifact_sha256));
  details.append(detailMeta, element(document, 'pre', JSON.stringify(record.command, null, 2)));
  card.append(buttons, details);
  return card;
}

export function errorMessage(error) {
  const hint = error.status === 401 ? 'Access 工作階段已失效，請重新載入並登入。' :
    error.status === 403 ? '目前授權不足或已撤銷；不會自動重試。' :
    error.status === 410 ? '成果已到期，無法下載。' : error.message || '連線失敗，結果尚未確認。';
  return `${hint}${error.code ? ` (${error.code})` : ''}${error.requestId ? ` · 請求 ${error.requestId}` : ''}`;
}

export function mount(document, client = createClient()) {
  const byId = id => document.getElementById(id);
  const state = { bootstrap: null, records: [], pending: null, busy: false, refreshing: false, synced: false, serverTime: NaN, measuredAt: 0, renderedSignature: '', refreshError: false };
  const now = () => new Date(state.serverTime + performance.now() - state.measuredAt).toISOString().replace(/\.\d{3}Z$/, 'Z');
  function message(content = '', error = false) {
    const box = byId('message'); box.textContent = content; box.hidden = !content;
    box.className = error ? 'message error' : 'message'; box.setAttribute('role', error ? 'alert' : 'status');
  }
  function updateControls() {
    const caps = state.bootstrap?.capabilities;
    byId('submit').disabled = state.busy || !state.synced || !!state.pending || !can(caps, 'commands:submit') || !can(caps, 'node:health:read');
    byId('retry').hidden = !state.pending; byId('retry').disabled = state.busy || !state.synced;
    byId('refresh').disabled = state.refreshing;
    byId('submit-note').textContent = state.pending ? '提交結果尚未確認。重試會傳送完全相同的命令與冪等鍵；重新載入會失去本頁保留的內容。' :
      !state.synced ? '連線確認後即可檢查。' : !can(caps, 'commands:submit') || !can(caps, 'node:health:read') ? '目前授權無法提交節點檢查。' :
      '固定 Python collector · 最長 10 秒 · 30 秒觀測有效期';
  }
  const actions = {
    async cancel(id, button) {
      button.disabled = true;
      try { await client.cancel(id); message('已記錄取消意圖。已派送工作仍須等待執行器結果，尚不代表停止。'); await refresh(); }
      catch (error) { message(errorMessage(error), true); button.disabled = false; }
    },
    async artifact(id, button) {
      button.disabled = true;
      try {
        const artifact = await client.artifact(id);
        const url = URL.createObjectURL(new Blob([JSON.stringify(artifact, null, 2)], { type: 'application/json' }));
        const link = element(document, 'a'); link.href = url; link.download = 'node-health.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) { message(errorMessage(error), true); }
      finally { button.disabled = false; }
    },
  };
  function render() {
    if (!state.bootstrap || !Number.isFinite(state.serverTime)) return;
    const current = now(), caps = state.bootstrap.capabilities;
    byId('workspace').textContent = text(state.bootstrap.workspace_id);
    byId('node-id').textContent = text(state.bootstrap.resource_ref?.resource_id);
    byId('recipe').textContent = `${text(state.bootstrap.recipe_ref?.recipe_id)} @ ${text(state.bootstrap.recipe_ref?.version)}`;
    byId('clock').textContent = `伺服器時間 ${current}`;
    const latest = state.records[0];
    const status = latest ? observation(latest, current) : { label: '尚無觀測', tone: 'muted' };
    byId('health').textContent = status.label; byId('health').className = `badge ${status.tone}`;
    byId('observed').textContent = latest?.result?.finished_at ? `最近命令觀測完成於 ${latest.result.finished_at}` : '等待具時間戳記的執行器證據';
    const readable = can(caps, 'commands:read');
    byId('total-count').textContent = readable ? String(state.records.length) : '—';
    byId('active-count').textContent = readable ? String(state.records.filter(item => !TERMINAL.has(item.delivery)).length) : '—';
    byId('unknown-count').textContent = readable ? String(state.records.filter(item => item.delivery === 'reconciling' || item.result?.health === 'unknown').length) : '—';
    const signature = JSON.stringify([state.records, caps, state.records.map(record => {
      const status = commandView(record, caps, current); return [status.state, status.tone, status.artifactAvailable];
    })]);
    if (signature !== state.renderedSignature) {
      byId('commands').replaceChildren(...state.records.map(record => renderCommand(document, record, caps, current, actions)));
      state.renderedSignature = signature;
    }
    const records = new Map(state.records.map(record => [record.command_id, record]));
    for (const card of byId('commands').querySelectorAll('[data-command-id]')) {
      const age = observation(records.get(card.getAttribute('data-command-id')), current).ageSeconds;
      card.querySelector('.observation-age').textContent = age === null ? '未知' : `${age} 秒`;
    }
    byId('empty').hidden = state.records.length > 0;
    byId('empty').textContent = can(caps, 'commands:read') ? '尚無命令。提交第一次節點檢查後，結果將顯示於此。' : '目前授權沒有 commands:read，無法讀取歷史。';
    updateControls();
  }
  async function bootstrap() {
    const data = await client.bootstrap();
    if (!Number.isFinite(utc(data.now))) throw new Error('伺服器時間無效。');
    state.bootstrap = data; state.serverTime = utc(data.now); state.measuredAt = performance.now(); state.synced = true;
  }
  async function refresh() {
    if (state.refreshing) return;
    state.refreshing = true; updateControls();
    try {
      await bootstrap();
      if (can(state.bootstrap.capabilities, 'commands:read')) {
        const data = await client.commands();
        if (!Array.isArray(data.commands)) throw new Error('命令回應格式無效。');
        state.records = data.commands.slice(0, 100);
      } else state.records = [];
      byId('connection').textContent = '已連線 · 每 5 秒更新';
      if (state.refreshError) { message(); state.refreshError = false; }
      render();
    } catch (error) {
      state.synced = false; byId('connection').textContent = '連線未確認 · 畫面保留上次資料';
      message(errorMessage(error), true); state.refreshError = true;
      if (error.status === 401 || error.status === 403) { state.records = []; state.bootstrap = null; state.renderedSignature = ''; byId('commands').replaceChildren(); byId('health').textContent = '授權未確認'; byId('health').className = 'badge muted'; }
    } finally { state.refreshing = false; updateControls(); }
  }
  async function submit(retry = false) {
    if (state.busy || (!retry && state.pending)) return;
    state.busy = true; updateControls(); message();
    try {
      if (!retry) {
        await bootstrap();
        if (!can(state.bootstrap.capabilities, 'commands:submit') || !can(state.bootstrap.capabilities, 'node:health:read')) throw new Error('目前授權無法提交節點檢查。');
        state.pending = JSON.stringify(makeSubmission(state.bootstrap, state.bootstrap.now, crypto.randomUUID()));
      }
      await client.submit(state.pending);
      state.pending = null; message('命令已接受。接受提交僅表示已保存，請等待執行結果。'); await refresh();
    } catch (error) {
      if (error.status && error.status < 500 && error.status !== 429) state.pending = null;
      message(`${errorMessage(error)}${state.pending ? ' 提交結果尚未確認；可用相同內容手動重試。' : ''}`, true);
    } finally { state.busy = false; updateControls(); }
  }
  byId('submit').addEventListener('click', () => submit());
  byId('retry').addEventListener('click', () => submit(true));
  byId('refresh').addEventListener('click', refresh);
  const poll = setInterval(() => { if (!document.hidden && !state.busy) refresh(); }, 5000);
  const age = setInterval(() => { if (!document.hidden) render(); }, 1000);
  globalThis.addEventListener('beforeunload', event => { if (state.pending) { event.preventDefault(); event.returnValue = ''; } });
  refresh();
  return () => { clearInterval(poll); clearInterval(age); };
}
if (typeof document !== 'undefined') mount(document);
