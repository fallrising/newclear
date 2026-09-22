export type Session = { authenticated: boolean; username: string | null; csrf_token: string };
export type Project = { id: string; name: string; canonical_repo: string };
export type Profile = {
  id: string;
  profile_id: string;
  revision: number;
  name: string;
  backend: string;
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
  state: string;
  state_version: number;
  base_sha: string;
  goal: string;
  cleanup_state: string;
  last_event_seq: number;
  event_floor: number;
  execution_mode?: string;
  capabilities?: Record<string, boolean | string>;
  result: {
    diff?: string;
    diff_sha256?: string;
    summary: string;
    verification: { status: string; reason: string };
  } | null;
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
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
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
    throw new ApiError(response.status, body.error ?? 'request_failed');
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

export function errorText(error: unknown) {
  if (error instanceof ApiError) {
    return (
      (
        {
          invalid_credentials: '帳號或密碼不正確。',
          authentication_required: '登入已過期，請重新登入。',
          csrf_rejected: '登入狀態已更新，請重新整理後再試。',
          login_rate_limited: '嘗試次數過多，請稍後再登入。',
          idempotency_conflict: '這次請求的內容與先前不同，請重新確認。',
          database_unavailable: '服務暫時無法連線，請稍後再試。',
          runtime_not_configured: '真實執行環境尚未由管理員登錄。',
          repository_revision_not_registered: '這個 repository 或 commit 尚未登錄為可用版本。',
          invalid_input: '請檢查欄位內容與 commit SHA。',
          active_run_exists: '這個任務已有尚未結束的執行。',
          state_conflict: '執行狀態已改變，請重新整理。',
        } as Record<string, string>
      )[error.message] ?? '操作未完成，請稍後再試。'
    );
  }
  return '連線中斷。重新送出相同內容可安全重試。';
}
