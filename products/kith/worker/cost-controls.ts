import { flagOn, type Env } from "./env.ts";

export type PaidLimits = { daily: number; agentDaily: number; concurrency: number };
export type PaidAttempt = { generationId: string; agentId: string; roomId: string; attempt: number };
export type PaidLedger = {
  day: string;
  total: number;
  agents: Record<string, number>;
  attempts: Record<string, { agentId: string; roomId: string }>;
  leases: Record<string, number>;
};
export const PAID_LEASE_MS = 330_000;

function limit(raw: string | undefined, max: number): number | null {
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= max ? value : null;
}

export function paidLimits(env: Env): PaidLimits | null {
  if (!flagOn(env.ff_hosted_agent) || !flagOn(env.KITH_PAID_ENABLED)) return null;
  const daily = limit(env.KITH_MAX_PAID_ATTEMPTS_PER_DAY, 1000);
  const agentDaily = limit(env.KITH_MAX_AGENT_ATTEMPTS_PER_DAY, daily ?? 0);
  const concurrency = limit(env.KITH_MAX_PAID_CONCURRENCY, 8);
  return daily && agentDaily && concurrency ? { daily, agentDaily, concurrency } : null;
}

export function paidCallsEnabled(env: Env): boolean { return paidLimits(env) !== null; }

/** Pure transition, called under one DO storage transaction. Counts survive lease expiry/release. */
export function reserveLedger(previous: PaidLedger | undefined, input: PaidAttempt, caps: PaidLimits, now: number): PaidLedger | null {
  if (![input.generationId, input.agentId, input.roomId].every((id) => typeof id === "string" && id.length > 0 && id.length <= 128 && !["__proto__", "constructor", "prototype"].includes(id)) || ![0, 1].includes(input.attempt)) return null;
  const day = new Date(now).toISOString().slice(0, 10);
  const ledger: PaidLedger = previous?.day === day
    ? structuredClone(previous)
    : { day, total: 0, agents: {}, attempts: {}, leases: { ...(previous?.leases ?? {}) } };
  for (const [id, expires] of Object.entries(ledger.leases)) if (expires <= now) delete ledger.leases[id];
  const key = `${input.generationId}:${input.attempt}`;
  const prior = Object.hasOwn(ledger.attempts, key) ? ledger.attempts[key] : undefined;
  const leased = Object.hasOwn(ledger.leases, input.generationId);
  const agentAttempts = Object.hasOwn(ledger.agents, input.agentId) ? ledger.agents[input.agentId] : 0;
  if (prior) return prior.agentId === input.agentId && prior.roomId === input.roomId && leased ? ledger : null;
  if (ledger.total >= caps.daily || agentAttempts >= caps.agentDaily) return null;
  if (!leased && Object.keys(ledger.leases).length >= caps.concurrency) return null;
  ledger.total += 1;
  ledger.agents[input.agentId] = agentAttempts + 1;
  ledger.attempts[key] = { agentId: input.agentId, roomId: input.roomId };
  if (!leased) ledger.leases[input.generationId] = now + PAID_LEASE_MS;
  return ledger;
}

type Accounting = DurableObjectStub & {
  reservePaidAttempt(input: PaidAttempt): Promise<boolean>;
  releasePaidAttempt(generationId: string): Promise<void>;
};
function accounting(env: Env): Accounting { return env.ROOM.get(env.ROOM.idFromName("cost:global")) as Accounting; }
export async function reservePaidAttempt(env: Env, input: PaidAttempt): Promise<boolean> {
  if (!paidCallsEnabled(env)) return false;
  try { return await accounting(env).reservePaidAttempt(input); } catch { return false; }
}
export async function releasePaidAttempt(env: Env, generationId: string): Promise<void> {
  await accounting(env).releasePaidAttempt(generationId);
}
