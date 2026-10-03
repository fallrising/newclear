// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientIdentity } from '../../api/core/identity'
import type { CommandReceipt } from '../../domain/schemas'
import { useServiceCommand } from './commands'

const scope = vi.hoisted(() => ({ current: null as ClientIdentity | null }))
vi.mock('../../api/client', async () => {
  const { ApiRequestError } = await import('../../api/core/errors')
  return { ApiRequestError, getClientIdentity: () => scope.current }
})
const receipt: CommandReceipt = { entityType: 'serviceConfig', entityId: 'config-new', entityVersion: 1, correlationId: 'corr-new', changed: [] }
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
function mount(readBack: (receipt: CommandReceipt) => Promise<unknown>) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={cache}>{children}</QueryClientProvider>
  return { cache, ...renderHook(() => useServiceCommand(readBack), { wrapper }) }
}
beforeEach(() => { scope.current = { sessionId: 'session-one', actorId: 'rd-one', identityEpoch: 1, generation: 1, policyVersion: 1 } })
afterEach(cleanup)

describe('W3 command completion and readback ownership', () => {
  it('keeps pending until committed detail and active audit queries finish reading back', async () => {
    const detail = deferred(), audit = deferred()
    const command = vi.fn(async () => receipt)
    const readBack = vi.fn(() => detail.promise)
    const { result, cache } = mount(readBack)
    vi.spyOn(cache, 'invalidateQueries').mockImplementation(() => audit.promise)
    let completion!: Promise<CommandReceipt>
    act(() => { completion = result.current.mutateAsync(command) })
    await waitFor(() => expect(result.current.isPending).toBe(true))
    expect(command).toHaveBeenCalledTimes(1)
    expect(result.current.committed).toBe(true)
    await act(async () => { detail.resolve(); await detail.promise })
    expect(result.current.isPending).toBe(true)
    await act(async () => { audit.resolve(); await completion })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(readBack).toHaveBeenCalledWith(receipt)
  })

  it('retries a failed readback using its original receipt without creating another revision', async () => {
    const command = vi.fn(async () => receipt)
    const readBack = vi.fn<(receipt: CommandReceipt) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('Detail response unavailable')).mockResolvedValueOnce(undefined)
    const { result } = mount(readBack)
    await act(async () => { await expect(result.current.mutateAsync(command)).rejects.toThrow('Detail response unavailable') })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.committed).toBe(true)
    await act(async () => { await expect(result.current.mutateAsync(command)).resolves.toEqual(receipt) })
    expect(command).toHaveBeenCalledTimes(1)
    expect(readBack).toHaveBeenCalledTimes(2)
    expect(readBack.mock.calls.map(call => call[0])).toEqual([receipt, receipt])
  })

  it('refuses completion and receipt reuse after the initiating identity loses its scope', async () => {
    const detail = deferred()
    const command = vi.fn(async () => receipt)
    const { result } = mount(() => detail.promise)
    let error: unknown
    let completion!: Promise<void>
    act(() => { completion = result.current.mutateAsync(command).then(() => { throw new Error('Unexpected completion under changed scope') }, cause => { error = cause }) })
    await waitFor(() => expect(result.current.committed).toBe(true))
    scope.current = { ...scope.current!, policyVersion: 2, identityEpoch: 2 }
    await act(async () => { detail.resolve(); await completion })
    expect(error).toMatchObject({ code: 'STALE_RESPONSE', status: 409 })
    await act(async () => { await expect(result.current.mutateAsync(command)).rejects.toMatchObject({ code: 'STALE_RESPONSE' }) })
    expect(command).toHaveBeenCalledTimes(1)
  })
})
