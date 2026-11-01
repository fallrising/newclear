export type Cursor = { stream_epoch: number; event_sequence: number };
export type Project = {
  project_id: string;
  name: string;
  version: number;
  cursor: Cursor;
  repository: {
    binding_id: string | null;
    root_hint: string;
    approved_ref: string;
  };
};
export type Item = {
  work_item_id: string;
  title: string;
  phase: string;
  version: number;
  human_owner_id: string;
  effective_satisfied: boolean;
  required_ac_count: number;
  covered_ac_count: number;
  active_blocker_count: number;
  conditions: string[];
  current_run?: {
    run_id: string;
    observed_state: string;
    dispatch_state: string;
    reconciliation_state: string;
    last_observed_at?: string;
  } | null;
};
export type Board = {
  cursor: Cursor;
  projection: {
    project_id: string;
    lanes: { key: string; items: Item[] }[];
    attention_count: number;
  };
};
export type Preparation = {
  proposal_digest: string;
  policy_revision_digest: string;
  acceptance_subject_digest: string;
  expected_version: number;
  work_items: { work_item_id: string; expected_version: number }[];
  ac_revisions: { ac_id: string; revision_digest: string }[];
};
export type Binding = {
  binding_digest: string;
  binding: {
    id: string;
    version: number;
    approved_by_actor: string;
    refs: string[];
    manifest_paths: string[];
  };
};
export type Failure = { code: string; message: string; details?: unknown };
export class APIError extends Error {
  constructor(
    readonly status: number,
    readonly error: Failure,
  ) {
    super(error.message);
  }
}
export async function request<T>(
  url: string,
  body?: string,
  method = body === undefined ? 'GET' : 'POST',
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
      ...(body === undefined
        ? {}
        : { body, headers: { 'Content-Type': 'application/json' } }),
    });
    const data = await response.json();
    assertSafeNumbers(data);
    if (!response.ok)
      throw new APIError(
        response.status,
        data.error || {
          code: 'unavailable',
          message: `Request unavailable (${response.status}).`,
        },
      );
    return data as T;
  } finally {
    clearTimeout(timeout);
  }
}
export function identifier(prefix: string) {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const random = crypto.getRandomValues(new Uint8Array(20));
  return prefix + '_' + Array.from(random, (v) => alphabet[v & 31]).join('');
}
export function metadata(expected_version: number) {
  if (!Number.isSafeInteger(expected_version) || expected_version < 0)
    throw new TypeError('Unsafe expected version.');
  return {
    command_id: identifier('cmd'),
    idempotency_key: crypto.randomUUID(),
    expected_version,
    issued_at: new Date()
      .toISOString()
      .replace(/(\.\d*?)0+Z$/, '$1Z')
      .replace(/\.Z$/, 'Z'),
  };
}
export const projectPath = (id: string) =>
  '/api/v1/projects/' + encodeURIComponent(id);
export const cursorText = (cursor: Cursor) =>
  `${cursor.stream_epoch}:${cursor.event_sequence}`;
export function newer(next: Cursor, previous: Cursor) {
  return (
    next.stream_epoch === previous.stream_epoch &&
    next.event_sequence > previous.event_sequence
  );
}

export function assertSafeNumbers(value: unknown): void {
  if (typeof value === 'number' && !Number.isSafeInteger(value))
    throw new TypeError(
      'Unsafe numeric server value; cannot capture an exact version or cursor.',
    );
  if (value && typeof value === 'object')
    for (const child of Object.values(value)) assertSafeNumbers(child);
}
