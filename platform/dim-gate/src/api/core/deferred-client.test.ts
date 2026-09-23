import { describe, expect, it, vi } from 'vitest'
import { deferredClient } from './deferred-client'
import type { ClientIdentity } from './identity'

const original: ClientIdentity = { actorId: 'user-rd-commerce', sessionId: 'session-one', generation: 0, policyVersion: 1, identityEpoch: 1 }
function held() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

describe('feature client loading retains call-time authority', () => {
  it.each(['actorId', 'sessionId', 'generation', 'policyVersion', 'identityEpoch'] as const)('rejects held reads and commands after %s changes before any transport', async key => {
    let current: ClientIdentity | null = { ...original }
    const gate = held(), read = vi.fn(async () => 'private'), command = vi.fn(async () => 'committed')
    const client = deferredClient(async () => { await gate.promise; return { read, command } }, { read: true, command: true }, () => current)
    const pendingRead = expect(client.read()).rejects.toMatchObject({ code: 'STALE_RESPONSE', status: 409 })
    const pendingCommand = expect(client.command()).rejects.toMatchObject({ code: 'STALE_RESPONSE', status: 409 })
    current = { ...original, [key]: typeof original[key] === 'number' ? Number(original[key]) + 1 : `${original[key]}-changed` }
    gate.release()
    await Promise.all([pendingRead, pendingCommand])
    expect(read).not.toHaveBeenCalled(); expect(command).not.toHaveBeenCalled()
    current = null
    await expect(client.command()).rejects.toMatchObject({ code: 'NOT_INITIALIZED', status: 401 })
    expect(command).not.toHaveBeenCalled()
  })

  it('loads once, freezes input at call time and still returns the transport result', async () => {
    const gate = held(), command = vi.fn(async (body: { reason: string }) => body.reason)
    const load = vi.fn(async () => { await gate.promise; return { command } })
    const client = deferredClient(load, { command: true }, () => original)
    const body = { reason: 'original reason' }, pending = client.command(body)
    body.reason = 'changed while loading'
    gate.release()
    await expect(pending).resolves.toBe('original reason')
    await expect(client.command({ reason: 'next command' })).resolves.toBe('next command')
    expect(load).toHaveBeenCalledTimes(1)
    expect(command).toHaveBeenCalledTimes(2)
  })

  it('retries a failed module load without dispatching a phantom command', async () => {
    const command = vi.fn(async () => 'committed')
    const load = vi.fn<() => Promise<{ command: typeof command }>>()
      .mockRejectedValueOnce(new Error('chunk unavailable')).mockResolvedValue({ command })
    const client = deferredClient(load, { command: true }, () => original)
    await expect(client.command()).rejects.toThrow('chunk unavailable')
    expect(command).not.toHaveBeenCalled()
    await expect(client.command()).resolves.toBe('committed')
    expect(load).toHaveBeenCalledTimes(2); expect(command).toHaveBeenCalledTimes(1)
  })
})
