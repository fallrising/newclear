import { OpsError } from './recovery-protocol.mjs';

// C09 import-safe scaffold; valid private bundles become accepted in C10a.
export async function verifyCapturedBundle(token, backupId, deps = {}) {
  throw new OpsError('ADAPTER_UNSEALED');
}
