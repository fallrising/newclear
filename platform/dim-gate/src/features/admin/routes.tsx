import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { BookOpen, KeyRound, ListChecks, ScrollText, Shield, Wrench } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, queryKey } from '../../api/client'
import { PageHeading } from '../../components/shared/page-heading'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import { ResourceCatalogDraftEditor } from './ResourceCatalogDraftEditor'
import type { ComputeCatalogItem, CatalogItem, Center, ModelField, NavigationItem, SessionView } from '../../domain/schemas'

const roleLabel: Record<Center, string> = { rd: 'RD', ops: 'Ops', admin: 'Admin' }
const statusLabel: Record<CatalogItem['status'], string> = { draft: '草稿', published: '已發布', disabled: '已停用' }

function MutationFeedback({ mutation, success }: { mutation: { isError: boolean; error: unknown; isSuccess: boolean }; success: string }) {
  return <>{mutation.isError && <ErrorState error={mutation.error} title="操作未完成" />}{mutation.isSuccess && <p className="command-notice" role="status">{success}</p>}</>
}

export function AccessPage({ session }: { session: SessionView }) {
  const access = useQuery({ queryKey: queryKey('access'), queryFn: () => api.getAccess() })
  const [form, setForm] = useState({ userId: 'user-rd-commerce', role: 'rd' as Center, scopeId: 'project-store', reason: 'Admin governance demonstration' })
  const mutation = useMutation({ mutationFn: async (input: { kind: 'grant' | 'revoke' | 'user'; id?: string; version?: number; enabled?: boolean }) => {
    if (input.kind === 'grant') { const scopeType = form.role === 'admin' ? 'org' : form.role === 'rd' ? 'project' : form.scopeId.startsWith('pool-') ? 'pool' : 'project'; return api.createAssignment({ userId: form.userId, role: form.role, scopeType, scopeId: form.scopeId, reason: form.reason }) }
    if (input.kind === 'revoke') return api.revokeAssignment(input.id!, input.version!, form.reason)
    return api.patchUser(input.id!, input.version!, input.enabled!, form.reason)
  } })
  const run = async (input: Parameters<typeof mutation.mutateAsync>[0]) => { try { await mutation.mutateAsync(input); await access.refetch() } catch { /* Exact refusal is rendered. */ } }
  if (access.isPending) return <LoadingState label="正在讀取使用者與授權…" />
  if (access.isError) return <ErrorState error={access.error} onRetry={() => void access.refetch()} />
  return <><PageHeading eyebrow="ADMIN · ACCESS" title="角色與範圍" description="固定角色搭配 org/project/pool scope；不能修改自己，也不能移除最後一位啟用中的 Admin。" />
    <form className="panel admin-form" onSubmit={(event) => { event.preventDefault(); void run({ kind: 'grant' }) }}><div className="panel-title"><KeyRound size={20} /><h2>新增角色授權</h2><span className="tag">policy v{access.data.policyVersion}</span></div><label>使用者<select value={form.userId} onChange={(event) => setForm({ ...form, userId: event.target.value })}>{access.data.users.map((user) => <option key={user.id} value={user.id}>{user.displayName} · {user.id}</option>)}</select></label><label>角色<select value={form.role} onChange={(event) => { const role = event.target.value as Center; setForm({ ...form, role, scopeId: role === 'admin' ? 'org-demo' : role === 'ops' ? 'pool-aws-sg' : 'project-store' }) }}>{Object.entries(roleLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Scope ID<input required value={form.scopeId} onChange={(event) => setForm({ ...form, scopeId: event.target.value })} /></label><label className="span-all">理由<input required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label><div className="form-actions span-all"><Button type="submit" disabled={mutation.isPending}>新增授權</Button></div></form>
    <section className="panel"><div className="panel-title"><Shield size={20} /><h2>使用者</h2></div><div className="table-scroll"><table><caption>企業使用者與啟用狀態</caption><thead><tr><th>使用者</th><th>Teams</th><th>狀態</th><th>操作</th></tr></thead><tbody>{access.data.users.map((user) => <tr key={user.id}><th scope="row">{user.displayName}<small><code>{user.id}</code></small></th><td>{user.teamIds.join(', ')}</td><td>{user.enabled ? '啟用' : '停用'}</td><td><Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => void run({ kind: 'user', id: user.id, version: user.version, enabled: !user.enabled })}>{user.enabled ? '停用使用者' : '重新啟用'}</Button>{user.id === session.user.id && <small>目前身分；handler 會拒絕自我修改</small>}</td></tr>)}</tbody></table></div></section>
    <section className="panel"><div className="panel-title"><ListChecks size={20} /><h2>角色授權</h2><span className="tag">{access.data.assignments.length}</span></div><div className="table-scroll"><table><caption>固定角色與資源範圍</caption><thead><tr><th>Assignment</th><th>User</th><th>Role</th><th>Scope</th><th>操作</th></tr></thead><tbody>{access.data.assignments.map((assignment) => <tr key={assignment.id}><th scope="row"><code>{assignment.id}</code></th><td><code>{assignment.userId}</code></td><td>{roleLabel[assignment.role]}</td><td>{assignment.scopeType} · <code>{assignment.scopeId}</code></td><td><Button size="sm" variant="destructive" disabled={mutation.isPending} onClick={() => void run({ kind: 'revoke', id: assignment.id, version: assignment.version })}>撤銷</Button></td></tr>)}</tbody></table></div></section><MutationFeedback mutation={mutation} success="授權狀態已提交並重新讀取。" /></>
}

function NavigationRow({ item, committed }: { item: NavigationItem; committed: () => Promise<unknown> }) {
  const [form, setForm] = useState({ label: item.label, group: item.group, order: item.order, enabled: item.enabled })
  const mutation = useMutation({ mutationFn: () => api.patchNavigation(item.id, { expectedVersion: item.version, ...form }) })
  return <tr><th scope="row"><code>{item.routeKey}</code></th><td><input aria-label={`${item.routeKey} label`} value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} /></td><td><input aria-label={`${item.routeKey} group`} value={form.group} onChange={(event) => setForm({ ...form, group: event.target.value })} /></td><td><input aria-label={`${item.routeKey} order`} type="number" value={form.order} onChange={(event) => setForm({ ...form, order: Number(event.target.value) })} /></td><td><input aria-label={`${item.routeKey} enabled`} type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /></td><td><Button size="sm" disabled={mutation.isPending} onClick={async () => { try { await mutation.mutateAsync(); await committed() } catch { /* shown */ } }}>儲存</Button>{mutation.isError && <span className="field-error">{(mutation.error as Error).message}</span>}</td></tr>
}

function ComputeCatalogDraftEditor({ item, committed }: { item: ComputeCatalogItem; committed: () => Promise<unknown> }) {
  const [form, setForm] = useState({
    name: item.name, description: item.description,
    allowedProjectIds: item.allowedProjectIds.join(', '), allowedPoolIds: item.template.allowedPoolIds.join(', '),
    allowedProviders: item.template.allowedProviders, allowedStages: item.template.allowedStages,
    defaultCpu: item.template.defaults.cpu, defaultMemoryMiB: item.template.defaults.memoryMiB,
    maxCpu: item.template.limits.maxCpu, maxMemoryMiB: item.template.limits.maxMemoryMiB,
  })
  const ids = (value: string) => [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))]
  const mutation = useMutation({ mutationFn: () => api.patchCatalog(item, {
    name: form.name, description: form.description, allowedProjectIds: ids(form.allowedProjectIds),
    template: { ...item.template, allowedProviders: form.allowedProviders, allowedStages: form.allowedStages,
      allowedPoolIds: ids(form.allowedPoolIds), defaults: { cpu: form.defaultCpu, memoryMiB: form.defaultMemoryMiB },
      limits: { maxCpu: form.maxCpu, maxMemoryMiB: form.maxMemoryMiB } },
  }) })
  const valid = Boolean(form.name.trim() && form.description.trim() && ids(form.allowedProjectIds).length && ids(form.allowedPoolIds).length
    && form.allowedProviders.length && form.allowedStages.length && form.defaultCpu > 0 && form.defaultMemoryMiB >= 128
    && form.defaultMemoryMiB % 128 === 0 && form.defaultCpu <= form.maxCpu && form.defaultMemoryMiB <= form.maxMemoryMiB)
  return <div className="admin-inline-editor"><label>Draft name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Description<textarea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><label>Allowed project IDs<input value={form.allowedProjectIds} onChange={(event) => setForm({ ...form, allowedProjectIds: event.target.value })} /></label><label>Allowed pool IDs<input value={form.allowedPoolIds} onChange={(event) => setForm({ ...form, allowedPoolIds: event.target.value })} /></label><label>Allowed providers<select multiple value={form.allowedProviders} onChange={(event) => setForm({ ...form, allowedProviders: Array.from(event.target.selectedOptions, (option) => option.value as CatalogItem['template']['allowedProviders'][number]) })}><option value="aws">AWS</option><option value="aliyun">Aliyun</option><option value="onprem">On-prem IDC</option></select></label><label>Allowed stages<select multiple value={form.allowedStages} onChange={(event) => setForm({ ...form, allowedStages: Array.from(event.target.selectedOptions, (option) => option.value as CatalogItem['template']['allowedStages'][number]) })}><option value="dev">開發</option><option value="staging">預備</option><option value="prod">正式</option></select></label><div className="catalog-spec-grid"><label>Default vCPU<input type="number" min={1} max={64} value={form.defaultCpu} onChange={(event) => setForm({ ...form, defaultCpu: Number(event.target.value) })} /></label><label>Default memory MiB<input type="number" min={128} max={262144} step={128} value={form.defaultMemoryMiB} onChange={(event) => setForm({ ...form, defaultMemoryMiB: Number(event.target.value) })} /></label><label>Maximum vCPU<input type="number" min={1} max={64} value={form.maxCpu} onChange={(event) => setForm({ ...form, maxCpu: Number(event.target.value) })} /></label><label>Maximum memory MiB<input type="number" min={128} max={262144} step={128} value={form.maxMemoryMiB} onChange={(event) => setForm({ ...form, maxMemoryMiB: Number(event.target.value) })} /></label></div><Button size="sm" variant="outline" disabled={mutation.isPending || !valid} onClick={async () => { try { await mutation.mutateAsync(); await committed() } catch { /* shown */ } }}>儲存草稿內容</Button><MutationFeedback mutation={mutation} success="草稿內容已更新。" /></div>
}

export function NavigationPage() {
  const [center, setCenter] = useState<Center>('admin')
  const navigation = useQuery({ queryKey: queryKey('admin-navigation', center), queryFn: () => api.getAdminNavigation(center) })
  return <><PageHeading eyebrow="ADMIN · NAVIGATION" title="導航目錄" description="只管理已註冊 route 的 label、group、order 與 enabled；required action 永遠由程式碼決定。" /><form className="panel filter-bar request-filter"><label>預覽中心<select value={center} onChange={(event) => setCenter(event.target.value as Center)}>{Object.entries(roleLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></form>{navigation.isPending ? <LoadingState /> : navigation.isError ? <ErrorState error={navigation.error} /> : <div className="panel table-scroll admin-navigation-table"><table><caption>{roleLabel[center]} 已註冊導航設定</caption><thead><tr><th>Route key</th><th>Label</th><th>Group</th><th>Order</th><th>Enabled</th><th>操作</th></tr></thead><tbody>{navigation.data.map((item) => <NavigationRow key={`${item.id}:${item.version}`} item={item} committed={() => navigation.refetch()} />)}</tbody></table></div>}</>
}

export function AdminCatalogPage() {
  const [selection] = useSearchParams()
  const itemId = selection.get('itemId')
  const catalog = useQuery({ queryKey: queryKey('catalog', 'admin'), queryFn: () => api.listCatalog({ page: 1, pageSize: 100, sort: 'name', order: 'asc' }) })
  const [reason, setReason] = useState('Reviewed by platform governance')
  const mutation = useMutation({ mutationFn: async ({ action, item }: { action: 'draft' | 'publish' | 'disable'; item: CatalogItem }) => action === 'draft' ? api.createCatalogRevision(item, reason) : action === 'publish' ? api.publishCatalog(item, reason) : api.disableCatalog(item, reason) })
  const run = async (action: 'draft' | 'publish' | 'disable', item: CatalogItem) => { try { await mutation.mutateAsync({ action, item }); await catalog.refetch() } catch { /* shown */ } }
  return <><PageHeading eyebrow="ADMIN · CATALOG" title="服務目錄治理" description="Published revision 不可直接改寫；先建立下一版 draft，發布後 RD 才能申請。" /><section className="panel admin-form"><label className="span-all">變更理由<input value={reason} onChange={(event) => setReason(event.target.value)} /></label></section>{catalog.isPending ? <LoadingState /> : catalog.isError ? <ErrorState error={catalog.error} /> : <div className="catalog-grid">{itemId && !catalog.data.items.some(item => item.id === itemId) && <section className="panel empty-state"><h2>目前範圍找不到此目錄</h2></section>}{catalog.data.items.filter(item => !itemId || item.id === itemId).map((item) => <article className="panel" key={`${item.id}:${item.version}`}><div className="panel-title"><BookOpen size={20} /><h2>{item.name}</h2><span className="tag">rev {item.revision} · {statusLabel[item.status]}</span></div><code>{item.id}</code><p className="muted">{item.description}</p><dl className="detail-list"><div><dt>Projects</dt><dd>{item.allowedProjectIds.join(', ')}</dd></div><div><dt>Providers</dt><dd>{item.template.allowedProviders.join(', ')}</dd></div><div><dt>Limits</dt><dd>{item.template.resourceKind === 'compute' ? `${item.template.limits.maxCpu} vCPU · ${item.template.limits.maxMemoryMiB} MiB` : item.template.resourceKind === 'redis' ? `${item.template.limits.minQuotaMiB}–${item.template.limits.maxQuotaMiB} MiB` : `${item.template.limits.minPartitions}–${item.template.limits.maxPartitions} partitions · ${item.template.limits.maxRetentionHours} 小時 · ${item.template.limits.maxThroughputKiBPerSecond} KiB/s`}</dd></div></dl>{item.status === 'draft' && (item.template.resourceKind === 'compute' ? <ComputeCatalogDraftEditor item={{ ...item, template: item.template }} committed={() => catalog.refetch()} /> : <ResourceCatalogDraftEditor item={{ ...item, template: item.template }} committed={() => catalog.refetch()} />)}<div className="request-actions">{item.status !== 'draft' && <Button variant="outline" disabled={mutation.isPending || !reason.trim()} onClick={() => void run('draft', item)}>建立下一版草稿</Button>}{item.status === 'draft' && <Button disabled={mutation.isPending || !reason.trim()} onClick={() => void run('publish', item)}>發布 revision</Button>}{item.status === 'published' && <Button variant="destructive" disabled={mutation.isPending || !reason.trim()} onClick={() => void run('disable', item)}>停用新申請</Button>}</div></article>)}</div>}<MutationFeedback mutation={mutation} success="服務目錄狀態已更新。" /></>
}

function ModelRow({ field, committed }: { field: ModelField; committed: () => Promise<unknown> }) {
  const [label, setLabel] = useState(field.label)
  const mutation = useMutation({ mutationFn: (body: { label?: string; hidden?: boolean }) => api.patchModelField(field.id, field.version, body) })
  const save = async (body: { label?: string; hidden?: boolean }) => { try { await mutation.mutateAsync(body); await committed() } catch { /* shown */ } }
  return <tr><th scope="row">{field.kind}<small><code>{field.key}</code></small></th><td><input aria-label={`${field.key} label`} value={label} onChange={(event) => setLabel(event.target.value)} /></td><td>{field.valueType}</td><td>否</td><td>{field.hidden ? '隱藏' : '顯示'}</td><td><div className="request-actions"><Button size="sm" variant="outline" disabled={mutation.isPending || !label.trim() || label === field.label} onClick={() => void save({ label })}>儲存名稱</Button><Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => void save({ hidden: !field.hidden })}>{field.hidden ? '顯示' : '隱藏'}</Button></div>{mutation.isError && <span className="field-error">{(mutation.error as Error).message}</span>}</td></tr>
}

export function ModelsPage() {
  const models = useQuery({ queryKey: queryKey('models'), queryFn: () => api.getModels() })
  const [form, setForm] = useState({ kind: 'compute', key: '', label: '', valueType: 'string' as 'string' | 'number' | 'boolean' })
  const create = useMutation({ mutationFn: () => api.createModelField({ ...form, kind: form.kind as Parameters<typeof api.createModelField>[0]['kind'], constraints: form.valueType === 'string' ? { maxLength: 120 } : form.valueType === 'number' ? { min: 0 } : {} }) })
  const submit = async (event: FormEvent) => { event.preventDefault(); try { await create.mutateAsync(); setForm({ ...form, key: '', label: '' }); await models.refetch() } catch { /* shown */ } }
  if (models.isPending) return <LoadingState />
  if (models.isError) return <ErrorState error={models.error} />
  return <><PageHeading eyebrow="ADMIN · CMDB MODEL" title="CMDB 自訂欄位" description="只能新增 optional metadata；核心 identity、既有 key/type 與 required 狀態不可變。" /><form className="panel admin-form" onSubmit={(event) => void submit(event)}><div className="panel-title"><Wrench size={20} /><h2>新增 optional 欄位</h2></div><label>CI kind<select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>{models.data.kinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label><label>Key<input required pattern="[a-z][a-zA-Z0-9_]{0,63}" value={form.key} onChange={(event) => setForm({ ...form, key: event.target.value })} /></label><label>Label<input required value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} /></label><label>Type<select value={form.valueType} onChange={(event) => setForm({ ...form, valueType: event.target.value as typeof form.valueType })}><option>string</option><option>number</option><option>boolean</option></select></label><div className="form-actions span-all"><Button type="submit" disabled={create.isPending}>新增欄位</Button></div></form><MutationFeedback mutation={create} success="自訂欄位已新增。" /><section className="panel"><div className="panel-title"><h2>欄位定義</h2><span className="tag">{models.data.fields.length}</span></div>{models.data.fields.length === 0 ? <p className="muted">目前尚無自訂欄位。</p> : <div className="table-scroll"><table><thead><tr><th>Kind / key</th><th>Label</th><th>Type</th><th>Required</th><th>狀態</th><th>操作</th></tr></thead><tbody>{models.data.fields.map((field) => <ModelRow key={`${field.id}:${field.version}`} field={field} committed={() => models.refetch()} />)}</tbody></table></div>}</section></>
}

export function AuditPage() {
  const [filters, setFilters] = useSearchParams()
  const actorId = filters.get('actorId') ?? ''
  const entityType = filters.get('entityType') ?? ''
  const entityId = filters.get('entityId') ?? ''
  const setFilter = (key: string, value: string) => { const next = new URLSearchParams(filters); if (value) next.set(key, value); else next.delete(key); setFilters(next) }
  const setActorId = (value: string) => setFilter('actorId', value)
  const setEntityType = (value: string) => setFilter('entityType', value)
  const audit = useQuery({ queryKey: queryKey('audit', null, { actorId, entityType, entityId }), queryFn: () => api.listAudit({ ...(actorId ? { actorId } : {}), ...(entityType ? { entityType } : {}), ...(entityId ? { entityId } : {}), page: 1, pageSize: 100, sort: 'occurredAt', order: 'desc' }) })
  return <><PageHeading eyebrow="ADMIN · AUDIT" title="管理稽核" description="安全 diff 摘要可依 actor/entity 篩選；不保存任意 payload、token 或完整 log。" /><form className="panel filter-bar" onSubmit={(event) => event.preventDefault()}><label>Actor ID<input value={actorId} onChange={(event) => setActorId(event.target.value)} /></label><label>Entity type<input value={entityType} onChange={(event) => setEntityType(event.target.value)} /></label><label>Entity ID<input value={entityId} onChange={event => setFilter('entityId', event.target.value)} /></label></form>{audit.isPending ? <LoadingState /> : audit.isError ? <ErrorState error={audit.error} /> : audit.data.items.length === 0 ? <section className="panel empty-state"><h2>目前沒有符合條件的稽核</h2></section> : <div className="panel table-scroll"><table><caption>安全管理稽核；共 {audit.data.total} 筆</caption><thead><tr><th>時間 / action</th><th>Actor</th><th>Entity</th><th>Outcome</th><th>Diff / reason</th><th>Correlation</th></tr></thead><tbody>{audit.data.items.map((entry) => <tr key={entry.id}><th scope="row">{new Date(entry.occurredAt).toLocaleString('zh-TW')}<small>{entry.action}</small></th><td><code>{entry.actorId}</code></td><td>{entry.entityType}<small><code>{entry.entityId}</code></small></td><td>{entry.outcome}</td><td>{entry.diffSummary.join('、')}{entry.reason && <small>{entry.reason}</small>}</td><td><code>{entry.correlationId}</code></td></tr>)}</tbody></table></div>}</>
}

export function AdminOverviewLinks() {
  return <section className="panel"><div className="panel-title"><Shield size={20} /><h2>治理工作區</h2></div><div className="admin-link-grid"><Button asChild variant="outline"><Link to="/admin/access">角色與範圍</Link></Button><Button asChild variant="outline"><Link to="/admin/navigation">導航目錄</Link></Button><Button asChild variant="outline"><Link to="/admin/catalog">服務目錄治理</Link></Button><Button asChild variant="outline"><Link to="/admin/cmdb-models">CMDB 自訂欄位</Link></Button><Button asChild variant="outline"><Link to="/admin/audit"><ScrollText size={16} />管理稽核</Link></Button></div></section>
}
