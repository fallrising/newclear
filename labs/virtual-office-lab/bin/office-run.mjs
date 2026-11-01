#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {run as report} from './office-report.mjs';

export function parse(argv) {
  const [agent, separator, command, ...args] = argv;
  if (!/^[a-z][a-z0-9-]{0,23}$/.test(agent ?? '') || separator !== '--' || !command) {
    throw new Error('usage: office-run AGENT -- COMMAND [ARGS...]');
  }
  return {agent, command, args};
}
export function execute(command, args, env) {
  return new Promise(resolve => {
    // No shell interpretation, no output capture, and no reporter settings in child env.
    const childEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('OFFICE_')));
    const grouped = process.platform !== 'win32';
    const child = spawn(command, args, {env: childEnv, stdio: 'inherit', shell: false, detached: grouped});
    let cancelled = 0; let timer;
    const kill = signal => {
      try { if (grouped && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch {}
    };
    const cancel = signal => {
      if (cancelled) return;
      cancelled = signal === 'SIGINT' ? 130 : 143;
      kill(signal);
      timer = setTimeout(() => kill('SIGKILL'), 5000);
      timer.unref();
    };
    const interrupt = () => cancel('SIGINT');
    const terminate = () => cancel('SIGTERM');
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    const finish = code => {
      clearTimeout(timer);
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
      // Clean up remaining members when a cancelled group leader exits early.
      if (cancelled && grouped) kill('SIGKILL');
      resolve(cancelled || code);
    };
    child.once('error', () => finish(127));
    child.once('exit', (code, signal) => finish(signal ? 128 : code ?? 127));
  });
}
export async function run(argv, env = process.env, send = report, launch = execute, clock = {setInterval, clearInterval}) {
  const {agent, command, args} = parse(argv);
  // Disable the CLI shorthand binding: the selected agent is always explicit.
  const reporterEnv = {...env};
  delete reporterEnv.OFFICE_AGENT;
  delete reporterEnv.OFFICE_STATUS;
  const notify = status => send([agent, status, '命令生命週期', '--task', 'general'], reporterEnv);
  try { await notify('terminal'); } catch { return {exitCode: 125, reported: false, started: false}; }
  let heartbeat; let degraded = false;
  const timer = clock.setInterval(() => {
    if (heartbeat) return;
    heartbeat = Promise.resolve().then(() => notify('terminal'))
      .catch(() => { degraded = true; }).finally(() => { heartbeat = undefined; });
  }, 5 * 60 * 1000);
  let exitCode;
  try { exitCode = await launch(command, args, env); } catch { exitCode = 127; }
  finally { clock.clearInterval(timer); }
  // Never let an older heartbeat race or overwrite the final lifecycle report.
  await heartbeat;
  try {
    await notify(exitCode === 0 ? 'done' : 'error');
    return {exitCode, reported: true, started: true, ...(degraded ? {heartbeatFailed: true} : {})};
  } catch {
    return {exitCode: exitCode || 125, reported: false, started: true};
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then(result => {
    if (result.heartbeatFailed) console.error('office-run: heartbeat interrupted; final lifecycle report succeeded');
    if (!result.reported) console.error('office-run: lifecycle report failed; public state may be stale');
    process.exitCode = result.exitCode;
  }).catch(() => {
    console.error('office-run: invalid invocation');
    process.exitCode = 125;
  });
}
