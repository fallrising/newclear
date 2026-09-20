import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FlaskConical } from 'lucide-react'
import { api, getClientIdentity, queryKey } from '../../api/client'
import { Brand } from '../../components/shared/brand'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { AppShell } from '../shell/AppShell'

function identityToken() {
  const identity = getClientIdentity()
  return identity ? `${identity.sessionId}:${identity.identityEpoch}:${identity.policyVersion}:${identity.generation}` : 'uninitialized'
}

// Query invalidation is driven by committed API changes, never optimistic domain state.
export function AppSession() {
  const cache = useQueryClient()
  const [identity, setIdentity] = useState(identityToken)
  const lastIdentity = useRef(identity)
  useEffect(() => api.subscribe(() => {
    const next = identityToken()
    if (next !== lastIdentity.current) {
      lastIdentity.current = next
      void cache.cancelQueries()
      cache.clear()
      setIdentity(next)
    } else {
      void cache.invalidateQueries()
    }
  }), [cache])
  const session = useQuery({ queryKey: [...queryKey('session'), identity], queryFn: () => api.getSession() })
  if (session.isPending) return <div className="startup-page"><Brand /><p className="startup-demo-label"><FlaskConical size={16} aria-hidden="true" />示範資料 · 未連接真實雲端</p><LoadingState label="正在確認示範身分與可用工作區…" /></div>
  if (session.isError) return <div className="startup-page"><Brand /><p className="startup-demo-label"><FlaskConical size={16} aria-hidden="true" />示範資料 · 未連接真實雲端</p><ErrorState error={session.error} onRetry={() => void session.refetch()} /></div>
  return <AppShell session={session.data} />
}
