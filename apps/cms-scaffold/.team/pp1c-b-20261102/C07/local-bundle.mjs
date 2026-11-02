import { OpsError } from './recovery-protocol.mjs';
export async function captureSource(_token, _deps = {}) { throw new OpsError('ADAPTER_UNSEALED'); }
export async function captureLocal(_inspection, _request, _deps = {}) { throw new OpsError('ADAPTER_UNSEALED'); }
