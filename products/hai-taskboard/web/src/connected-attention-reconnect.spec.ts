import { BoardStream } from './connected/stream';
import { APIError, assertSafeNumbers, type Board } from './connected/client';
const board = (sequence: number, epoch = 1): Board => ({
  cursor: { stream_epoch: epoch, event_sequence: sequence },
  projection: { project_id: 'prj_0000000001', lanes: [], attention_count: 0 },
});
class Source extends EventTarget {
  close = vi.fn();
}
function event(source: Source, type: string, data: unknown) {
  source.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
}
describe('connected attention reconnect foundation', () => {
  afterEach(() => vi.useRealTimers());
  it('takes snapshot before subscription, deduplicates applied cursors, refetches on invalidation, and resets epoch', async () => {
    const sources: Source[] = [];
    const urls: string[] = [];
    const snapshot = vi
      .fn()
      .mockResolvedValueOnce(board(3))
      .mockResolvedValueOnce(board(4))
      .mockResolvedValueOnce(board(0, 2));
    const apply = vi.fn();
    const stream = new BoardStream(
      'prj_0000000001',
      snapshot,
      apply,
      vi.fn(),
      vi.fn(),
      (url) => {
        expect(apply).toHaveBeenCalled();
        urls.push(url);
        const source = new Source();
        sources.push(source);
        return source;
      },
    );
    await stream.start();
    expect(urls[0]).toContain('cursor=1:3');
    event(sources[0], 'projection', { cursor: board(3).cursor });
    expect(snapshot).toHaveBeenCalledTimes(1);
    event(sources[0], 'projection', {
      cursor: board(4).cursor,
      projection: { lanes: ['forged'] },
    });
    await vi.waitFor(() => expect(stream.cursor?.event_sequence).toBe(4));
    expect(apply.mock.calls[1][0]).toEqual(board(4));
    event(sources[0], 'projection_reset_required', {
      reason: 'epoch_mismatch',
    });
    await vi.waitFor(() => expect(urls[1]).toContain('cursor=2:0'));
    expect(sources[0].close).toHaveBeenCalled();
    stream.stop();
  });
  it('closes native reconnect on disconnect, checks snapshot, and stops permanently on auth failure', async () => {
    vi.useFakeTimers();
    const source = new Source();
    const expired = vi.fn();
    const status = vi.fn();
    const snapshot = vi
      .fn()
      .mockResolvedValueOnce(board(8))
      .mockRejectedValueOnce(
        new APIError(401, { code: 'unauthenticated', message: 'expired' }),
      );
    const stream = new BoardStream(
      'prj_0000000001',
      snapshot,
      vi.fn(),
      status,
      expired,
      () => source,
    );
    await stream.start();
    source.dispatchEvent(new Event('error'));
    expect(source.close).toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith('Disconnected');
    await vi.advanceTimersByTimeAsync(3000);
    expect(expired).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6000);
    expect(snapshot).toHaveBeenCalledTimes(2);
    stream.stop();
  });
  it('authorization revoked reset stops without another snapshot or reconnect', async () => {
    const source = new Source();
    const expired = vi.fn();
    const snapshot = vi.fn().mockResolvedValue(board(1));
    const stream = new BoardStream(
      'prj_0000000001',
      snapshot,
      vi.fn(),
      vi.fn(),
      expired,
      () => source,
    );
    await stream.start();
    event(source, 'projection_reset_required', {
      reason: 'authorization_revoked',
    });
    expect(expired).toHaveBeenCalledOnce();
    expect(snapshot).toHaveBeenCalledOnce();
    expect(source.close).toHaveBeenCalled();
  });
  it('rejects wire integers beyond JavaScript exact range before versions can become commands', () => {
    expect(() =>
      assertSafeNumbers({ expected_version: 9007199254740992 }),
    ).toThrow(/Unsafe numeric/);
    expect(() =>
      assertSafeNumbers({
        cursor: { stream_epoch: 1, event_sequence: 9007199254740992 },
      }),
    ).toThrow();
    expect(() => assertSafeNumbers(board(1))).not.toThrow();
  });
});

it('an epoch reset removes Connected authority before awaiting the fresh snapshot', async () => {
  const source = new Source();
  const status = vi.fn();
  const snapshot = vi
    .fn()
    .mockResolvedValueOnce(board(2))
    .mockImplementationOnce(() => new Promise(() => {}));
  const stream = new BoardStream(
    'prj_0000000001',
    snapshot,
    vi.fn(),
    status,
    vi.fn(),
    () => source,
  );
  await stream.start();
  source.dispatchEvent(new Event('open'));
  expect(status).toHaveBeenLastCalledWith('Connected');
  event(source, 'projection_reset_required', { reason: 'epoch_mismatch' });
  expect(source.close).toHaveBeenCalled();
  expect(status.mock.calls.at(-1)?.[0]).not.toBe('Connected');
  stream.stop();
});

it('a reset during refresh fences the old snapshot and all superseded source callbacks until new open', async () => {
  let finishOld!: (value: Board) => void;
  const sources: Source[] = [];
  const status = vi.fn();
  const apply = vi.fn();
  const expired = vi.fn();
  const snapshot = vi
    .fn()
    .mockResolvedValueOnce(board(2))
    .mockImplementationOnce(
      () =>
        new Promise<Board>((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockResolvedValueOnce(board(0, 2));
  const stream = new BoardStream(
    'prj_0000000001',
    snapshot,
    apply,
    status,
    expired,
    () => {
      const source = new Source();
      sources.push(source);
      return source;
    },
  );
  await stream.start();
  sources[0].dispatchEvent(new Event('open'));
  event(sources[0], 'projection', { cursor: board(3).cursor });
  expect(snapshot).toHaveBeenCalledTimes(2);
  event(sources[0], 'projection_reset_required', {
    reason: 'retention_expired',
  });
  expect(status).toHaveBeenLastCalledWith('Revalidating');
  sources[0].dispatchEvent(new Event('open'));
  sources[0].dispatchEvent(new Event('error'));
  event(sources[0], 'projection_reset_required', {
    reason: 'authorization_revoked',
  });
  expect(status).toHaveBeenLastCalledWith('Revalidating');
  expect(expired).not.toHaveBeenCalled();
  finishOld(board(3));
  await vi.waitFor(() => expect(sources).toHaveLength(2));
  expect(apply.mock.calls.map(([value]) => value.cursor)).toEqual([
    board(2).cursor,
    board(0, 2).cursor,
  ]);
  expect(status).toHaveBeenLastCalledWith('Revalidating');
  sources[1].dispatchEvent(new Event('open'));
  expect(status).toHaveBeenLastCalledWith('Connected');
  sources[0].dispatchEvent(new Event('error'));
  expect(status).toHaveBeenLastCalledWith('Connected');
  expect(snapshot).toHaveBeenCalledTimes(3);
  stream.stop();
});
