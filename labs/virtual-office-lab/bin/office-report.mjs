#!/usr/bin/env node
import {open, constants} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {STATES, TASKS, summaryFor, boundedJson} from '../src/core.mjs';

export function buildReport(argv, env = process.env) {
  const args = [...argv]; const dryIndex = args.indexOf('--dry-run');
  const dryRun = dryIndex !== -1; if (dryRun) args.splice(dryIndex, 1);
  let taskType = 'general'; const taskIndex = args.indexOf('--task');
  if (taskIndex !== -1) { taskType = args[taskIndex + 1]; args.splice(taskIndex, 2); }
  let [agentId, status, summary, peers = ''] = args;
  if (env.OFFICE_AGENT && args.length <= 2) { agentId = env.OFFICE_AGENT; status = env.OFFICE_STATUS ?? 'thinking'; [summary, peers = ''] = args; }
  else if (args.length < 3 || args.length > 4) throw new Error('usage: office-report AGENT STATUS "SUMMARY" [peer1,peer2] [--task TYPE] [--dry-run]');
  if (!/^[a-z][a-z0-9-]{0,23}$/.test(agentId ?? '') || !STATES.includes(status) || !TASKS.includes(taskType) || typeof summary !== 'string' || !summary.trim() || [...summary].length > 80 || /[\p{Cc}\p{Cf}]/u.test(summary)) throw new Error('invalid arguments; summary must be 1–80 Unicode code points without control characters');
  const collaborators = peers ? peers.split(',') : [];
  if (collaborators.length > 3 || new Set(collaborators).size !== collaborators.length || collaborators.some(p => !/^[a-z][a-z0-9-]{0,23}$/.test(p) || p === agentId)) throw new Error('invalid collaborators');
  // Deliberate privacy boundary: raw summary is neither transmitted nor printed.
  return {dryRun, publicSummary: summaryFor(status, taskType), report: {agentId, status, taskType, collaborators, eventId: randomUUID(), expectedRevision: 0}};
}
export function officeUrl(value) {
  let url; try { url = new URL(value); } catch { throw new Error('OFFICE_URL must be an origin'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('HTTPS required except exact loopback; no credentials, path or query allowed');
  return url.origin;
}
export async function readToken(env) {
  let token = env.OFFICE_TOKEN;
  if (env.OFFICE_TOKEN_FILE) {
    // No symlinks; POSIX owner-only file. No secret in argv or source control.
    const file = await open(env.OFFICE_TOKEN_FILE, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 129 || (stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) throw new Error('token file must be owner-only, regular and <=129 bytes');
      token = (await file.readFile('utf8')).trim();
    } finally { await file.close(); }
  }
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token ?? '')) throw new Error('missing or invalid reporter token');
  return token;
}
async function send(fetcher, url, init, sleep) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try { response = await fetcher(url, {...init, redirect: 'error', signal: AbortSignal.timeout(3000)}); }
    catch { if (attempt === 2) throw new Error('transport failed after 3 attempts'); }
    if (response) {
      if (response.ok) return boundedJson(response, 65536);
      if (response.status !== 429 && response.status < 500) throw new Error(`office API rejected request (${response.status})`);
      const retry = response.headers.get('retry-after');
      if (retry && (!/^\d+$/.test(retry) || Number(retry) > 2)) throw new Error('rate limited; retry later with a new invocation');
      if (attempt === 2) throw new Error(`office API unavailable (${response.status})`);
      await response.body?.cancel();
      await sleep(retry ? Number(retry) * 1000 : 250 * (attempt + 1));
    } else await sleep(250 * (attempt + 1));
  }
}
export async function run(argv, env = process.env, fetcher = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const {report, dryRun, publicSummary} = buildReport(argv, env);
  if (dryRun) return {dryRun: true, ...report, summary: publicSummary};
  const origin = officeUrl(env.OFFICE_URL); const token = await readToken(env);
  const state = await send(fetcher, `${origin}/state`, {method: 'GET'}, sleep);
  const bot = state?.bots?.find(b => b.id === report.agentId);
  if (state.mode !== 'live' || !bot || !Number.isSafeInteger(bot.revision) || bot.revision < 0) throw new Error('live office or registered agent unavailable');
  report.expectedRevision = bot.revision;
  // Reuse identical event ID and expected revision on every bounded retry.
  const result = await send(fetcher, `${origin}/report`, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${token}`}, body: JSON.stringify(report)}, sleep);
  if (result?.ok !== true || !Number.isSafeInteger(result.revision)) throw new Error('invalid acknowledgement');
  return {ok: true, duplicate: result.duplicate === true, revision: result.revision};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(() => {
    // Do not echo input, remote response, URL, token file path or arbitrary errors.
    console.error('office-report failed; check arguments, secret configuration, endpoint and rate limits');
    process.exitCode = 1;
  });
}
