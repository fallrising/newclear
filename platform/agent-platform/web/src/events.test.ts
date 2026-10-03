import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeEvents, parseEvent, readEvents } from './events';
import { ApiError, type RunEvent } from './api';

const first: RunEvent = {
  event_id: 'evt-1',
  run_id: 'run-1',
  seq: 1,
  type: 'message.created',
  created_at: '2026-09-21T00:00:00Z',
  payload: { content: '你好 <script>unsafe</script>' },
};
afterEach(() => vi.unstubAllGlobals());
describe('durable event client', () => {
  it('deduplicates event IDs and preserves server sequence order', () => {
    const later = { ...first, event_id: 'evt-2', seq: 2 };
    const merged = mergeEvents([later], first);
    expect(merged.map((e) => e.seq)).toEqual([1, 2]);
    expect(mergeEvents(merged, first)).toBe(merged);
  });
  it('parses split UTF-8 and CRLF frames without losing a message', async () => {
    const bytes = new TextEncoder().encode(
      `: keepalive\r\n\r\nid: 1\r\ndata: ${JSON.stringify(first)}\r\n\r\n`,
    );
    const body = new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
        ),
    );
    const received: RunEvent[] = [];
    await readEvents('run-1', 0, new AbortController().signal, (e) => received.push(e));
    expect(received).toEqual([first]);
  });
  it('passes the durable cursor and handles archived history explicitly', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ error: 'events_archived' }, { status: 410 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(
      readEvents('run-1', 42, new AbortController().signal, vi.fn()),
    ).rejects.toMatchObject({ status: 410 });
    expect(fetcher.mock.calls[0][0]).toContain('after_seq=42');
  });
  it('stops on session revocation and rejects cross-run data', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('event: session_expired\ndata: {}\n\n'))
        .mockResolvedValueOnce(new Response(`data: ${JSON.stringify(first)}\n\n`)),
    );
    await expect(
      readEvents('run-1', 0, new AbortController().signal, vi.fn()),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      readEvents('different-run', 0, new AbortController().signal, vi.fn()),
    ).rejects.toThrow('invalid_event');
  });
  it('ignores heartbeat frames', () => {
    expect(parseEvent(': keepalive')).toBeNull();
  });
});
