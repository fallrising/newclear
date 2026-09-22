import { ApiError, type RunEvent } from './api';

export function mergeEvents(previous: RunEvent[], incoming: RunEvent): RunEvent[] {
  if (previous.some((event) => event.event_id === incoming.event_id)) return previous;
  return [...previous, incoming].sort((a, b) => a.seq - b.seq);
}
export function parseEvent(frame: string): { kind: string; data: unknown } | null {
  const lines = frame.split(/\r?\n/);
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return null;
  return {
    kind:
      lines
        .find((line) => line.startsWith('event:'))
        ?.slice(6)
        .trim() ?? 'message',
    data: JSON.parse(data),
  };
}
export async function readEvents(
  runId: string,
  after: number,
  signal: AbortSignal,
  onEvent: (event: RunEvent) => void,
) {
  const response = await fetch(
    `/api/v1/runs/${encodeURIComponent(runId)}/events?after_seq=${after}`,
    {
      credentials: 'same-origin',
      headers: { Accept: 'text/event-stream' },
      signal,
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body.error ?? 'stream_failed');
  }
  if (!response.body) throw new Error('stream_unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) return;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 1_000_000) throw new Error('event_too_large');
      let separator: RegExpExecArray | null;
      while ((separator = /\r\n\r\n|\n\n|\r\r/.exec(buffer)) !== null) {
        const parsed = parseEvent(buffer.slice(0, separator.index));
        buffer = buffer.slice(separator.index + separator[0].length);
        if (parsed?.kind === 'session_expired') throw new ApiError(401, 'authentication_required');
        if (parsed?.kind === 'stream_error') throw new ApiError(410, 'events_archived');
        if (parsed?.kind === 'message') {
          const event = parsed.data as RunEvent;
          if (
            event.run_id !== runId ||
            !Number.isSafeInteger(event.seq) ||
            event.seq <= 0 ||
            typeof event.event_id !== 'string'
          )
            throw new Error('invalid_event');
          onEvent(event);
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
