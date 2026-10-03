import { useEffect, useState } from 'react'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, getClientIdentity } from '../../api/client'
import { demoClockMutationKey } from '../../api/query-definitions'
import type { SessionView } from '../../domain/schemas'

/** Playback is view-local; pending clock ownership survives SPA view unmounts. */
export function useDeliveryPlayback(session: SessionView, active: boolean, refresh: () => Promise<void>) {
  const identity = `${session.sessionId}:${session.identityEpoch}:${session.policyVersion}:${session.generation}`
  const [requestedIdentity, setRequestedIdentity] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const cache = useQueryClient()
  const pending = useIsMutating({ mutationKey: demoClockMutationKey }) > 0
  const { mutateAsync: advance } = useMutation({ mutationKey: demoClockMutationKey, mutationFn: async () => {
    await api.advanceClock(1)
    // Mutation ownership lasts through refresh, including after pause/unmount.
    await refresh()
  } })
  const playing = requestedIdentity === identity && active
  useEffect(() => {
    if (!playing) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      const current = getClientIdentity()
      if (stopped || !current || `${current.sessionId}:${current.identityEpoch}:${current.policyVersion}:${current.generation}` !== identity) return
      if (cache.isMutating({ mutationKey: demoClockMutationKey })) return
      try {
        await advance()
        if (!stopped) timer = setTimeout(() => { void tick() }, 1000)
      } catch (cause) {
        if (!stopped) { setError(cause); setRequestedIdentity(null) }
      }
    }
    timer = setTimeout(() => { void tick() }, 1000)
    return () => { stopped = true; clearTimeout(timer) }
  }, [identity, playing, advance, cache])
  return { playing, pending, error, toggle: () => {
    if (!playing && cache.isMutating({ mutationKey: demoClockMutationKey })) return
    setError(null)
    setRequestedIdentity(playing ? null : identity)
  } }
}
