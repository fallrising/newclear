/** Application caps. Exceeding any cap is a reject (or backpressure) contract, never a silent drop. */

export const BODY_MAX_BYTES = 8192;
export const STATUS_MAX_BYTES = 512;
export const FANOUT_CHUNK = 6;
export const MEMBERS_PER_ROOM = 32;
export const WAKE_PER_MINUTE = 6;
export const INBOX_LIVE_BUFFER = 128;
