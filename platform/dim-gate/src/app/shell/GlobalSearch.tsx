import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, queryKey } from '../../api/client'
import type { EntitySearchHit, TopologyClient } from '../../api/clients/topology'
import type { SessionView } from '../../domain/schemas'
import { canAccessRoute, routeForPath } from '../routes/registry'

const defaultClient = api as typeof api & Pick<TopologyClient, 'search'>

function visibleHits(session: SessionView, hits: EntitySearchHit[]) {
  return hits.filter((hit) => {
    const route = routeForPath(hit.route)
    return route !== undefined && canAccessRoute(session, route)
  })
}

export function GlobalSearch({ session, client = defaultClient, disabled = false }: {
  session: SessionView
  client?: Pick<TopologyClient, 'search'>
  disabled?: boolean
}) {
  const [draft, setDraft] = useState('')
  const [submitted, setSubmitted] = useState('')
  useEffect(() => { setDraft(''); setSubmitted('') }, [disabled, session.identityEpoch, session.generation, session.user.id])
  const result = useQuery({
    queryKey: queryKey('search', session.centers, { q: submitted, limit: 10 }),
    queryFn: () => client.search(submitted, 10),
    enabled: !disabled && submitted.length > 0,
  })
  const hits = useMemo(() => visibleHits(session, result.data?.items ?? []), [result.data, session])
  const clear = () => { setDraft(''); setSubmitted('') }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next = draft.trim()
    if (next) setSubmitted(next)
  }
  const open = !disabled && submitted.length > 0
  return <div className="global-search">
    <form role="search" aria-label="全域搜尋" onSubmit={submit}>
      <label className="sr-only" htmlFor="global-search-input">搜尋應用、環境或 CI</label>
      <Search size={15} aria-hidden="true" />
      <input id="global-search-input" type="search" value={draft} maxLength={100} disabled={disabled}
        placeholder="搜尋應用、環境或 CI"
        onChange={(event) => { setDraft(event.target.value); if (!event.target.value.trim()) setSubmitted('') }} />
      {draft && <button type="button" className="global-search-clear" aria-label="清除全域搜尋" onClick={clear}><X size={15} aria-hidden="true" /></button>}
      <button type="submit" className="global-search-submit" disabled={disabled}>搜尋</button>
    </form>
    {open && <section id="global-search-results" className="global-search-results" aria-label="全域搜尋結果">
      {result.isPending ? <p role="status">正在搜尋目前授權範圍…</p>
        : result.isError ? <p role="alert">搜尋失敗；資料未顯示。</p>
          : hits.length === 0 ? <p role="status">目前授權範圍沒有符合結果。</p>
            : <ul>{hits.map((hit) => <li key={`${hit.type}:${hit.id}`}><Link to={hit.route} onClick={clear}><span>{hit.title}</span><small>{routeForPath(hit.route)?.center?.toUpperCase() ?? '平台'} · {hit.type} · <code>{hit.id}</code></small></Link></li>)}</ul>}
    </section>}
  </div>
}
