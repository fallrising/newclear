// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import type { DashboardView, SessionView } from '../domain/schemas'
import { AppSession, createAppQueryClient } from './App'

const client = vi.hoisted(() => ({
  session: null as SessionView | null,
  listeners: new Set<() => void>(),
  clock: 7,
  commandCount: 1,
  getSession: vi.fn(), getPersonas: vi.fn(), getDashboard: vi.fn(), getGuide: vi.fn(), setPersona: vi.fn(), advanceClock: vi.fn(), reset: vi.fn(),
}))

vi.mock('../api/client', () => ({
  api: {
    getSession: client.getSession, getPersonas: client.getPersonas, getDashboard: client.getDashboard,
    getGuide: client.getGuide, setPersona: client.setPersona, advanceClock: client.advanceClock, reset: client.reset,
    subscribe: (listener: () => void) => { client.listeners.add(listener); return () => client.listeners.delete(listener) },
  },
  getClientIdentity: () => client.session && ({ sessionId: client.session.sessionId, actorId: client.session.user.id, identityEpoch: client.session.identityEpoch, policyVersion: client.session.policyVersion, generation: client.session.generation }),
  queryKey: (family: string, scope: unknown = null, filters: unknown = null) => [client.session?.sessionId, client.session?.identityEpoch, client.session?.policyVersion, family, scope, filters],
}))

function makeSession(id = 'user-rd-commerce', epoch = 1): SessionView {
  return { user: { id, displayName: id === 'user-rd-commerce' ? 'Commerce 研發' : 'Data 研發' }, assignments: [], effectiveActions: ['app.read', 'environment.read', 'ci.read'], centers: ['rd'], demo: true, sessionId: 'session-test', identityEpoch: epoch, generation: 1, policyVersion: 1, storeRevision: 1, logicalClock: 7, storageMode: 'session' }
}
function dashboard(count = 2): DashboardView {
  return { center: 'rd', title: '研發中心', applicationCount: count, environmentCount: count, ciCount: count, providers: [{ provider: 'aws', count }, { provider: 'aliyun', count: 0 }, { provider: 'onprem', count: 0 }], dataAsOf: '2026-09-20T09:00:00Z' }
}
function mount(path = '/rd') {
  const queryClient = createAppQueryClient()
  return render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[path]}><AppSession /></MemoryRouter></QueryClientProvider>)
}
function notify() { for (const listener of client.listeners) listener() }

beforeEach(() => {
  vi.resetAllMocks()
  client.listeners.clear()
  client.session = makeSession()
  client.clock = 7
  client.commandCount = 1
  localStorage.clear()
  client.getSession.mockImplementation(async () => structuredClone(client.session))
  client.getPersonas.mockResolvedValue([{ id: 'user-rd-commerce', displayName: 'Commerce 研發', description: '商務專案', centers: ['rd'] }, { id: 'user-rd-data', displayName: 'Data 研發', description: '資料專案', centers: ['rd'] }])
  client.getDashboard.mockResolvedValue(dashboard())
  client.getGuide.mockImplementation(async () => ({ logicalClock: client.clock, storeRevision: client.commandCount, sessionId: 'session-test', seedVersion: 'dim-gate-m2-v1', schemaVersion: 1, pendingTasks: 0, commandCount: client.commandCount }))
  client.setPersona.mockImplementation(async (id: string) => { client.session = makeSession(id, 2); notify(); return structuredClone(client.session) })
  client.advanceClock.mockImplementation(async (ticks: number) => { client.clock += ticks; client.commandCount++; notify(); return { entityType: 'session', entityId: 'session-test', entityVersion: 2, correlationId: 'corr-test', changed: [] } })
  client.reset.mockImplementation(async () => { client.clock = 0; client.commandCount = 0; client.session = { ...makeSession(), identityEpoch: 2, generation: 2 }; notify(); return structuredClone(client.session) })
})
afterEach(cleanup)

describe('M0 role centers and session controls', () => {
  it('guards a forbidden deep link without querying or displaying its dashboard', async () => {
    mount('/admin')
    expect(await screen.findByRole('heading', { name: '目前身分無法進入平台管理' })).toBeVisible()
    expect(screen.queryByRole('link', { name: '平台管理' })).not.toBeInTheDocument()
    expect(client.getDashboard).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByLabelText('示範身分')).toBeEnabled())
    expect(screen.getByText('示範資料')).toBeVisible()
  })

  it('does not present zero counters while scope-filtered data is still loading', async () => {
    let resolveDashboard: (value: DashboardView) => void = () => undefined
    client.getDashboard.mockImplementation(() => new Promise<DashboardView>((resolve) => { resolveDashboard = resolve }))
    mount()
    expect(await screen.findByText('正在讀取目前身分的資料…')).toBeVisible()
    expect(screen.queryByRole('region', { name: '可見資源摘要' })).not.toBeInTheDocument()
    await act(async () => { resolveDashboard(dashboard(3)) })
    const summary = await screen.findByRole('region', { name: '可見資源摘要' })
    expect(within(summary).getByRole('table')).toBeVisible()
    expect(within(summary).getByText('AWS')).toBeVisible()
    expect(client.getDashboard).toHaveBeenCalledWith('rd')
  })

  it('invalidates scope data on persona switch and renders only the new identity', async () => {
    mount()
    await screen.findByRole('region', { name: '可見資源摘要' })
    client.getDashboard.mockResolvedValue(dashboard(1))
    fireEvent.change(screen.getByLabelText('示範身分'), { target: { value: 'user-rd-data' } })
    await waitFor(() => expect(screen.getByLabelText('示範身分')).toHaveValue('user-rd-data'))
    expect(client.setPersona).toHaveBeenCalledOnce()
    await screen.findByRole('region', { name: '可見資源摘要' })
    expect(screen.queryByText('Commerce 研發', { selector: 'strong' })).not.toBeInTheDocument()
    expect(screen.getByText('Data 研發', { selector: 'strong' })).toBeVisible()
  })

  it('discards an in-flight dashboard after changing persona', async () => {
    let resolveOld: (value: DashboardView) => void = () => undefined
    client.getDashboard.mockImplementationOnce(() => new Promise<DashboardView>((resolve) => { resolveOld = resolve }))
    mount()
    await screen.findByText('正在讀取目前身分的資料…')
    await waitFor(() => expect(screen.getByLabelText('示範身分')).toBeEnabled())
    client.getDashboard.mockResolvedValue(dashboard(1))
    fireEvent.change(screen.getByLabelText('示範身分'), { target: { value: 'user-rd-data' } })
    await screen.findByRole('region', { name: '可見資源摘要' })
    await act(async () => { resolveOld(dashboard(999)) })
    expect(screen.getByText('Data 研發', { selector: 'strong' })).toBeVisible()
    expect(screen.queryByText('999')).not.toBeInTheDocument()
  })

  it('keeps the stored clock after a failed command and exposes the request ID', async () => {
    client.advanceClock.mockRejectedValue({ code: 'DEMO_STORAGE_FULL', message: '示範儲存空間不足，變更未提交。', requestId: 'http-failed-007', status: 507 })
    mount('/guide')
    await screen.findByTestId('logical-clock')
    fireEvent.click(screen.getByRole('button', { name: '前進演示時鐘' }))
    expect(await screen.findByText('http-failed-007')).toBeVisible()
    expect(screen.getByTestId('logical-clock')).toHaveTextContent('7ticks')
    expect(client.advanceClock).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '前進演示時鐘' })).toBeEnabled()
  })

  it('reads committed clock progress and requires confirmation before resetting', async () => {
    mount('/guide')
    await screen.findByTestId('logical-clock')
    fireEvent.change(screen.getByLabelText('前進幅度'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '前進演示時鐘' }))
    await waitFor(() => expect(screen.getByTestId('logical-clock')).toHaveTextContent('12ticks'))
    expect(client.advanceClock).toHaveBeenCalledWith(5)
    const trigger = screen.getByRole('button', { name: '重置示範' })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: '重置這個示範 session？' })
    expect(client.reset).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: '保留目前進度' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(client.reset).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('button', { name: '確認重置示範' }))
    await waitFor(() => expect(screen.getByTestId('logical-clock')).toHaveTextContent('0ticks'))
    expect(client.reset).toHaveBeenCalledOnce()
  })

  it('supports Escape and persistent theme/density controls without changing domain data', async () => {
    mount('/guide')
    await screen.findByTestId('logical-clock')
    fireEvent.click(screen.getByRole('button', { name: '切換深色主題' }))
    fireEvent.change(screen.getByLabelText('顯示密度'), { target: { value: 'compact' } })
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.density).toBe('compact')
    expect(JSON.parse(localStorage.getItem('dim-gate.ui.v1') || '{}')).toEqual({ theme: 'dark', density: 'compact' })
    fireEvent.click(screen.getByRole('button', { name: '重置示範' }))
    await screen.findByRole('dialog')
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(client.reset).not.toHaveBeenCalled()
    expect(client.advanceClock).not.toHaveBeenCalled()
  })
})
