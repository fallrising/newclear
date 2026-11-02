import { createHash } from 'node:crypto';
export class MediaError extends Error { constructor(code) { super(code); this.code = code; } }
export function canonicalBytes(value) { return Buffer.from(JSON.stringify(value) + '\n'); }
export function parseStrictJson(bytes) { return JSON.parse(Buffer.from(bytes).toString()); }
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function validateInventory(value) { return { version: 1, files: value.files }; }
export function validateHeader(value) { return value; }
