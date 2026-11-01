const DELIVERY = {
  accepted: '已接受，等待派送', dispatching: '派送中', awaiting_result: '等待執行結果',
  closed_unknown: '已結案，結果仍未知', reconciling: '對帳中，結果未知', result_recorded: '已保存結果',
  expired_before_dispatch: '派送前已到期', cancelled_before_dispatch: '派送前已取消',
};
const TERMINAL = new Set(['closed_unknown', 'result_recorded', 'expired_before_dispatch', 'cancelled_before_dispatch']);
const utc = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)) return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().replace('.000Z', 'Z') === value ? parsed : NaN;
};
const text = value => value == null ? '—' : String(value);
const artifactDigest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const artifactError = (code, message) => Object.assign(new Error(message), { code });
export const can = (capabilities, capability) => Array.isArray(capabilities) && capabilities.includes(capability);

export async function verifyArtifact(bytes, expectedDigest) {
  if (!artifactDigest(expectedDigest)) throw artifactError('ARTIFACT_METADATA_INVALID', '成果完整性資料無效，請重新整理。');
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw artifactError('ARTIFACT_CONTENT_INVALID', '成果內容無效，未下載檔案。');
  if (bytes.byteLength > 16384) throw artifactError('ARTIFACT_TOO_LARGE', '成果超過允許大小。');
  // Freeze the bytes being checked across the asynchronous digest operation.
  const copy = new Uint8Array(bytes);
  let hash;
  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', copy);
    hash = 'sha256:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { throw artifactError('ARTIFACT_VERIFICATION_UNAVAILABLE', '無法核對成果完整性，未下載檔案。'); }
  if (hash !== expectedDigest) throw artifactError('ARTIFACT_INTEGRITY_MISMATCH', '成果完整性核對失敗，未下載檔案。');
  return copy;
}

export function observation(record, now) {
  const result = record?.result;
  const unknown = { state: 'unknown', label: '未知', tone: 'muted', ageSeconds: null };
  if (!result || ['reconciling', 'closed_unknown'].includes(record.delivery) || result.owner_outcome !== 'succeeded' ||
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
    artifactAvailable: record.delivery !== 'closed_unknown' && can(capabilities, 'artifact:read') && artifactDigest(record.result?.artifact_sha256) &&
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
  async function request(path, body, artifact = false) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetcher(path, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'manual',
        headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Cloud-Lab': '1' },
        ...(body === undefined ? {} : { body }), signal: controller.signal,
      });
      const html = response.headers?.get('Content-Type')?.toLowerCase().includes('text/html');
      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400) || html) {
        response.body?.cancel().catch(() => {});
        throw Object.assign(new Error('回應不是 JSON；Access 工作階段可能已失效，請重新載入頁面。'), { status: html && response.status >= 400 ? response.status : 401 });
      }
      const rawArtifact = artifact && response.ok;
      if (rawArtifact && response.headers?.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        response.body?.cancel().catch(() => {});
        throw artifactError('ARTIFACT_TYPE_INVALID', '成果格式無效，未下載檔案。');
      }
      const reader = response.body?.getReader(), limit = rawArtifact ? 16384 : 32768;
      const bytes = new Uint8Array(limit);
      let size = 0;
      try {
        if (reader) while (true) {
          const { done, value } = await reader.read(); if (done) break;
          if (size + value.byteLength > limit) {
            if (rawArtifact) throw artifactError('ARTIFACT_TOO_LARGE', '成果超過允許大小。');
            throw new Error('回應超過允許大小。');
          }
          bytes.set(value, size); size += value.byteLength;
        }
      } catch (error) {
        if (response.status === 401 || response.status === 403) error.status = response.status;
        throw error;
      } finally { if (reader) await reader.cancel().catch(() => {}); }
      if (rawArtifact) return bytes.slice(0, size);
      const raw = new TextDecoder().decode(bytes.subarray(0, size));
      let data;
      try { data = JSON.parse(raw); } catch { throw Object.assign(new Error('回應不是 JSON；Access 工作階段可能已失效，請重新載入頁面。'), { status: response.status >= 400 ? response.status : 401 }); }
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
    schedule: () => request('/api/health-schedule'), usage: () => request('/api/usage'),
    command: id => request(route(id)), submit: raw => request('/api/commands', raw),
    cancel: id => request(`${route(id)}/cancel`, '{}'), artifact: id => request(`${route(id)}/artifact`, undefined, true),
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

export function renderSchedule(document, data, now) {
  const panel = element(document, 'div');
  const schedule = data?.schedule;
  if (!schedule) { panel.append(element(document, 'p', '尚未設定定時檢查。', 'secondary')); return panel; }
  const labels = { disabled: '已停用', unconfigured: '尚未設定排程政策', invalid_policy: '排程設定無效',
    waiting: '尚未到啟用時間', expired: '排程期限已到', ready: '政策有效，等待觸發',
    grant_unavailable: '排程授權不可用', window_exhausted: '剩餘期限不足以完成下一次檢查' };
  panel.append(element(document, 'p', labels[schedule.status] || '排程狀態未知', 'secondary'));
  const next = utc(schedule.next_due_at), end = utc(schedule.expires_at), current = utc(now);
  const nextLabel = Number.isFinite(end) && current >= end ? '排程期限已到' :
    Number.isFinite(next) && next >= current ? schedule.next_due_at : schedule.next_due_at ? '等待更新，尚未確認下一次時段' : '—';
  const meta = element(document, 'dl', undefined, 'metadata');
  meta.append(metric(document, '檢查間隔', schedule.interval_minutes ? `${schedule.interval_minutes} 分鐘` : '未知'),
    metric(document, '政策截止 UTC', schedule.expires_at), metric(document, '下次預定時段 UTC', nextLabel),
    metric(document, '最近觸發 UTC', schedule.last_firing?.due_at),
    metric(document, '觸發結果', ({submitted:'已提交',skipped_misfire:'錯過時段，未補跑',skipped_overlap:'已有工作或未知結果，略過',skipped_grant:'授權不可用，略過',skipped_quota:'配額不足，略過',skipped_window:'期限不足，略過'})[schedule.last_firing?.outcome] || schedule.last_firing?.outcome));
  const last = schedule.latest_result;
  const observed = last ? observation(last, now) : { label: '尚無已完成觀測', tone: 'muted' };
  meta.append(metric(document, '最近完成觀測 UTC', last?.result?.finished_at), metric(document, '最近完成觀測', observed.label, observed.tone));
  panel.append(meta, element(document, 'p', '預定時段依排程政策計算，不代表觸發器或執行端在線；以實際觸發與觀測時間為準。', 'secondary'));
  return panel;
}

export function errorMessage(error) {
  const hint = error.status === 401 ? 'Access 工作階段已失效，請重新載入並登入。' :
    error.status === 403 ? '目前授權不足或已撤銷；不會自動重試。' :
    error.status === 410 ? '成果已到期，無法下載。' : error.message || '連線失敗，結果尚未確認。';
  return `${hint}${error.code ? ` (${error.code})` : ''}${error.requestId ? ` · 請求 ${error.requestId}` : ''}`;
}

const usageScope = value => JSON.stringify([value?.workspace_id, value?.resource_ref?.resource_id,
  value?.resource_ref?.generation, value?.recipe_ref?.recipe_id, value?.recipe_ref?.version, value?.recipe_ref?.digest]);
function validUsage(data, bootstrap, now, clockUncertainty = 0) {
  if (data?.schema_version !== 'cloudlab.usage.v1' || usageScope(data.scope) !== usageScope(bootstrap) ||
      !Number.isFinite(utc(now)) || !Number.isSafeInteger(clockUncertainty) || clockUncertainty < 0 || clockUncertainty > 11000 ||
      !Number.isFinite(utc(data.observed_at)) || utc(data.observed_at) > utc(now) + clockUncertainty) return false;
  const a = data.application, p = data.provider;
  for (const [key, limit] of [['retained', 10000], ['rolling_24h', 1440], ['active', 1]]) {
    const c = a?.[key];
    if (!c || !Number.isSafeInteger(c.used) || c.used < 0 || c.limit !== limit || c.remaining !== Math.max(0, limit - c.used)) return false;
  }
  return a.rolling_24h.used <= a.retained.used && a.active.used <= a.retained.used &&
    utc(a.rolling_24h.window_start_exclusive) === utc(data.observed_at) - 86400000 &&
    p?.status === 'not_connected' && ['workers_requests', 'd1_rows_read', 'd1_rows_written', 'd1_storage_bytes', 'billing'].every(k => p[k] === null);
}
export function renderUsage(document, data, bootstrap, now, confirmed = true, clockUncertainty = 0) {
  const panel = element(document, 'div');
  if (!validUsage(data, bootstrap, now, clockUncertainty)) {
    panel.append(element(document, 'p', '用量尚未確認；按「讀取用量」取得快照。', 'secondary')); return panel;
  }
  const age = Math.max(0, Math.floor((utc(now) - utc(data.observed_at)) / 1000));
  const label = !confirmed ? '連線未確認，僅保留上次快照' : age >= 60 ? '快照已過期，請手動更新' : '上次讀取的快照';
  panel.append(element(document, 'p', `${label} · 約 ${age} 秒前（時間估計誤差上限 ${clockUncertainty / 1000} 秒）`, 'secondary'));
  const meta = element(document, 'dl', undefined, 'metadata'), a = data.application;
  meta.append(metric(document, '觀測時間 UTC', data.observed_at));
  for (const [key, title] of [['retained', '保留命令'], ['rolling_24h', '近 24 小時命令'], ['active', '執行槽（包含未知）']]) {
    const c = a[key]; meta.append(metric(document, title, `${c.used} / ${c.limit} · 剩餘 ${c.remaining}`, c.remaining === 0 ? 'warning-text' : ''));
  }
  panel.append(meta, element(document, 'p', 'Cloudflare 用量與帳單：尚未接入，數值未知。', 'secondary'),
    element(document, 'p', '剩餘額度不保證下一次准入；完成或取消不退還命令額度。保留數到頂須先備份並制定保留方案，不會自動刪除歷史。', 'secondary'));
  return panel;
}

// Compare complete M1 records, not Event/source_seq deltas. Keep no history outside
// the current bounded view. Lease expiry is a derived view, not a new DB revision.
export function acceptCommandSnapshot(previous, incoming, current) {
  const fail = () => { throw new Error('命令快照版本或內容不一致，保留上次資料並等待重新讀取。'); };
  if (!Array.isArray(incoming) || incoming.length > 20 || !Number.isFinite(utc(current))) fail();
  const normalize = item => {
    const copy = structuredClone(item);
    if (copy.attempt && !TERMINAL.has(copy.delivery) && utc(copy.attempt.lease_expires_at) <= utc(current))
      copy.delivery = 'reconciling';
    return copy;
  };
  const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' ?
    Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
  const canonical = value => JSON.stringify(ordered(value));
  const known = new Map(previous.map(item => [item.command_id, normalize(item)])), seen = new Set();
  return incoming.map(item => {
    if (!item || typeof item.command_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.command_id) ||
        !Number.isSafeInteger(item.revision) || item.revision < 1 || seen.has(item.command_id)) fail();
    seen.add(item.command_id);
    const next = normalize(item), prior = known.get(item.command_id);
    if (prior && (next.revision < prior.revision ||
        (next.revision === prior.revision && canonical(next) !== canonical(prior)))) fail();
    return next;
  });
}

export function mount(document, client = createClient()) {
  const byId = id => document.getElementById(id);
  const state = { bootstrap: null, records: [], scheduleData: null, usageData: null, usageBusy: false, usageConfirmed: false, usageSignature: '', clockUncertainty: 0, pending: null, busy: false, refreshing: false, synced: false, serverTime: NaN, measuredAt: 0, renderedSignature: '', refreshError: false, authBlocked: false, authRevision: 0 };
  const now = () => new Date(state.serverTime + performance.now() - state.measuredAt).toISOString().replace(/\.\d{3}Z$/, 'Z');
  function message(content = '', error = false) {
    const box = byId('message'); box.textContent = content; box.hidden = !content;
    box.className = error ? 'message error' : 'message'; box.setAttribute('role', error ? 'alert' : 'status');
  }
  function updateControls() {
    const caps = state.bootstrap?.capabilities;
    byId('submit').disabled = state.busy || !state.synced || state.authBlocked || !!state.pending || !can(caps, 'commands:submit') || !can(caps, 'node:health:read');
    byId('retry').hidden = !state.pending; byId('retry').disabled = state.busy || !state.synced || state.authBlocked || !can(caps, 'commands:submit') || !can(caps, 'node:health:read');
    byId('refresh').disabled = state.refreshing;
    byId('usage-refresh').disabled = state.usageBusy || !state.synced || state.authBlocked || !can(caps, 'commands:read');
    byId('submit-note').textContent = state.pending ? '提交結果尚未確認。重試會傳送完全相同的命令與冪等鍵；重新載入會失去本頁保留的內容。' :
      state.authBlocked ? '授權未確認，已暫停自動更新。登入後按重新整理確認。' : !state.synced ? '連線確認後即可檢查。' : !can(caps, 'commands:submit') || !can(caps, 'node:health:read') ? '目前授權無法提交節點檢查。' :
      '固定 Python collector · 最長 10 秒 · 30 秒觀測有效期';
    for (const button of byId('commands').querySelectorAll('button')) button.disabled = !state.synced || button.dataset.busy === 'true';
  }
  function failed(error) {
    if (error.status !== 401 && error.status !== 403) return;
    state.authRevision++; state.authBlocked = true; state.synced = false; state.refreshError = true;
    state.records = []; state.scheduleData = null; byId('schedule').replaceChildren(); state.bootstrap = null; state.serverTime = NaN; state.renderedSignature = '';
    state.usageData = null; state.usageConfirmed = false; state.usageSignature = ''; byId('usage').replaceChildren();
    byId('commands').replaceChildren();
    for (const id of ['total-count', 'active-count', 'unknown-count']) byId(id).textContent = '—';
    for (const id of ['workspace', 'node-id', 'recipe']) byId(id).textContent = '授權未確認';
    byId('clock').textContent = '伺服器時間尚未確認';
    byId('health').textContent = '授權未確認'; byId('health').className = 'badge muted';
    byId('observed').textContent = '登入並重新整理後才能讀取觀測';
    byId('empty').hidden = false; byId('empty').textContent = '授權未確認，尚未載入命令。';
    byId('connection').textContent = '授權未確認 · 自動更新已暫停';
    updateControls();
  }
  const currentSession = revision => revision === state.authRevision;
  const actions = {
    async cancel(id, button) {
      if (!state.synced || state.authBlocked) return;
      const revision = state.authRevision; button.dataset.busy = 'true'; button.disabled = true;
      try { await client.cancel(id); if (!currentSession(revision)) return; message('已記錄取消意圖。已派送工作仍須等待執行器結果，尚不代表停止。'); await refresh(); }
      catch (error) { if (!currentSession(revision)) return; failed(error); message(errorMessage(error), true); }
      finally { delete button.dataset.busy; updateControls(); }
    },
    async artifact(id, button) {
      if (!state.synced || state.authBlocked) return;
      const selected = state.records.find(record => record.command_id === id);
      if (!selected || !commandView(selected, state.bootstrap?.capabilities, now()).artifactAvailable) return;
      const expectedDigest = selected.result.artifact_sha256;
      const revision = state.authRevision; button.dataset.busy = 'true'; button.disabled = true;
      try {
        const artifact = await client.artifact(id);
        if (!currentSession(revision)) return;
        const verified = await verifyArtifact(artifact, expectedDigest);
        if (!currentSession(revision)) return;
        const current = state.records.find(record => record.command_id === id);
        if (!state.synced || !current || current.result?.artifact_sha256 !== expectedDigest ||
            !commandView(current, state.bootstrap?.capabilities, now()).artifactAvailable)
          throw artifactError('ARTIFACT_CONTEXT_CHANGED', '成果或授權已更新，請重新整理後再下載。');
        const url = URL.createObjectURL(new Blob([verified], { type: 'application/json' }));
        const link = element(document, 'a'); link.href = url; link.download = 'node-health.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) { if (!currentSession(revision)) return; failed(error); message(errorMessage(error), true); }
      finally { delete button.dataset.busy; updateControls(); }
    },
  };
  function render() {
    if (!state.bootstrap || !Number.isFinite(state.serverTime)) return;
    const current = now(), caps = state.bootstrap.capabilities;
    const usageSignature = JSON.stringify([state.usageData, usageScope(state.bootstrap), current, state.clockUncertainty, state.usageConfirmed && state.synced]);
    if (usageSignature !== state.usageSignature) {
      byId('usage').replaceChildren(renderUsage(document, state.usageData, state.bootstrap, current, state.usageConfirmed && state.synced, state.clockUncertainty));
      state.usageSignature = usageSignature;
    }
    byId('schedule').replaceChildren(renderSchedule(document, state.scheduleData, current));
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
    byId('unknown-count').textContent = readable ? String(state.records.filter(item => ['reconciling', 'closed_unknown'].includes(item.delivery) || item.result?.health === 'unknown').length) : '—';
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
  async function bootstrap(revision = state.authRevision) {
    const requestedAt = performance.now();
    const data = await client.bootstrap();
    const receivedAt = performance.now(), roundtrip = receivedAt - requestedAt;
    if (!currentSession(revision)) return false;
    if (!Number.isFinite(utc(data.now))) throw new Error('伺服器時間無效。');
    if (!Number.isFinite(roundtrip) || roundtrip < 0 || roundtrip > 10000) throw new Error('伺服器時間估計已失效，請重新整理。');
    if (usageScope(data) !== usageScope(state.bootstrap) || !can(data.capabilities, 'commands:read')) {
      state.usageData = null; state.usageConfirmed = false;
      state.records = []; state.scheduleData = null; state.renderedSignature = ''; state.synced = false;
      byId('commands').replaceChildren(); byId('schedule').replaceChildren();
    }
    // Whole-second timestamps plus measured request latency bound a legitimate
    // newer usage timestamp; no arbitrary clock jump or negative displayed age.
    state.clockUncertainty = 1000 + Math.ceil(roundtrip / 1000) * 1000;
    state.bootstrap = data; state.serverTime = utc(data.now); state.measuredAt = receivedAt;
    return true;
  }
  async function refresh(manual = false) {
    if (state.refreshing || (state.authBlocked && !manual)) return;
    const revision = state.authRevision;
    state.refreshing = true; updateControls();
    try {
      if (!await bootstrap(revision)) return;
      if (can(state.bootstrap.capabilities, 'commands:read')) {
        const data = await client.commands();
        if (!currentSession(revision)) return;
        const records = acceptCommandSnapshot(state.records, data.commands, now());
        const scheduleData = await client.schedule();
        if (!currentSession(revision)) return;
        if (scheduleData?.schema_version !== 'cloudlab.health-schedule.v1' || !Object.hasOwn(scheduleData, 'schedule')) throw new Error('排程回應格式無效。');
        state.records = records; state.scheduleData = scheduleData;
      } else { state.records = []; state.scheduleData = null; }
      state.authBlocked = false; state.synced = true;
      byId('connection').textContent = '已連線 · 每 5 秒更新';
      if (state.refreshError) { message(); state.refreshError = false; }
      render();
    } catch (error) {
      if (!currentSession(revision)) return;
      state.synced = false; byId('connection').textContent = '連線未確認 · 畫面保留上次資料';
      message(errorMessage(error), true); state.refreshError = true;
      failed(error);
      render();
    } finally { state.refreshing = false; updateControls(); }
  }
  async function submit(retry = false) {
    if (state.busy || !state.synced || state.authBlocked || (!retry && state.pending) || (retry && !state.pending)) return;
    if (!can(state.bootstrap?.capabilities, 'commands:submit') || !can(state.bootstrap?.capabilities, 'node:health:read')) return;
    const revision = state.authRevision;
    state.busy = true; updateControls(); message();
    try {
      if (!retry) {
        if (!await bootstrap(revision)) return;
        if (!can(state.bootstrap.capabilities, 'commands:submit') || !can(state.bootstrap.capabilities, 'node:health:read')) throw new Error('目前授權無法提交節點檢查。');
        state.pending = JSON.stringify(makeSubmission(state.bootstrap, state.bootstrap.now, crypto.randomUUID()));
      }
      await client.submit(state.pending);
      if (!currentSession(revision)) return;
      state.pending = null; message('命令已接受。接受提交僅表示已保存，請等待執行結果。'); await refresh();
    } catch (error) {
      if (!currentSession(revision)) return;
      failed(error);
      // A rejected retry says nothing about the original admission whose ACK was lost.
      if (!retry && error.status && error.status < 500 && ![401, 403, 429].includes(error.status)) state.pending = null;
      message(`${errorMessage(error)}${state.pending ? ' 提交結果尚未確認；可用相同內容手動重試。' : ''}`, true);
    } finally { state.busy = false; updateControls(); }
  }
  async function refreshUsage() {
    if (state.usageBusy || !state.synced || state.authBlocked || !can(state.bootstrap?.capabilities, 'commands:read')) return;
    const revision = state.authRevision;
    state.usageBusy = true; updateControls();
    try {
      const data = await client.usage();
      if (!currentSession(revision)) return;
      if (!validUsage(data, state.bootstrap, now(), state.clockUncertainty)) throw new Error('用量快照格式、時間或scope無效。');
      state.usageData = data; state.usageConfirmed = true;
      message('已讀取應用額度快照；Cloudflare 用量與帳單仍未接入。');
    } catch (error) {
      if (!currentSession(revision)) return;
      state.usageConfirmed = false; failed(error); message(errorMessage(error), true);
    } finally { state.usageBusy = false; render(); updateControls(); }
  }
  byId('submit').addEventListener('click', () => submit());
  byId('retry').addEventListener('click', () => submit(true));
  byId('refresh').addEventListener('click', () => refresh(true));
  byId('usage-refresh').addEventListener('click', refreshUsage);
  const poll = setInterval(() => { if (!document.hidden && !state.busy && !state.authBlocked) refresh(); }, 5000);
  const age = setInterval(() => { if (!document.hidden) render(); }, 1000);
  globalThis.addEventListener('beforeunload', event => { if (state.pending) { event.preventDefault(); event.returnValue = ''; } });
  refresh();
  return () => { clearInterval(poll); clearInterval(age); };
}
if (typeof document !== 'undefined') mount(document);
