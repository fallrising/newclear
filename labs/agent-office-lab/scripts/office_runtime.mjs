import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installManualRecovery } from './manual_recovery.mjs';
import { localOnly } from './local_office_policy.mjs';

const lab = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LOCAL_MODEL = 'strata/qwen3.8-flash-next-q2_0';
export async function startLocalOffice({ out, workspace, password, port = 0, ask = false }) {
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(lab, 'vendor/agent-office'), encoding: 'utf8' }).trim(),
    '852e2ab28c4f3f31bffdf4b20353bd119c9d3270', 'Recovery adapter requires the pinned Office version');
  for (const key of Object.keys(process.env)) if (key.startsWith('AGENT_OFFICE_')) delete process.env[key];
  Object.assign(process.env, { LAB_OPENCODE_RUN: out, LAB_OPENCODE_WORKSPACE: workspace,
    LAB_OPENCODE_PERMISSION_MODE: ask ? 'ask' : 'fixture-allow' });
  const { WorkerManager } = await import('../vendor/agent-office/dist/server/server/workers.js');
  installManualRecovery(WorkerManager, workspace, LOCAL_MODEL);
  const { loadConfig } = await import('../vendor/agent-office/dist/server/server/config.js');
  const { startServer } = await import('../vendor/agent-office/dist/server/server/server.js');
  const cfg = loadConfig([workspace, '--home', path.join(out, 'office-home'), '--projects', path.join(out, 'projects'),
    '--host', '127.0.0.1', '--no-open', '--max-workers', '1', '--weather', 'clear', '--webhook', '', '--password', password,
    '--agent', path.join(lab, 'scripts/bin/opencode')]);
  cfg.port = port;
  const office = await startServer(cfg);
  for (const floor of office.floors()) localOnly(floor, LOCAL_MODEL);
  return office;
}
