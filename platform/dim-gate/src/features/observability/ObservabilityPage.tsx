import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { api, queryKey } from '../../api/client'
import type { ObservationWindow } from '../../api/clients/observability'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import { timestampSchema, type ObservationLog, type SessionView } from '../../domain/schema-models'
import { MetricChart } from './metrics'
import { canReadRaw, IncidentStatus, isNotFound, MissingObservation, observationLink, Pager, pageNumber, ScopeBadge, timestamp } from './shared'

type UpdateFilters = (changes: Record<string, string>) => void

export function ObservabilityPage({ session }: { session: SessionView }) {
  const [params, setParams] = useSearchParams()
  const applicationId = params.get('applicationId') ?? ''
  const environmentId = params.get('environmentId') ?? ''
  const center = session.centers[0]
  const dashboard = useQuery({ queryKey: queryKey('dashboard', center), queryFn: () => api.getDashboard(center) })
  const applications = useQuery({ queryKey: queryKey('applications', null, { purpose: 'observation-selector' }), queryFn: () => api.listApplications({ page: 1, pageSize: 100, sort: 'name' }) })
  const application = useQuery({ queryKey: queryKey('application', applicationId), queryFn: () => api.getApplication(applicationId), enabled: Boolean(applicationId) })
  const environment = application.data?.environments.find(env => env.id === environmentId)
  const update: UpdateFilters = changes => setParams(previous => {
    const next = new URLSearchParams(previous)
    for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key) }
    return next
  })
  const end = dashboard.data ? new Date(Date.parse(dashboard.data.dataAsOf) + 1000).toISOString() : ''
  const window: ObservationWindow = { applicationId, environmentId, from: params.get('from') ?? (end ? new Date(Date.parse(end) - 900000).toISOString() : ''), to: params.get('to') ?? end }
  const validWindow = timestampSchema.safeParse(window.from).success && timestampSchema.safeParse(window.to).success && Date.parse(window.to) > Date.parse(window.from) && Date.parse(window.to) - Date.parse(window.from) <= 86400000
  const explicitWindow = params.has('from') && params.has('to')
  const windowReady = explicitWindow || dashboard.isSuccess
  const selected = Boolean(environment && application.data)
  const raw = Boolean(environment && application.data && canReadRaw(session, application.data.application.projectId, environment.stage))
  return <div className="observation-page"><div className="page-heading"><div><p className="eyebrow">OBSERVABILITY · DEMO</p><h1>應用觀測</h1><p className="page-description">依相同應用、環境與時間範圍追查 RED metrics、trace、log 和事件。</p></div></div>
    <section className="panel"><h2>觀測範圍</h2>{applications.isPending ? <LoadingState label="正在讀取可見應用…" /> : applications.isError ? <ErrorState error={applications.error} onRetry={() => void applications.refetch()} /> : <div className="observation-filters"><label>觀測應用<select value={applicationId} onChange={event => update({ applicationId: event.target.value, environmentId: '', traceId: '', logId: '', releaseId: '', tracePage: '', logPage: '' })}><option value="">選擇應用</option>{applications.data.items.map(app => <option key={app.id} value={app.id}>{app.name}</option>)}</select></label><label>觀測環境<select value={environmentId} disabled={!application.data} onChange={event => update({ environmentId: event.target.value, traceId: '', logId: '', releaseId: '', tracePage: '', logPage: '' })}><option value="">選擇環境</option>{application.data?.environments.map(env => <option key={env.id} value={env.id}>{env.name} · {env.stage}</option>)}</select></label></div>}
      {applicationId && application.isPending && <LoadingState label="正在讀取授權環境…" />}{application.isError && (isNotFound(application.error) ? <MissingObservation entity="應用" /> : <ErrorState error={application.error} onRetry={() => void application.refetch()} />)}
      {application.isSuccess && environmentId && !environment && <MissingObservation entity="環境" />}{!applicationId || !environmentId ? <p className="observation-note" role="status">選擇應用與環境後讀取觀測資料；尚未判定健康狀態。</p> : null}
      {environment && <ScopeBadge environment={environment} applicationId={applicationId} />}
      {!explicitWindow && dashboard.isPending ? <LoadingState label="正在讀取模擬時間…" /> : !explicitWindow && dashboard.isError ? <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} /> : <form className="observation-filters" key={`${window.from}:${window.to}`} onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget)
        update({ from: String(data.get('from')), to: String(data.get('to')), tracePage: '', logPage: '' })
      }}><label>起始時間（UTC ISO）<input name="from" required defaultValue={window.from} /></label><label>結束時間（UTC ISO，不含）<input name="to" required defaultValue={window.to} /></label><Button type="submit" variant="outline">套用時間範圍</Button><label>最近模擬時間<select aria-label="最近模擬時間" defaultValue="" disabled={!dashboard.data} onChange={event => { if (end && event.target.value) update({ from: new Date(Date.parse(end) - Number(event.target.value) * 60000).toISOString(), to: end, tracePage: '', logPage: '' }) }}><option value="">選擇範圍</option><option value="15">最近 15 分鐘</option><option value="60">最近 1 小時</option><option value="1440">最近 24 小時</option></select></label></form>}
      {windowReady && !validWindow && <p role="alert" className="field-error">請使用 UTC ISO 時間；起點須早於終點，範圍最多 24 小時。</p>}<p className="observation-note">來源為示範合成觀測，並非真實量測。圖表每個 bucket 為 60 秒；未知或缺少的樣本不補零。時間快捷選項以 API 的模擬時間為準。</p>
    </section>
    {selected && windowReady && validWindow && <ObservationResults key={`${session.sessionId}:${session.identityEpoch}:${environmentId}`} window={window} raw={raw} params={params} update={update} />}
  </div>
}

function ObservationResults({ window, raw, params, update }: { window: ObservationWindow; raw: boolean; params: URLSearchParams; update: UpdateFilters }) {
  const metrics = useQuery({ queryKey: queryKey('metrics', window.environmentId, window), queryFn: () => api.getMetrics(window) })
  const incidentFilters = { environmentId: window.environmentId, page: 1, pageSize: 100, sort: 'updatedAt' as const, order: 'desc' as const }
  const incidents = useQuery({ queryKey: queryKey('incidents', window.environmentId, incidentFilters), queryFn: () => api.listIncidents(incidentFilters) })
  return <><section aria-label="RED metrics"><h2>RED metrics</h2><p className="observation-note">{timestamp(window.from)} → {timestamp(window.to)}（不含終點）</p>{metrics.isPending ? <LoadingState label="正在讀取觀測樣本…" /> : metrics.isError ? <ErrorState error={metrics.error} onRetry={() => void metrics.refetch()} /> : metrics.data.series.length === 0 ? <p className="panel observation-empty" role="status">此時間範圍沒有樣本；健康狀態未知。</p> : <div className="metric-grid">{metrics.data.series.map(series => <MetricChart key={series.metric} series={series} window={window} />)}</div>}</section>
    {raw ? <RawObservations window={window} params={params} update={update} /> : <section className="panel"><h2>Trace 與 log</h2><p className="observation-note">目前身分僅可讀取觀測 metadata；原始 trace 與 log 需要此專案與環境階段的 RD 或 Ops 授權。</p></section>}
    <section className="panel"><h2>環境事件</h2><p className="observation-note">顯示此環境的事件歷史；事件可能跨越目前觀測時間範圍。</p>{incidents.isPending ? <LoadingState label="正在讀取環境事件…" /> : incidents.isError ? <ErrorState error={incidents.error} onRetry={() => void incidents.refetch()} /> : incidents.data.items.length === 0 ? <p className="observation-empty">尚無可見事件；這不代表已有健康觀測。</p> : <ul className="observation-evidence">{incidents.data.items.map(incident => <li key={incident.id}><Link to={`/ops/incidents/${encodeURIComponent(incident.id)}`}>{incident.id}</Link> <IncidentStatus incident={incident} /> · 第 {incident.episode} 次事件</li>)}</ul>}{incidents.data && incidents.data.total > incidents.data.items.length && <p className="observation-note">顯示最近 100 筆，共 {incidents.data.total} 筆。</p>}</section>
  </>
}

function RawObservations({ window, params, update }: { window: ObservationWindow; params: URLSearchParams; update: UpdateFilters }) {
  const traceId = params.get('traceId') || undefined
  const traceStatus = params.get('traceStatus') || undefined
  const level = params.get('level') || undefined
  const validStatus = !traceStatus || traceStatus === 'ok' || traceStatus === 'error'
  const validLevel = !level || ['debug', 'info', 'warn', 'error'].includes(level)
  const traceFilters = { ...window, page: pageNumber(params.get('tracePage')), pageSize: 25, sort: 'start' as const, order: 'desc' as const, status: traceStatus as 'ok' | 'error' | undefined }
  const logFilters = { ...window, page: pageNumber(params.get('logPage')), pageSize: 25, sort: 'occurredAt' as const, order: 'desc' as const, traceId, releaseId: params.get('releaseId') || undefined, level: level as ObservationLog['level'] | undefined }
  const traces = useQuery({ queryKey: queryKey('traces', window.environmentId, traceFilters), queryFn: () => api.listTraces(traceFilters), enabled: validStatus })
  const logs = useQuery({ queryKey: queryKey('logs', window.environmentId, logFilters), queryFn: () => api.listLogs(logFilters), enabled: validLevel })
  return <><section className="panel"><h2>Trace</h2><div className="observation-filters"><label>Trace 狀態<select value={traceStatus ?? ''} onChange={event => update({ traceStatus: event.target.value, tracePage: '' })}><option value="">所有狀態</option><option value="ok">ok</option><option value="error">error</option></select></label></div>{!validStatus ? <p role="alert">Trace 狀態篩選無效。</p> : traces.isPending ? <LoadingState label="正在讀取 trace…" /> : traces.isError ? <ErrorState error={traces.error} onRetry={() => void traces.refetch()} /> : traces.data.items.length === 0 ? <p className="observation-empty">此範圍沒有符合條件的 trace。</p> : <div className="table-scroll"><table><caption>目前環境與時間範圍的 Trace</caption><thead><tr><th scope="col">Trace</th><th scope="col">開始時間</th><th scope="col">耗時</th><th scope="col">狀態</th><th scope="col">發布</th></tr></thead><tbody>{traces.data.items.map(trace => <tr key={trace.id}><th scope="row"><Link to={observationLink({ ...window, traceStatus, traceId: trace.id })}>{trace.name}</Link><code>{trace.id}</code></th><td>{timestamp(trace.start)}</td><td>{trace.durationMs} ms</td><td>{trace.status}</td><td>{trace.releaseId ? <Link to={`/rd/releases/${encodeURIComponent(trace.releaseId)}`}>{trace.releaseId}</Link> : '未知'}</td></tr>)}</tbody></table></div>}{traces.data && validStatus && <Pager name="Trace" page={traces.data.page} total={traces.data.total} onPage={page => update({ tracePage: String(page) })} />}</section>
    {traceId && <TraceDetail traceId={traceId} window={window} clear={() => update({ traceId: '', logId: '', logPage: '' })} />}
    <section className="panel" id="observation-logs"><h2>關聯日誌</h2><p className="observation-note">{traceId ? '限目前選取的 Trace。' : '顯示所選環境與時間範圍。'}每頁最多 25 筆；API 以目前授權範圍篩選。</p><form className="observation-filters" key={`${level}:${logFilters.releaseId}:${traceId}`} onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); update({ level: String(data.get('level')), releaseId: String(data.get('releaseId')).trim(), traceId: String(data.get('traceId')).trim(), logId: '', logPage: '' }) }}><label>日誌等級<select name="level" defaultValue={level ?? ''}><option value="">所有等級</option>{['debug', 'info', 'warn', 'error'].map(value => <option key={value}>{value}</option>)}</select></label><label>Trace ID<input name="traceId" maxLength={160} defaultValue={traceId ?? ''} /></label><label>Release ID<input name="releaseId" maxLength={160} defaultValue={logFilters.releaseId ?? ''} /></label><Button type="submit" variant="outline">套用日誌篩選</Button><Button variant="ghost" onClick={() => update({ level: '', releaseId: '', traceId: '', logId: '', logPage: '' })}>清除日誌篩選</Button></form>
      {!validLevel ? <p role="alert">日誌等級篩選無效。</p> : logs.isPending ? <LoadingState label="正在讀取關聯日誌…" /> : logs.isError ? <ErrorState error={logs.error} onRetry={() => void logs.refetch()} /> : logs.data.items.length === 0 ? <p className="observation-empty">此範圍沒有符合條件的日誌。</p> : <div className="table-scroll"><table><caption>Trace／Release 關聯日誌</caption><thead><tr><th scope="col">時間／等級</th><th scope="col">安全訊息</th><th scope="col">關聯實體</th></tr></thead><tbody>{logs.data.items.map(log => <tr key={log.id} className={params.get('logId') === log.id ? 'observation-log-target' : undefined}><th scope="row">{timestamp(log.occurredAt)}<small>{log.level}</small><code>{log.id}</code></th><td><p className="observation-log-message">{log.message}</p></td><td>{log.traceId && <p><Link to={observationLink({ ...window, traceId: log.traceId })}>Trace {log.traceId}</Link></p>}{log.releaseId && <p><Link to={`/rd/releases/${encodeURIComponent(log.releaseId)}`}>Release {log.releaseId}</Link></p>}{log.ciId && <p><Link to={`/ops/cmdb/${encodeURIComponent(log.ciId)}`}>CI {log.ciId}</Link></p>}</td></tr>)}</tbody></table></div>}{logs.data && validLevel && <Pager name="日誌" page={logs.data.page} total={logs.data.total} onPage={page => update({ logPage: String(page) })} />}
    </section>
  </>
}

function TraceDetail({ traceId, window, clear }: { traceId: string; window: ObservationWindow; clear: () => void }) {
  const trace = useQuery({ queryKey: queryKey('trace', traceId), queryFn: () => api.getTrace(traceId) })
  if (trace.isPending) return <LoadingState label="正在讀取 trace waterfall…" />
  if (trace.isError) return isNotFound(trace.error) ? <MissingObservation entity="Trace" /> : <ErrorState error={trace.error} onRetry={() => void trace.refetch()} />
  if (trace.data.applicationId !== window.applicationId || trace.data.environmentId !== window.environmentId) return <MissingObservation entity="Trace" />
  const detail = trace.data
  const origin = Date.parse(detail.start)
  const extent = Math.max(detail.durationMs, ...detail.spans.map(span => Date.parse(span.start) - origin + span.durationMs), 1)
  return <section className="panel"><h2>Trace waterfall · {detail.name}</h2><p className="observation-note"><code>{detail.id}</code> · {timestamp(detail.start)} · {detail.durationMs} ms · {detail.status}</p>{(Date.parse(detail.start) < Date.parse(window.from) || Date.parse(detail.start) >= Date.parse(window.to)) && <p role="status" className="observation-note">此 Trace 位於目前篩選時間範圍之外；可調整時間範圍查看日誌。</p>}<div className="observation-links"><a href="#observation-logs">查看此 Trace 的日誌</a>{detail.releaseId && <Link to={`/rd/releases/${encodeURIComponent(detail.releaseId)}`}>查看關聯發布</Link>}<Button variant="outline" size="sm" onClick={clear}>取消選取 Trace</Button></div>{detail.spans.length === 0 ? <p className="observation-empty">此 Trace 沒有可見 span。</p> : <div className="table-scroll"><table className="trace-waterfall"><caption>Trace span 耗時表與時間軸（ms）；父 span ID 表示呼叫關係</caption><thead><tr><th scope="col">Span／父 Span</th><th scope="col">起點</th><th scope="col">耗時／狀態</th><th scope="col">時間軸 · 0–{extent} ms</th></tr></thead><tbody>{detail.spans.map(span => <tr key={span.id}><th scope="row">{span.name}<code>{span.id}</code><small>父：{span.parentId ?? '根 span'}</small>{span.ciId && <Link to={`/ops/cmdb/${encodeURIComponent(span.ciId)}`}>{span.ciId}</Link>}</th><td>{Date.parse(span.start) - origin} ms</td><td>{span.durationMs} ms · {span.status}</td><td><div className="span-track" aria-hidden="true"><span className={`span-bar ${span.status === 'error' ? 'span-error' : ''}`} style={{ left: `${Math.max(0, Date.parse(span.start) - origin) / extent * 100}%`, width: `${span.durationMs / extent * 100}%` }} /></div></td></tr>)}</tbody></table></div>}</section>
}
