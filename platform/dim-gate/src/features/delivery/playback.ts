import { useEffect, useState } from 'react'
import { api, getClientIdentity } from '../../api/client'
import type { SessionView } from '../../domain/schemas'

/** Playback is view-local and opt-in: no offline catch-up or timer crosses identity/reset. */
export function useDeliveryPlayback(session: SessionView, active: boolean, refresh: () => Promise<void>) {
  const identity = `${session.sessionId}:${session.identityEpoch}:${session.policyVersion}:${session.generation}`
  const [requestedIdentity, setRequestedIdentity] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const playing = requestedIdentity === identity && active
  useEffect(() => {
    if (!playing) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      const current = getClientIdentity()
      if (stopped || !current || `${current.sessionId}:${current.identityEpoch}:${current.policyVersion}:${current.generation}` !== identity) return
      try {
        await api.advanceClock(1)
        if (stopped) return
        await refresh()
        if (!stopped) timer = setTimeout(() => { void tick() }, 1000)
      } catch (cause) {
        if (!stopped) { setError(cause); setRequestedIdentity(null) }
      }
    }
    timer = setTimeout(() => { void tick() }, 1000)
    return () => { stopped = true; clearTimeout(timer) }
  }, [identity, playing, refresh])
  return { playing, error, toggle: () => { setError(null); setRequestedIdentity(playing ? null : identity) } }
}
