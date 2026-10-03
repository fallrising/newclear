import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Boxes, CheckCircle2, Clock3, Gauge, Play, RefreshCw, Send } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, queryKey } from '../../api/client'
import type { Capacity, CreateRequestInput, RequestState } from '../../api/clients/self-service'
import { PageHeading } from '../../components/shared/page-heading'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import type { Provider, Request, SessionView } from '../../domain/schemas'

const providerLabel: Record<Provider, string> = { aws: 'AWS', aliyun: 'Aliyun', onprem: 'On-prem IDC' }
const stageLabel = { dev: '開發', staging: '預備', prod: '正式' } as const
const requestLabel: Record<RequestState, string> = {
  draft: '草稿', submitted: '待審核', approved: '已核准', rejected: '已拒絕', cancelled: '已撤回',
  provisioning: '交付中', fulfilled: '已完成', failed: '交付失敗',
}
const jobLabel = { queued: '等待啟動', running: '執行中', succeeded: '成功', failed: '失敗', cancelled: '已取消' } as const

function isNotFound(error: unknown) { return typeof error === 'object' && error !== null && (error as { status?: number }).status === 404 }
function Missing({ entity, back }: { entity: string; back: string }) {
  return <section className="access-state" role="status"><p className="eyebrow">404 · 找不到資料</p><h1>找不到這個{entity}</h1><p>資料可能不存在，或不在目前身分的授權範圍；不會揭露其他 scope 的識別資訊。</p><Button asChild variant="outline"><Link to={back}><ArrowLeft size={16} aria-hidden="true" />返回清單</Link></Button></section>
}

export function CatalogPage() {
  const catalog = useQuery({ queryKey: queryKey('catalog', null, { page: 1 }), queryFn: () => api.listCatalog({ page: 1, pageSize: 25, sort: 'name', order: 'asc' }) })
  return <>
    <PageHeading eyebrow="RD · SERVICE CATALOG" title="服務目錄" description="選擇目前專案可用的 compute、Redis 或 Kafka 模板；各能力使用明確的服務／環境、版本與審批流程。" />
    {catalog.isPending ? <LoadingState label="正在讀取可申請模板…" /> : catalog.isError ? <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} /> : catalog.data.items.length === 0 ? <section className="panel empty-state" role="status"><h2>目前沒有可申請的服務</h2><p>服務可能尚未發布、已停用，或不在目前專案 scope。</p></section> : <div className="catalog-grid">{catalog.data.items.map((item) => <article className="panel catalog-card" key={item.id}><div className="panel-title"><Boxes size={20} aria-hidden="true" /><h2>{item.name}</h2><span className="tag">revision {item.revision}</span></div><p>{item.description}</p><dl className="detail-list"><div><dt>可用階段</dt><dd>{item.template.allowedStages.map((stage) => stageLabel[stage]).join('、')}</dd></div><div><dt>Provider</dt><dd>{item.template.allowedProviders.map((provider) => providerLabel[provider]).join('、')}</dd></div><div><dt>預設規格</dt><dd>{item.template.resourceKind === 'compute' ? `${item.template.defaults.cpu} vCPU · ${item.template.defaults.memoryMiB} MiB` : item.template.resourceKind === 'redis' ? `${item.template.defaults.quotaMiB} MiB 配額` : `${item.template.defaults.partitions} partitions · ${item.template.defaults.retentionHours} 小時 · ${item.template.defaults.throughputKiBPerSecond} KiB/s`}</dd></div><div><dt>審核</dt><dd>需要 Ops 核准</dd></div></dl><Button asChild><Link to={`/rd/catalog/${item.id}/${item.template.resourceKind === 'compute' ? 'request' : 'resource-request'}`} >{item.template.resourceKind === 'compute' ? '開始申請' : item.template.resourceKind === 'redis' ? '申請 Redis 資源' : '申請 Kafka 資源'}<ArrowRight size={16} aria-hidden="true" /></Link></Button></article>)}</div>}
  </>
}

export function RequestWizard() {
  const { itemId = '' } = useParams()
  const navigate = useNavigate()
  const catalog = useQuery({ queryKey: queryKey('catalog-item', itemId), queryFn: () => api.getCatalog(itemId), enabled: Boolean(itemId) })
  const applications = useQuery({ queryKey: queryKey('applications', null, { purpose: 'request-wizard' }), queryFn: () => api.listApplications({ page: 1, pageSize: 100, sort: 'name', order: 'asc' }) })
  const pools = useQuery({ queryKey: queryKey('pools'), queryFn: () => api.listPools() })
  const capacity = useQuery({ queryKey: queryKey('capacity'), queryFn: () => api.getCapacity() })
  const create = useMutation({ mutationFn: (input: CreateRequestInput) => api.createRequest(input) })
  const submit = useMutation({ mutationFn: ({ id, version }: { id: string; version: number }) => api.submitRequest(id, version) })
  const [form, setForm] = useState({ applicationId: '', environmentName: '', stage: '', provider: '', poolId: '', cpu: null as number | null, memoryMiB: null as number | null, purpose: '' })
  const item = catalog.data?.template.resourceKind === 'compute' ? { ...catalog.data, template: catalog.data.template } : undefined
  const selectedStage = item?.template.allowedStages.includes(form.stage as 'dev' | 'staging' | 'prod') ? form.stage as 'dev' | 'staging' | 'prod' : item?.template.allowedStages[0] ?? 'staging'
  const selectedProvider = item?.template.allowedProviders.includes(form.provider as Provider) ? form.provider as Provider : item?.template.allowedProviders[0] ?? 'aws'
  const selectedCpu = form.cpu ?? item?.template.defaults.cpu ?? 1
  const selectedMemoryMiB = form.memoryMiB ?? item?.template.defaults.memoryMiB ?? 128
  const allowedPools = (pools.data ?? []).filter((pool) => !item || item.template.allowedPoolIds.includes(pool.id) && item.template.allowedProviders.includes(pool.provider))
  const selectedPool = allowedPools.find((pool) => pool.id === form.poolId) ?? allowedPools.find((pool) => pool.provider === selectedProvider)
  const selectedCapacity = capacity.data?.find((entry) => entry.poolId === selectedPool?.id)
  const updateProvider = (provider: Provider) => setForm((current) => ({ ...current, provider, poolId: allowedPools.find((pool) => pool.provider === provider)?.id ?? '' }))
  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!item || !form.applicationId || !selectedPool) return
    try {
      const receipt = await create.mutateAsync({ applicationId: form.applicationId, environmentName: form.environmentName.trim(), stage: selectedStage, catalogItemId: item.id, catalogRevision: item.revision, provider: selectedPool.provider, poolId: selectedPool.id, cpu: selectedCpu, memoryMiB: selectedMemoryMiB, purpose: form.purpose.trim() })
      const submitted = await submit.mutateAsync({ id: receipt.entityId, version: receipt.entityVersion })
      navigate(`/rd/requests/${submitted.entityId}`, { replace: true })
    } catch { /* Render the exact API error without automatic command retry. */ }
  }
  if (catalog.isError && isNotFound(catalog.error)) return <Missing entity="服務目錄項目" back="/rd/catalog" />
  if (catalog.isPending || applications.isPending || pools.isPending || capacity.isPending) return <LoadingState label="正在準備申請資料與容量…" />
  const loadError = catalog.error || applications.error || pools.error || capacity.error
  if (loadError) return <ErrorState error={loadError} title="無法準備申請" />
  if (!item) return <section className="panel"><h1>請使用對應的資源申請入口</h1><p>此模板屬於 Redis／Kafka 資源，保留既有 compute 環境申請流程。</p><Button asChild variant="outline"><Link to={`/rd/catalog/${itemId}/resource-request`}>開啟資源申請</Link></Button></section>
  const busy = create.isPending || submit.isPending
  const mutationError = create.error || submit.error
  return <>
    <PageHeading eyebrow="RD · REQUEST WIZARD" title={`申請 ${item.name}`} description="建立 draft 後提交同一 request ID；環境只會在 Ops 核准並啟動交付後建立。" action={<Button asChild variant="outline"><Link to="/rd/catalog"><ArrowLeft size={16} aria-hidden="true" />服務目錄</Link></Button>} />
    <form className="panel request-form" onSubmit={(event) => void onSubmit(event)}>
      <div className="form-step"><span>01</span><div><h2>應用與環境</h2><p>選擇目前 scope 內的應用與目標階段。</p></div></div>
      <label>應用<select required value={form.applicationId} onChange={(event) => setForm({ ...form, applicationId: event.target.value })}><option value="">選擇應用</option>{applications.data!.items.map((app) => <option key={app.id} value={app.id}>{app.name} · {app.id}</option>)}</select></label>
      <label>環境名稱<input required minLength={1} maxLength={120} value={form.environmentName} onChange={(event) => setForm({ ...form, environmentName: event.target.value })} placeholder="例如 checkout-staging" /></label>
      <label>階段<select value={selectedStage} onChange={(event) => setForm({ ...form, stage: event.target.value })}>{item.template.allowedStages.map((stage) => <option key={stage} value={stage}>{stageLabel[stage]}</option>)}</select></label>
      <div className="form-step"><span>02</span><div><h2>Provider 與規格</h2><p>容量是目前 scope 的即時投影，不是估算價格。</p></div></div>
      <label>Provider<select value={selectedProvider} onChange={(event) => updateProvider(event.target.value as Provider)}>{item.template.allowedProviders.map((provider) => <option key={provider} value={provider}>{providerLabel[provider]}</option>)}</select></label>
      <label>資源池<select required value={selectedPool?.id ?? ''} onChange={(event) => { const pool = allowedPools.find((entry) => entry.id === event.target.value); setForm({ ...form, poolId: event.target.value, provider: pool?.provider ?? selectedProvider }) }}>{allowedPools.filter((pool) => pool.provider === selectedProvider).map((pool) => <option key={pool.id} value={pool.id}>{pool.name}</option>)}</select></label>
      <label>vCPU<input required type="number" min={1} max={item.template.limits.maxCpu} value={selectedCpu} onChange={(event) => setForm({ ...form, cpu: Number(event.target.value) })} /></label>
      <label>Memory MiB<input required type="number" min={128} step={128} max={item.template.limits.maxMemoryMiB} value={selectedMemoryMiB} onChange={(event) => setForm({ ...form, memoryMiB: Number(event.target.value) })} /></label>
      <div className="capacity-preview"><Gauge size={18} aria-hidden="true" /><div><strong>{selectedPool?.name ?? '尚未選擇資源池'}</strong>{selectedCapacity ? <p>可用 {selectedCapacity.cpu.available} vCPU / {selectedCapacity.memoryMiB.available} MiB；本次申請 {selectedCpu} vCPU / {selectedMemoryMiB} MiB。</p> : <p>容量未知；請重新整理後再送出。</p>}</div></div>
      <div className="form-step"><span>03</span><div><h2>用途與提交</h2><p>提交後進入待審核，不會提前顯示環境建立成功。</p></div></div>
      <label className="span-all">用途<textarea required minLength={1} maxLength={500} rows={4} value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value })} placeholder="說明環境用途與驗收目標" /></label>
      <section className="review-summary span-all" aria-label="申請摘要"><h3>送出前確認</h3><p>{stageLabel[selectedStage]} · {providerLabel[selectedPool?.provider ?? 'aws']} · {selectedCpu} vCPU · {selectedMemoryMiB} MiB</p><p>核准者：具有 project 與 pool scope 的 Ops · 示範交付約 5 ticks</p></section>
      {mutationError && <div className="span-all"><ErrorState error={mutationError} title="申請尚未提交" /></div>}
      <div className="form-actions span-all"><Button asChild variant="outline"><Link to="/rd/catalog">取消</Link></Button><Button type="submit" disabled={busy || !selectedCapacity || selectedCpu > selectedCapacity.cpu.available || selectedMemoryMiB > selectedCapacity.memoryMiB.available}><Send size={16} aria-hidden="true" />{busy ? '正在建立並提交…' : '確認並提交申請'}</Button></div>
    </form>
  </>
}

export function RequestListPage({ center, session }: { center: 'rd' | 'ops'; session: SessionView }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const state = searchParams.get('state') as RequestState | null
  const filters = { ...(state ? { state } : {}), page: 1, pageSize: 50, sort: 'updatedAt' as const, order: 'desc' as const }
  const requests = useQuery({ queryKey: queryKey('requests', center, filters), queryFn: () => api.listRequests(filters) })
  return <>
    <PageHeading eyebrow={`${center.toUpperCase()} · REQUESTS`} title={center === 'rd' ? '環境申請' : '交付審批'} description={center === 'rd' ? '追蹤目前 project scope 的草稿、審批與交付狀態。' : '核准、拒絕或啟動目前 project 與 pool scope 內的交付。'} action={center === 'rd' ? <Button asChild><Link to="/rd/catalog">新增申請<ArrowRight size={16} aria-hidden="true" /></Link></Button> : undefined} />
    <form className="panel filter-bar request-filter" onSubmit={(event) => event.preventDefault()}><label>狀態<select value={state ?? ''} onChange={(event) => setSearchParams(event.target.value ? { state: event.target.value } : {}, { replace: true })}><option value="">全部狀態</option>{Object.entries(requestLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><Button variant="outline" onClick={() => void requests.refetch()} disabled={requests.isFetching}><RefreshCw size={15} className={requests.isFetching ? 'spin' : ''} aria-hidden="true" />重新整理</Button></form>
    {requests.isPending ? <LoadingState label="正在讀取目前 scope 的申請…" /> : requests.isError ? <ErrorState error={requests.error} onRetry={() => void requests.refetch()} /> : requests.data.items.length === 0 ? <section className="panel empty-state" role="status"><h2>目前沒有符合條件的申請</h2><p>只顯示 {session.user.displayName} 目前被授權的 project 與 pool 資料。</p></section> : <div className="panel table-scroll"><table><caption>目前 scope 的申請；共 {requests.data.total} 筆</caption><thead><tr><th scope="col">申請</th><th scope="col">應用 / 環境</th><th scope="col">Provider</th><th scope="col">規格</th><th scope="col">狀態</th><th scope="col">更新</th></tr></thead><tbody>{requests.data.items.map((request) => <tr key={request.id}><th scope="row"><Link to={`/${center}/requests/${request.id}`}>{request.id}</Link><small><code>{request.correlationId}</code></small></th><td><code>{request.applicationId}</code><small>{request.environmentName} · {stageLabel[request.stage]}</small></td><td>{providerLabel[request.provider]}</td><td>{request.cpu} vCPU · {request.memoryMiB} MiB</td><td><span className={`status request-${request.state}`}>{requestLabel[request.state]}</span></td><td>{new Date(request.updatedAt).toLocaleString('zh-TW')}</td></tr>)}</tbody></table></div>}
  </>
}

type RequestAction = 'submit' | 'approve' | 'reject' | 'cancel' | 'provision' | 'retry'
function actionText(action: RequestAction) { return { submit: '提交申請', approve: '核准並保留容量', reject: '拒絕申請', cancel: '撤回申請', provision: '啟動交付', retry: '建立重試作業' }[action] }

export function RequestDetailPage({ center }: { center: 'rd' | 'ops' }) {
  const { requestId = '' } = useParams()
  const detail = useQuery({ queryKey: queryKey('request', requestId), queryFn: () => api.getRequest(requestId), enabled: Boolean(requestId), refetchInterval: (query) => query.state.data?.request.state === 'provisioning' ? 1_000 : false })
  const [reason, setReason] = useState('已確認 scope、容量與申請用途')
  const [notice, setNotice] = useState('')
  const mutate = useMutation({ mutationFn: async ({ action, request }: { action: RequestAction; request: Request }) => {
    if (action === 'submit') return api.submitRequest(request.id, request.version)
    if (action === 'approve') return api.approveRequest(request.id, request.version, reason)
    if (action === 'reject') return api.rejectRequest(request.id, request.version, reason)
    if (action === 'cancel') return api.cancelRequest(request.id, request.version, reason)
    if (action === 'provision') return api.provisionRequest(request.id, request.version)
    return api.retryRequest(request.id, request.version, reason)
  } })
  const run = async (action: RequestAction, request: Request) => { setNotice(''); try { await mutate.mutateAsync({ action, request }); setNotice(`${actionText(action)}已提交。`); await detail.refetch() } catch { /* Error below. */ } }
  if (!requestId || detail.isError && isNotFound(detail.error)) return <Missing entity="申請" back={`/${center}/requests`} />
  if (detail.isPending) return <LoadingState label="正在讀取申請與作業歷史…" />
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
  const request = detail.data.request
  const rdActions: RequestAction[] = request.state === 'draft' ? ['submit', 'cancel'] : ['submitted', 'approved'].includes(request.state) ? ['cancel'] : request.state === 'failed' ? ['retry'] : []
  const opsActions: RequestAction[] = request.state === 'submitted' ? ['approve', 'reject'] : request.state === 'approved' ? ['provision'] : []
  const actions = center === 'rd' ? rdActions : opsActions
  return <>
    <PageHeading eyebrow={`${center.toUpperCase()} · REQUEST DETAIL`} title={`${request.environmentName} · ${requestLabel[request.state]}`} description={`同一 request / correlation 身分串連審批、job、environment 與最終 CI。`} action={<Button asChild variant="outline"><Link to={`/${center}/requests`}><ArrowLeft size={16} aria-hidden="true" />申請清單</Link></Button>} />
    {notice && <div className="success-state" role="status"><CheckCircle2 size={18} aria-hidden="true" />{notice}</div>}
    <div className="detail-status-grid"><section className="panel"><div className="panel-title"><h2>申請摘要</h2><span className={`status request-${request.state}`}>{requestLabel[request.state]}</span></div><dl className="detail-list"><div><dt>Request ID</dt><dd><code>{request.id}</code></dd></div><div><dt>Correlation</dt><dd><code>{request.correlationId}</code></dd></div><div><dt>Application</dt><dd><code>{request.applicationId}</code></dd></div><div><dt>Stage</dt><dd>{stageLabel[request.stage]}</dd></div><div><dt>Provider / pool</dt><dd>{providerLabel[request.provider]} · <code>{request.poolId}</code></dd></div><div><dt>規格</dt><dd>{request.cpu} vCPU · {request.memoryMiB} MiB</dd></div><div><dt>Environment ID</dt><dd>{request.environmentId ? <code>{request.environmentId}</code> : '尚未配置'}</dd></div><div><dt>用途</dt><dd>{request.purpose}</dd></div></dl></section><section className="panel"><div className="panel-title"><Clock3 size={20} aria-hidden="true" /><h2>操作與審批</h2></div>{request.approval ? <p className="approval-note">由 <code>{request.approval.actorId}</code> 核准：{request.approval.reason}</p> : <p className="muted">尚無核准紀錄。</p>}{actions.some((action) => !['submit', 'provision'].includes(action)) && <label className="reason-field">操作理由<textarea rows={3} minLength={1} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>}<div className="request-actions">{actions.map((action) => <Button key={action} variant={action === 'reject' || action === 'cancel' ? 'destructive' : 'default'} disabled={mutate.isPending || (!['submit', 'provision'].includes(action) && !reason.trim())} onClick={() => void run(action, request)}>{action === 'provision' ? <Play size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}{mutate.isPending ? '處理中…' : actionText(action)}</Button>)}</div>{request.state === 'provisioning' && <p className="field-hint">交付已排程；前往示範導覽推進 5 ticks，這個頁面會每秒重新讀取狀態。</p>}{mutate.isError && <ErrorState error={mutate.error} title="操作未完成" />}</section></div>
    <section className="panel"><div className="panel-title"><h2>交付作業歷史</h2><span className="tag">{detail.data.jobs.length} attempts</span></div>{detail.data.jobs.length === 0 ? <p className="muted">申請核准前不會建立交付作業。</p> : <div className="table-scroll"><table><caption>此申請的 provisioning job attempts</caption><thead><tr><th scope="col">Job</th><th scope="col">Attempt</th><th scope="col">狀態</th><th scope="col">Planned CI</th><th scope="col">時間</th></tr></thead><tbody>{detail.data.jobs.map((job) => <tr key={job.id}><th scope="row">{center === 'ops' ? <Link to={`/ops/jobs/${job.id}`}>{job.id}</Link> : <code>{job.id}</code>}</th><td>{job.attempt}</td><td>{jobLabel[job.state]}</td><td>{job.plannedCiIds.map((id) => <code key={id}>{id}</code>)}</td><td>{job.completedAt ? new Date(job.completedAt).toLocaleString('zh-TW') : job.startedAt ? '已啟動' : '等待啟動'}</td></tr>)}</tbody></table></div>}</section>
  </>
}

export function JobsPage() {
  const [state, setState] = useState('')
  const jobs = useQuery({ queryKey: queryKey('jobs', null, { state }), queryFn: () => api.listJobs({ ...(state ? { state: state as keyof typeof jobLabel } : {}), page: 1, pageSize: 50, sort: 'updatedAt', order: 'desc' }) })
  return <><PageHeading eyebrow="OPS · DELIVERY JOBS" title="交付作業" description="查看每次 provisioning attempt、固定 planned CI 身分與可讀 log。" /><form className="panel filter-bar request-filter" onSubmit={(event) => event.preventDefault()}><label>狀態<select value={state} onChange={(event) => setState(event.target.value)}><option value="">全部狀態</option>{Object.entries(jobLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></form>{jobs.isPending ? <LoadingState label="正在讀取交付作業…" /> : jobs.isError ? <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} /> : jobs.data.items.length === 0 ? <section className="panel empty-state"><h2>目前沒有交付作業</h2><p>核准申請後才會產生 queued job。</p></section> : <div className="panel table-scroll"><table><caption>目前 scope 的交付作業</caption><thead><tr><th>Job</th><th>Request</th><th>Attempt</th><th>狀態</th><th>Planned CI</th></tr></thead><tbody>{jobs.data.items.map((job) => <tr key={job.id}><th scope="row"><Link to={`/ops/jobs/${job.id}`}>{job.id}</Link></th><td><Link to={`/ops/requests/${job.requestId}`}>{job.requestId}</Link></td><td>{job.attempt}</td><td>{jobLabel[job.state]}</td><td><code>{job.plannedCiIds.join(', ')}</code></td></tr>)}</tbody></table></div>}</>
}

export function JobDetailPage() {
  const { jobId = '' } = useParams()
  const detail = useQuery({ queryKey: queryKey('job', jobId), queryFn: () => api.getJob(jobId), enabled: Boolean(jobId), refetchInterval: (query) => query.state.data?.job.state === 'running' ? 1_000 : false })
  const [scenarioNotice, setScenarioNotice] = useState('')
  const failure = useMutation({ mutationFn: () => api.setScenario('provision-failure', { jobId }) })
  if (!jobId || detail.isError && isNotFound(detail.error)) return <Missing entity="交付作業" back="/ops/jobs" />
  if (detail.isPending) return <LoadingState label="正在讀取作業與 log…" />
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
  const { job, logs } = detail.data
  const injectFailure = async () => { setScenarioNotice(''); try { await failure.mutateAsync(); setScenarioNotice('已為這次 job 設定 configure 階段失敗；推進時鐘即可觀察。') } catch { /* Exact error below. */ } }
  return <><PageHeading eyebrow="OPS · JOB DETAIL" title={`${job.id} · ${jobLabel[job.state]}`} description={`Attempt ${job.attempt}；retry 會建立新 job，但重用相同 environment 與 planned CI IDs。`} action={<Button asChild variant="outline"><Link to="/ops/jobs"><ArrowLeft size={16} aria-hidden="true" />作業清單</Link></Button>} /><section className="panel"><dl className="detail-list"><div><dt>Request</dt><dd><Link to={`/ops/requests/${job.requestId}`}>{job.requestId}</Link></dd></div><div><dt>Correlation</dt><dd><code>{job.correlationId}</code></dd></div><div><dt>Planned CI</dt><dd><code>{job.plannedCiIds.join(', ')}</code></dd></div><div><dt>Failure</dt><dd>{job.failureCode ?? '無'}</dd></div></dl>{job.state === 'running' && <div className="scenario-control"><p>示範控制：只影響這次 job，不會連接或操作真實 provider。</p><Button variant="outline" disabled={failure.isPending || Boolean(scenarioNotice)} onClick={() => void injectFailure()}>{failure.isPending ? '正在設定…' : '在 configure 階段注入失敗'}</Button></div>}{scenarioNotice && <p className="command-notice" role="status">{scenarioNotice}</p>}{failure.isError && <ErrorState error={failure.error} title="無法設定失敗情境" />}</section><section className="panel"><div className="panel-title"><h2>交付 log</h2><span className="tag">{logs.length} entries</span></div>{logs.length === 0 ? <p className="muted">queued job 尚未產生 log。</p> : <ol className="job-logs">{logs.map((log) => <li key={log.id}><time>{new Date(log.occurredAt).toLocaleString('zh-TW')}</time><span className={`log-level log-${log.level}`}>{log.level}</span><code>{log.message}</code></li>)}</ol>}</section></>
}

function CapacityBar({ label, value }: { label: string; value: Capacity['cpu'] }) {
  const total = value.used + value.reserved + value.available
  const used = total ? Math.round(value.used / total * 100) : 0
  const reserved = total ? Math.round(value.reserved / total * 100) : 0
  return <div className="capacity-line"><div><strong>{label}</strong><span>{value.used} used · {value.reserved} reserved · {value.available} available</span></div><div className="capacity-track" aria-label={`${label} ${used}% used, ${reserved}% reserved`}><span style={{ width: `${used}%` }} /><i style={{ width: `${reserved}%` }} /></div></div>
}

export function CapacityPage() {
  const [scope, setScope] = useSearchParams()
  const provider = (scope.get('provider') ?? '') as Provider | ''
  const poolId = scope.get('poolId')
  const setProvider = (value: Provider | '') => setScope(value ? { provider: value } : {})
  const input = useMemo(() => provider ? { provider } : {}, [provider])
  const pools = useQuery({ queryKey: queryKey('pools', null, input), queryFn: () => api.listPools(input) })
  const capacity = useQuery({ queryKey: queryKey('capacity', null, input), queryFn: () => api.getCapacity(input) })
  const error = pools.error || capacity.error
  return <><PageHeading eyebrow="OPS · CAPACITY" title="資源池容量" description="Used 來自 active compute CI；reserved 來自 queued/running job，核准與 reservation 在同一 transaction。" /><form className="panel filter-bar request-filter" onSubmit={(event) => event.preventDefault()}><label>Provider<select value={provider} onChange={(event) => setProvider(event.target.value as Provider | '')}><option value="">全部來源</option>{Object.entries(providerLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></form>{pools.isPending || capacity.isPending ? <LoadingState label="正在計算目前 scope 容量…" /> : error ? <ErrorState error={error} /> : <div className="capacity-grid">{poolId && !pools.data!.some(pool => pool.id === poolId) && <section className="panel empty-state"><h2>目前範圍找不到此資源池</h2></section>}{pools.data!.filter(pool => !poolId || pool.id === poolId).map((pool) => { const usage = capacity.data!.find((entry) => entry.poolId === pool.id)!; return <article className="panel" key={pool.id}><div className="panel-title"><Gauge size={20} aria-hidden="true" /><h2>{pool.name}</h2><span className="tag">{providerLabel[pool.provider]}</span></div><code>{pool.id}</code><CapacityBar label="vCPU" value={usage.cpu} /><CapacityBar label="Memory MiB" value={usage.memoryMiB} /><div className="capacity-links"><Button asChild variant="outline" size="sm"><Link to={`/ops/cmdb?provider=${pool.provider}`}>查看 CI</Link></Button><Button asChild variant="ghost" size="sm"><Link to="/ops/requests?state=approved">待交付申請</Link></Button></div></article> })}</div>}</>
}
