// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { deferredClient } from '../../api/core/deferred-client'
import type { Application, CommandReceipt, Environment, Incident, Integration, SessionView } from '../../domain/schemas'
import { IncidentDetailPage, IncidentListPage, IntegrationsPage, ObservabilityPage } from './index'

const mocks = vi.hoisted(() => ({ getDashboard: vi.fn(), listApplications: vi.fn(), getApplication: vi.fn(), getMetrics: vi.fn(), listTraces: vi.fn(), getTrace: vi.fn(), listLogs: vi.fn(), listIncidents: vi.fn(), getIncident: vi.fn(), acknowledgeIncident: vi.fn(), investigateIncident: vi.fn(), listAudit: vi.fn(), getTopology: vi.fn(), listReleases: vi.fn(), listIntegrations: vi.fn(), testIntegration: vi.fn() }))
vi.mock('../../api/client', () => ({ api: mocks, queryKey: (family: string, scope: unknown = null, filters: unknown = null) => ['test-session', 1, 1, family, scope, filters] }))

const time = '2026-09-20T09:03:00.000Z'
const base = { orgId: 'org-demo', version: 1, createdAt: time, updatedAt: time }
const application: Application = { ...base, id: 'app-checkout', projectId: 'project-store', ownerTeamId: 'team-commerce', name: 'checkout-api', slug: 'checkout-api', tier: 'critical', description: 'Demo' }
const environment: Environment = { ...base, id: 'env-checkout', applicationId: application.id, name: 'checkout-staging', stage: 'staging', status: 'ready', activeReleaseId: 'release-next' }
const incident: Incident = { ...base, id: 'incident-test', applicationId: application.id, environmentId: environment.id, affectedCiIds: ['ci-visible'], severity: 'critical', state: 'open', episode: 1, ruleKey: 'red-degradation', recoverySamples: 0, relatedReleaseId: 'release-next', correlationId: 'corr-incident', evidence: [{ ruleKey: 'red-degradation', metric: 'p95Latency', threshold: 500, sampleWindow: { from: '2026-09-20T09:01:00.000Z', to: '2026-09-20T09:02:00.000Z' }, traceIds: ['trace-test'], logIds: ['log-test'] }] }
const integration: Integration = { ...base, id: 'integration-test', kind: 'observation', displayName: 'Demo APM', poolIds: ['pool-demo'], endpointLabel: 'Synthetic APM endpoint', state: 'demo', lastSyncAt: null, fieldMappings: { latency: 'p95Latency' } }
const receipt: CommandReceipt = { entityType: 'incident', entityId: incident.id, entityVersion: 2, correlationId: 'corr-action', changed: [{ entityType: 'incident', entityId: incident.id }] }
const session = (role: 'rd' | 'ops' | 'admin' = 'ops'): SessionView => ({ sessionId: 'test-session', identityEpoch: 1, policyVersion: 1, generation: 1, storageMode: 'memory', storeRevision: 1, logicalClock: 180, demo: true, user: { id: `user-${role}`, displayName: role }, centers: [role], assignments: [{ ...base, id: `grant-${role}`, userId: `user-${role}`, role, scopeType: role === 'admin' ? 'org' : 'project', scopeId: role === 'admin' ? 'org-demo' : 'project-store' }], effectiveActions: role === 'ops' ? ['observation.read', 'incident.read', 'incident.acknowledge', 'incident.investigate'] : role === 'admin' ? ['observation.read', 'incident.read', 'integration.test'] : ['observation.read', 'incident.read'] })
const page = <T,>(items: T[] = []) => ({ items, page: 1, pageSize: 25, total: items.length })
const observationPath = '/rd/observability?applicationId=app-checkout&environmentId=env-checkout&from=2026-09-20T09%3A00%3A00.000Z&to=2026-09-20T09%3A03%3A01.000Z'

function mount(path: string, actor = session()) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[path]}><Routes><Route path="/rd/observability" element={<ObservabilityPage session={actor} />} /><Route path="/ops/incidents" element={<IncidentListPage session={actor} />} /><Route path="/ops/incidents/:incidentId" element={<IncidentDetailPage session={actor} />} /><Route path="/admin/integrations" element={<IntegrationsPage session={actor} />} /></Routes></MemoryRouter></QueryClientProvider>)
  return cache
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getDashboard.mockResolvedValue({ dataAsOf: time })
  mocks.listApplications.mockResolvedValue(page([application]))
  mocks.getApplication.mockResolvedValue({ application, environments: [environment] })
  mocks.getMetrics.mockResolvedValue({ series: [{ metric: 'p95Latency', unit: 'ms', sampleCount: 0, points: [] }] })
  mocks.listTraces.mockResolvedValue(page())
  mocks.listLogs.mockResolvedValue(page())
  mocks.listIncidents.mockResolvedValue(page([incident]))
  mocks.getIncident.mockResolvedValue(incident)
  mocks.listAudit.mockResolvedValue(page())
  mocks.getTopology.mockResolvedValue({ nodes: [], edges: [], truncated: false, depthReached: 0 })
  mocks.listReleases.mockResolvedValue(page())
  mocks.listIntegrations.mockResolvedValue([integration])
})
afterEach(cleanup)

describe('observation pages', () => {
  it('keeps pending and no-sample results distinct from healthy or zero metrics', async () => {
    let resolveMetrics!: (data: unknown) => void
    mocks.getMetrics.mockReturnValue(new Promise(resolve => { resolveMetrics = resolve }))
    mount(observationPath)
    expect(await screen.findByText('正在讀取觀測樣本…')).toBeVisible()
    expect(screen.queryByText(/0 筆樣本/)).not.toBeInTheDocument()
    await act(async () => resolveMetrics({ series: [{ metric: 'p95Latency', unit: 'ms', sampleCount: 0, points: [] }] }))
    expect(await screen.findByText('此時間範圍沒有樣本；健康狀態未知。')).toBeVisible()
    expect(screen.queryByText('0 ms')).not.toBeInTheDocument()
  })

  it('renders percent and unknown samples without replacing null with zero, and retains the trace/log window', async () => {
    mocks.getMetrics.mockResolvedValue({ series: [{ metric: 'errorRate', unit: 'fraction', sampleCount: 2, points: [{ t: '2026-09-20T09:01:00.000Z', value: 0.08 }, { t: '2026-09-20T09:02:00.000Z', value: null }] }] })
    mocks.listTraces.mockResolvedValue(page([{ id: 'trace-test', applicationId: application.id, environmentId: environment.id, name: 'checkout request', start: '2026-09-20T09:01:10.000Z', durationMs: 900, status: 'error', releaseId: 'release-next' }]))
    mocks.getTrace.mockResolvedValue({ id: 'trace-test', applicationId: application.id, environmentId: environment.id, name: 'checkout request', start: '2026-09-20T09:01:10.000Z', durationMs: 900, status: 'error', spans: [{ id: 'span-root', parentId: null, name: 'request', start: '2026-09-20T09:01:10.000Z', durationMs: 900, status: 'error', ciId: 'ci-visible' }] })
    mount(observationPath)
    const traceLink = await screen.findByRole('link', { name: 'checkout request' })
    expect(traceLink.getAttribute('href')).toContain('from=2026-09-20T09%3A00%3A00.000Z')
    fireEvent.click(screen.getByText('錯誤率資料表'))
    const table = screen.getByRole('table', { name: '錯誤率 · 原始樣本值' })
    expect(within(table).getByText('8 %')).toBeVisible()
    expect(within(table).getByText('未知')).toBeVisible()
    fireEvent.click(traceLink)
    expect(await screen.findByRole('heading', { name: 'Trace waterfall · checkout request' })).toBeVisible()
    await waitFor(() => expect(mocks.listLogs).toHaveBeenLastCalledWith(expect.objectContaining({ applicationId: application.id, environmentId: environment.id, traceId: 'trace-test', from: '2026-09-20T09:00:00.000Z', to: '2026-09-20T09:03:01.000Z' })))
    expect(screen.getByRole('link', { name: '查看此 Trace 的日誌' })).toHaveAttribute('href', '#observation-logs')
  })

  it('does not request raw traces or logs for an Admin metadata-only grant', async () => {
    mount(observationPath + '&traceId=trace-hidden', session('admin'))
    expect(await screen.findByText(/目前身分僅可讀取觀測 metadata/)).toBeVisible()
    expect(mocks.listTraces).not.toHaveBeenCalled()
    expect(mocks.getTrace).not.toHaveBeenCalled()
    expect(mocks.listLogs).not.toHaveBeenCalled()
    expect(screen.queryByText('trace-hidden')).not.toBeInTheDocument()
  })

  it('rejects an invalid or over-24-hour URL window without requesting samples', async () => {
    mount(observationPath.replace('09%3A03%3A01.000Z', '09%3A00%3A00.000Z'))
    expect(await screen.findByRole('alert')).toHaveTextContent('起點須早於終點')
    expect(mocks.getMetrics).not.toHaveBeenCalled()
    expect(mocks.listTraces).not.toHaveBeenCalled()
  })
})

describe('incident pages', () => {
  it('does not disclose a missing or scope-out incident identifier', async () => {
    mocks.getIncident.mockRejectedValue({ status: 404, code: 'NOT_FOUND', requestId: 'hidden-request' })
    mount('/ops/incidents/incident-hidden')
    expect(await screen.findByRole('heading', { name: '找不到這個事件' })).toBeVisible()
    expect(screen.queryByText('incident-hidden')).not.toBeInTheDocument()
    expect(screen.queryByText('hidden-request')).not.toBeInTheDocument()
    expect(mocks.getApplication).not.toHaveBeenCalled()
  })

  it('retains pending ownership through receipt and query refresh, then shows the acknowledged state', async () => {
    let finishCommand!: (value: CommandReceipt) => void
    let finishRefresh!: (value: Incident) => void
    mocks.acknowledgeIncident.mockReturnValue(new Promise(resolve => { finishCommand = resolve }))
    mount('/ops/incidents/incident-test')
    fireEvent.click(await screen.findByRole('button', { name: '認領事件' }))
    const reason = await screen.findByRole('textbox', { name: '操作理由' })
    await waitFor(() => expect(reason).toHaveFocus())
    fireEvent.change(reason, { target: { value: '檢查最近發布與延遲' } })
    fireEvent.click(screen.getByRole('button', { name: '確認認領事件' }))
    await waitFor(() => expect(mocks.acknowledgeIncident).toHaveBeenCalledWith(incident.id, 1, '檢查最近發布與延遲'))
    mocks.getIncident.mockReturnValue(new Promise(resolve => { finishRefresh = resolve }))
    await act(async () => finishCommand(receipt))
    expect(screen.getByRole('button', { name: '處理與更新中…' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '操作理由' })).toBeDisabled()
    await act(async () => finishRefresh({ ...incident, version: 2, state: 'acknowledged', assigneeId: 'user-ops' }))
    expect(await screen.findByText('認領事件已完成 · corr-action')).toBeVisible()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '開始調查' })).toBeEnabled()
  })

  it('closes a reason dialog with Escape and returns focus to its trigger', async () => {
    mount('/ops/incidents/incident-test')
    const trigger = await screen.findByRole('button', { name: '認領事件' })
    fireEvent.click(trigger)
    const reason = await screen.findByRole('textbox', { name: '操作理由' })
    await waitFor(() => expect(reason).toHaveFocus())
    fireEvent.keyDown(reason, { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(mocks.acknowledgeIncident).not.toHaveBeenCalled()
  })

  it('requires explicit conflict refresh and retains the reviewed reason', async () => {
    mocks.acknowledgeIncident.mockRejectedValue({ status: 409, code: 'VERSION_CONFLICT', message: '事件已變更', requestId: 'conflict-test' })
    mount('/ops/incidents/incident-test')
    fireEvent.click(await screen.findByRole('button', { name: '認領事件' }))
    fireEvent.change(await screen.findByRole('textbox', { name: '操作理由' }), { target: { value: '檢查異常' } })
    fireEvent.click(screen.getByRole('button', { name: '確認認領事件' }))
    expect(await screen.findByText('VERSION_CONFLICT')).toBeVisible()
    expect(screen.getByRole('textbox', { name: '操作理由' })).toHaveValue('檢查異常')
    expect(screen.getByRole('button', { name: '確認認領事件' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '重新讀取事件' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.acknowledgeIncident).toHaveBeenCalledTimes(1)
  })

  it('keeps two recovery samples active and RD actions disabled while preserving evidence links', async () => {
    mocks.getIncident.mockResolvedValue({ ...incident, state: 'investigating', assigneeId: 'user-ops', recoverySamples: 2 })
    mount('/ops/incidents/incident-test', session('rd'))
    expect(await screen.findByText('2 / 3')).toBeVisible()
    expect(await screen.findByRole('link', { name: 'Trace trace-test' })).toHaveAttribute('href', expect.stringContaining('environmentId=env-checkout'))
    expect(screen.getByRole('button', { name: '認領事件' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '接手調查' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /恢復|resolve/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '關聯發布 release-next' })).toHaveAttribute('href', '/rd/releases/release-next')
  })

  it('keeps list loading separate from a scoped empty result', async () => {
    let finish!: (value: unknown) => void
    mocks.listIncidents.mockReturnValue(new Promise(resolve => { finish = resolve }))
    mount('/ops/incidents?environmentId=env-unseen')
    expect(await screen.findByText('正在讀取授權範圍內的事件…')).toBeVisible()
    expect(screen.queryByText('目前範圍沒有事件')).not.toBeInTheDocument()
    await act(async () => finish(page()))
    expect(await screen.findByRole('heading', { name: '目前範圍沒有事件' })).toBeVisible()
  })
})

describe('integration metadata and simulated tests', () => {
  it('loads integration metadata through the deferred client without forwarding React Query context', async () => {
    const transport = vi.fn(async () => [integration])
    const client = deferredClient(async () => ({ listIntegrations: transport }), { listIntegrations: true },
      () => ({ actorId: 'user-admin', sessionId: 'test-session', generation: 1, policyVersion: 1, identityEpoch: 1 }))
    mocks.listIntegrations.mockImplementation(client.listIntegrations)
    const cache = mount('/admin/integrations', session('admin'))
    expect(await screen.findByRole('button', { name: '模擬測試 · Demo APM' })).toBeEnabled()
    expect(transport).toHaveBeenLastCalledWith()
    await act(async () => { await cache.invalidateQueries() })
    expect(transport).toHaveBeenCalledTimes(2)
    expect(transport).toHaveBeenLastCalledWith()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps Ops integration metadata read-only and reports an API error without a successful test result', async () => {
    mount('/admin/integrations', session('ops'))
    expect(await screen.findByRole('button', { name: '模擬測試 · Demo APM' })).toBeDisabled()
    expect(mocks.testIntegration).not.toHaveBeenCalled()
    cleanup()
    mocks.testIntegration.mockRejectedValue({ status: 503, code: 'SERVICE_UNAVAILABLE', message: '模擬 API 無法使用', requestId: 'test-unavailable' })
    mount('/admin/integrations', session('admin'))
    fireEvent.click(await screen.findByRole('button', { name: '模擬測試 · Demo APM' }))
    fireEvent.click(await screen.findByRole('button', { name: '確認模擬測試' }))
    expect(await screen.findByText('SERVICE_UNAVAILABLE')).toBeVisible()
    expect(screen.queryByText(/Demo 測試通過/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '確認模擬測試' })).toBeDisabled()
  })

  it('shows a simulated result only after the command and authoritative refresh', async () => {
    let finish!: (value: CommandReceipt) => void
    mocks.testIntegration.mockReturnValue(new Promise(resolve => { finish = resolve }))
    mount('/admin/integrations', session('admin'))
    expect(await screen.findByText('尚未執行模擬測試；未驗證任何外部連線。')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '模擬測試 · Demo APM' }))
    fireEvent.click(await screen.findByRole('button', { name: '確認模擬測試' }))
    await waitFor(() => expect(mocks.testIntegration).toHaveBeenCalledWith(integration.id, 1))
    expect(screen.getByRole('button', { name: '測試與更新中…' })).toBeDisabled()
    expect(screen.queryByText(/Demo 測試通過/)).not.toBeInTheDocument()
    mocks.listIntegrations.mockResolvedValue([{ ...integration, version: 2, lastTestResult: { demo: true, succeeded: false, summary: '固定失敗的模擬結果', occurredAt: time } }])
    await act(async () => finish({ ...receipt, entityType: 'integration', entityId: integration.id }))
    expect(await screen.findByText(/Demo 測試失敗/)).toBeVisible()
    expect(screen.getByText('固定失敗的模擬結果')).toBeVisible()
    expect(screen.queryByText(/Demo 測試通過/)).not.toBeInTheDocument()
  })
})
