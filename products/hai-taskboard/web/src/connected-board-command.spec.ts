import { CommandRunner, type Intent, type Result } from './connected/commands';
import { metadata } from './connected/client';

it.each([
  ['2026-10-23T08:00:00.000Z', '2026-10-23T08:00:00Z'],
  ['2026-10-23T08:00:00.100Z', '2026-10-23T08:00:00.1Z'],
  ['2026-10-23T08:00:00.120Z', '2026-10-23T08:00:00.12Z'],
  ['2026-10-23T08:00:00.123Z', '2026-10-23T08:00:00.123Z'],
])('captures canonical UTC timestamp for %s', (instant, expected) => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date(instant));
    const captured = metadata(3);
    expect(captured.issued_at).toBe(expected);
    expect(Date.parse(captured.issued_at)).toBe(Date.parse(instant));
    vi.advanceTimersByTime(1000);
    expect(captured.issued_at).toBe(expected);
  } finally {
    vi.useRealTimers();
  }
});
const intent: Intent = {
  project: 'prj_0000000001',
  url: '/api/v1/projects/prj_0000000001/commands',
  body: '{"command_id":"cmd_0000000001","idempotency_key":"exact-uuid","expected_version":3}',
  commandID: 'cmd_0000000001',
};
describe('connected command identity and uncertain-result contract', () => {
  it('keeps a captured intent pending, blocks double submission, and preserves a guard rejection', async () => {
    let finish!: (result: Result) => void;
    const request = vi.fn(
      () =>
        new Promise<Result>((resolve) => {
          finish = resolve;
        }),
    );
    const runner = new CommandRunner(request, vi.fn());
    const pending = runner.submit(intent);
    expect(runner.state.status).toBe('pending');
    expect(runner.state.intent).toEqual(intent);
    await runner.submit({ ...intent, body: 'different intent' });
    expect(request).toHaveBeenCalledTimes(1);
    const rejected = {
      ok: false,
      error: {
        code: 'version_conflict',
        message: 'Expected version 3; current version 4',
        details: { guard: 'refresh and review' },
      },
    };
    finish(rejected);
    await pending;
    expect(runner.state.result).toEqual(rejected);
    expect(runner.state.intent?.body).toBe(intent.body);
  });
  it('looks up only the original command after response loss and never retries a POST', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('response lost'))
      .mockRejectedValueOnce(new TypeError('lookup unavailable'))
      .mockResolvedValueOnce({ ok: true, result: { type: 'RunDispatched' } });
    const runner = new CommandRunner(request, vi.fn());
    await runner.submit(intent);
    expect(runner.state.status).toBe('uncertain');
    expect(runner.state.intent).toEqual(intent);
    await runner.submit(intent);
    expect(request).toHaveBeenCalledTimes(2);
    await runner.recover();
    expect(request.mock.calls[1]).toEqual([
      intent.url + '/' + intent.commandID,
    ]);
    expect(request.mock.calls[2]).toEqual([
      intent.url + '/' + intent.commandID,
    ]);
    expect(request).toHaveBeenCalledTimes(3);
    expect(runner.state.status).toBe('settled');
  });
});

it('resolves a lost response through exactly one automatic original-result lookup without another command', async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('timeout'))
    .mockResolvedValueOnce({ ok: true, result: { type: 'RunDispatched' } });
  const runner = new CommandRunner(request, vi.fn());
  await runner.submit(intent);
  expect(request.mock.calls).toEqual([
    [intent.url, intent.body],
    [intent.url + '/' + intent.commandID],
  ]);
  expect(runner.state.status).toBe('settled');
  expect(runner.state.intent).toEqual(intent);
  expect(runner.state.result?.result?.type).toBe('RunDispatched');
});
