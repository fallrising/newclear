export type SpliceRow = {
  seq: number;
  kind: string;
  body?: string;
};

export type SpliceEvent = {
  seq: number;
  kind: string;
  replay: boolean;
};

export type SpliceInput = {
  d1_persisted: SpliceRow[];
  after_seq: number;
  live: SpliceRow[];
};

export type SpliceResult = {
  events: SpliceEvent[];
  gap: boolean;
};

/** Catch-up (replay:true) then live (replay:false). Live min seq > cursor+1 emits gap and not the jumped live. */
export function spliceEvents(input: SpliceInput): SpliceResult {
  const catchup = input.d1_persisted
    .filter((row) => row.seq > input.after_seq)
    .sort((a, b) => a.seq - b.seq)
    .map((row) => ({ seq: row.seq, kind: row.kind, replay: true }));

  const cursor = catchup.length > 0 ? catchup[catchup.length - 1]!.seq : input.after_seq;
  const live = input.live.filter((row) => row.seq > cursor).sort((a, b) => a.seq - b.seq);

  if (live.length > 0 && live[0]!.seq > cursor + 1) {
    return { events: catchup, gap: true };
  }

  const liveEvents = live.map((row) => ({ seq: row.seq, kind: row.kind, replay: false }));
  return { events: [...catchup, ...liveEvents], gap: false };
}
