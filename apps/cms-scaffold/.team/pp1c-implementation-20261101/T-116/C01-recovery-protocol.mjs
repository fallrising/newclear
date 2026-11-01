import { createHash } from 'node:crypto';

// C01 import-safe scaffold: behavior assertions must expose the missing contract.
export const canonicalBytes = value => Buffer.from(`${JSON.stringify(value)}\n`);
export const parseStrictJson = bytes => JSON.parse(Buffer.from(bytes).toString('utf8'));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const validateManifest = value => value;
export const validateLocalComplete = value => value;
export const validateRestoreVerified = value => value;
export class OpsError extends Error {
  constructor(code, phase = null, operationId = null) {
    super(code);
    Object.assign(this, { code, phase, operationId });
  }
}
