import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, PendingCommand, errorText, request, setCsrf, session } from './api';

afterEach(() => vi.unstubAllGlobals());
describe('command delivery', () => {
  it('retains the same key and payload after a lost response', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('connection lost'))
      .mockResolvedValueOnce(Response.json({ id: 'one' }));
    vi.stubGlobal('fetch', fetcher);
    setCsrf('session-csrf');
    const command = new PendingCommand();
    await expect(command.send('/tasks', { goal: 'one task' })).rejects.toThrow('connection lost');
    await expect(command.send('/tasks', { goal: 'one task' })).resolves.toEqual({ id: 'one' });
    const first = fetcher.mock.calls[0][1];
    const second = fetcher.mock.calls[1][1];
    expect(first.headers['Idempotency-Key']).toBe(second.headers['Idempotency-Key']);
    expect(first.body).toBe(second.body);
    expect(second.headers['X-CSRF-Token']).toBe('session-csrf');
  });
  it('coalesces concurrent submits and refuses an in-flight payload change', async () => {
    let deliver!: (value: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          deliver = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const command = new PendingCommand();
    const first = command.send('/tasks', { goal: 'first' });
    const second = command.send('/tasks', { goal: 'first' });
    await expect(command.send('/tasks', { goal: 'changed' })).rejects.toBeInstanceOf(ApiError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    deliver(Response.json({ id: 'one' }));
    expect(await first).toEqual(await second);
  });
  it('uses a new command after a confirmed result or an explicitly changed payload', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: 'one' }))
      .mockResolvedValueOnce(Response.json({ id: 'two' }));
    vi.stubGlobal('fetch', fetcher);
    const command = new PendingCommand();
    await command.send('/projects', { name: 'same' });
    await command.send('/projects', { name: 'same' });
    expect(fetcher.mock.calls[0][1].headers['Idempotency-Key']).not.toBe(
      fetcher.mock.calls[1][1].headers['Idempotency-Key'],
    );
  });
});

it('ignores an old session refresh after an authentication transition cancels it', async () => {
  let deliver!: (value: Response) => void;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          deliver = resolve;
        }),
    )
    .mockResolvedValueOnce(Response.json({ id: 'one' }));
  vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  const refresh = session({ signal: controller.signal });
  controller.abort();
  setCsrf('newer-session-csrf');
  deliver(Response.json({ authenticated: false, username: null, csrf_token: 'obsolete-csrf' }));
  await expect(refresh).rejects.toMatchObject({ name: 'AbortError' });
  await new PendingCommand().send('/tasks', { goal: 'one' });
  expect(fetcher.mock.calls[1][1].headers['X-CSRF-Token']).toBe('newer-session-csrf');
});

describe('error text', () => {
  it('names the rejected field and missing resources', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: 'invalid_input', fields: [['body', 'canonical_repo']] },
            { status: 422 },
          ),
        ),
    );
    const error = await request('/projects').catch((e: unknown) => e);
    expect(errorText(error)).toContain('https://');
    expect(errorText(new ApiError(422, 'invalid_input', ['task_id']))).toContain('任務 ID');
    expect(errorText(new ApiError(422, 'invalid_input'))).toBe('請檢查欄位內容。');
    expect(errorText(new ApiError(404, 'not_found'))).toContain('找不到');
    expect(errorText(new ApiError(409, 'unsupported_capability:approval'))).toContain('審批');
    expect(errorText(new ApiError(409, 'unsupported_capability:pause'))).toContain('不支援');
  });
});
