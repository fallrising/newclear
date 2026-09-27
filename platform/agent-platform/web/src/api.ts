export type Session = { authenticated: boolean; username: string | null; csrf_token: string };
export type Project = { id: string; name: string; canonical_repo: string };
export type Profile = {
  id: string;
  profile_id: string;
  revision: number;
  name: string;
  backend: string;
  tool_policy?: { require_approval?: boolean };
};
export type Task = {
  id: string;
  title: string;
  project_name: string;
  state: string;
  run_id: string;
  created_at: string;
};
export type Run = {
  id: string;
  task_id: string;
  attempt_no: number;
  profile_revision: string;
  state: string;
  state_version: number;
  backend_cursor?: string | null;
  base_sha: string;
  goal: string;
  cleanup_state: string;
  last_event_seq: number;
  event_floor: number;
  execution_mode?: string;
  require_approval?: boolean;
  capabilities?: Record<string, boolean | string>;
  result: {
    diff?: string;
    diff_sha256?: string;
    summary: string;
    verification: {
      status: string;
      reason: string;
      name?: string;
      checks?: Array<{ id: string; status: string; exit_code: number | null }>;
    };
  } | null;
};
export type Usage = {
  configured: boolean;
  guest_connected: boolean;
  request_limit: number | null;
  request_slots_consumed: number;
  uncertain_requests: number;
  cost_status: string;
  amount_decimal: string | null;
  hard_money_limit_supported: boolean;
  published_price_preview: boolean;
  quote_committed_usd: string | null;
  quote_uncertain: boolean | null;
  fixture_credit_limit_supported: boolean;
  fixture_credits_committed_microcredits: number | null;
  fixture_credits_uncertain: boolean | null;
};
export type RunEvent = {
  event_id: string;
  run_id: string;
  seq: number;
  type: string;
  created_at: string;
  payload: Record<string, unknown>;
};
export type TaskDetail = { task: Task; runs: Run[] };
export type Runtime = {
  available_backends?: string[];
  execution_mode: string;
  slots: number;
  occupied: number;
  queued: number;
  interrupted: number;
};

let csrfToken = '';
export function setCsrf(value: string) {
  csrfToken = value;
}
export class ApiError extends Error {
  status: number;
  fields: string[];
  constructor(status: number, code: string, fields: string[] = []) {
    super(code);
    this.status = status;
    this.fields = fields;
  }
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api/v1' + path, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken, ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const fields = Array.isArray(body.fields)
      ? body.fields.map((field: unknown) => (Array.isArray(field) ? String(field.at(-1)) : ''))
      : [];
    throw new ApiError(response.status, body.error ?? 'request_failed', fields);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export async function session(context?: { signal?: AbortSignal }): Promise<Session> {
  const value = await request<Session>('/session', { signal: context?.signal });
  if (context?.signal?.aborted) throw new DOMException('Session refresh aborted', 'AbortError');
  setCsrf(value.csrf_token);
  return value;
}

// Keep the key when a response is lost. A new payload deliberately starts a new command.
export class PendingCommand {
  private payload = '';
  private key = '';
  private inFlight: Promise<unknown> | null = null;
  async send<T>(path: string, value: unknown): Promise<T> {
    const body = JSON.stringify(value);
    const fingerprint = path + '\n' + body;
    if (this.inFlight) {
      if (fingerprint !== this.payload) throw new ApiError(409, 'command_in_flight');
      return this.inFlight as Promise<T>;
    }
    if (fingerprint !== this.payload) {
      this.payload = fingerprint;
      this.key = crypto.randomUUID();
    }
    this.inFlight = request<T>(path, {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': this.key },
    });
    try {
      const result = (await this.inFlight) as T;
      this.payload = '';
      this.key = '';
      return result;
    } finally {
      this.inFlight = null;
    }
  }
}

// Field-specific hints for 422 invalid_input; the first recognised field wins.
const fieldHints: Record<string, string> = {
  task_id: '連結中的任務 ID 格式不正確。',
  run_id: '連結中的執行 ID 格式不正確。',
  canonical_repo: 'Repository URL 必須是 https:// 開頭的網址。',
  base_sha: 'Base commit SHA 必須是完整 40 或 64 字元的小寫十六進位。',
};

export function errorText(error: unknown) {
  if (error instanceof ApiError) {
    if (error.message === 'invalid_input') {
      const field = error.fields.find((name) => name in fieldHints);
      if (field) return fieldHints[field];
    }
    if (error.message === 'unsupported_capability:approval')
      return '這個執行方式不支援工具審批，請改用 OpenHands 或關閉審批。';
    if (error.message.startsWith('unsupported_capability:')) return '這個執行方式尚不支援此操作。';
    return (
      (
        {
          pause_not_ready: '目前尚未到達可接受暫停請求的狀態，請稍後再試。',
          resume_not_ready: '尚未確認安全暫停，暫時無法繼續。',
          run_deadline_expired: '本次執行已超過原定期限。',
          invalid_credentials: '帳號或密碼不正確。',
          authentication_required: '登入已過期，請重新登入。',
          csrf_rejected: '登入狀態已更新，請重新整理後再試。',
          login_rate_limited: '嘗試次數過多，請稍後再登入。',
          idempotency_conflict: '這次請求的內容與先前不同，請重新確認。',
          database_unavailable: '服務暫時無法連線，請稍後再試。',
          runtime_not_configured: '真實執行環境尚未由管理員登錄。',
          repository_revision_not_registered: '這個 repository 或 commit 尚未登錄為可用版本。',
          invalid_input: '請檢查欄位內容。',
          not_found: '找不到這筆資料，可能連結有誤或已不存在。',
          active_run_exists: '這個任務已有尚未結束的執行。',
          state_conflict: '執行狀態已改變，已重新載入。',
          approval_expired: '審批已逾期，這份核准不能再使用。',
          approval_action_changed: '待執行內容已改變，請重新查看審批。',
          approval_already_decided: '這份審批已處理或失效。',
          approval_generation_stale: '執行環境已重新接管，請使用新的審批。',
          finalizing: '正在保存結果，這個階段無法取消。',
          run_terminal: '這次執行已結束。',
          cancel_already_requested: '取消請求已受理，正在確認環境停止。',
        } as Record<string, string>
      )[error.message] ?? '操作未完成，請稍後再試。'
    );
  }
  return '連線中斷。重新送出相同內容可安全重試。';
}
