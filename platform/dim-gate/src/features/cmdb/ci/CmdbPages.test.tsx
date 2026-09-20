// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CIView, Page, SessionView } from '../../../domain/schemas'
import { CiDetailPage } from './CiDetailPage'
import { CmdbListPage } from './CmdbListPage'

const client = vi.hoisted(() => ({ listCis: vi.fn(), getCi: vi.fn(), createCi: vi.fn(), patchCi: vi.fn() }))
vi.mock('../../../api/client', () => ({
  api: client,
  queryKey: (family: string, scope: unknown = null, filters: unknown = null) => ['session-test', 1, 1, family, scope, filters],
}))

const baseCi: CIView = {
  id: 'ci-aws-02', orgId: 'org-demo', version: 1, createdAt: '2026-09-20T09:00:00Z', updatedAt: '2026-09-20T09:00:00Z',
  name: 'aws-compute-zero', kind: 'compute', provider: 'aws', externalId: 'aws-external-02', accountId: 'account-aws-demo',
  locationId: 'location-aws-sg', poolId: 'pool-aws-sg', ownerTeamId: 'team-commerce', visibilityProjectIds: ['project-store'],
  lifecycle: 'active', health: 'healthy', tags: { mode: 'demo' }, customFields: {}, source: 'discovered',
  observedAt: '2026-09-18T08:00:00Z', attributes: { instanceType: 'demo.compute.small', vpcId: 'vpc-demo', subnetId: 'subnet-demo', cpu: 0, memoryMiB: 0 },
}
const unknownCi: CIView = {
  ...baseCi, id: 'ci-idc-redis-01', name: 'shared-redis-demo', kind: 'cache', provider: 'onprem', externalId: 'demo-redis-01',
  accountId: undefined, locationId: 'location-idc-sg', poolId: 'pool-idc-sg', ownerTeamId: 'team-platform',
  visibilityProjectIds: ['project-store', 'project-data'], health: 'unknown', source: 'manual', observedAt: null,
  attributes: { engine: 'redis', versionLabel: '7-demo', endpointLabel: 'redis.example.invalid' },
}
const session: SessionView = {
  user: { id: 'user-ops', displayName: 'Platform Ops' }, assignments: [], effectiveActions: ['ci.read', 'ci.create', 'ci.update'],
  centers: ['ops'], demo: true, sessionId: 'session-test', identityEpoch: 1, generation: 1, policyVersion: 1,
  storeRevision: 0, logicalClock: 0, storageMode: 'memory',
}

function page(items: CIView[], total = items.length): Page<CIView> { return { items, total, page: 1, pageSize: 25 } }
function mount(ui: React.ReactNode) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={cache}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>)
}

beforeEach(() => {
  vi.resetAllMocks()
  client.listCis.mockImplementation(async (filters: { provider?: CIView['provider']; pageSize?: number } = {}) => {
    const totals = { aws: 20, aliyun: 20, onprem: 20 }
    if (filters.pageSize === 1) return page([], filters.provider ? totals[filters.provider] : 60)
    if (filters.provider) return page(filters.provider === 'aws' ? [baseCi] : [], totals[filters.provider])
    return page([baseCi, unknownCi], 60)
  })
  client.getCi.mockResolvedValue(baseCi)
  client.createCi.mockResolvedValue({ entityType: 'ci', entityId: 'ci-manual-0001', entityVersion: 1, correlationId: 'corr-create', changed: [{ entityType: 'ci', entityId: 'ci-manual-0001' }] })
  client.patchCi.mockResolvedValue({ entityType: 'ci', entityId: baseCi.id, entityVersion: 2, correlationId: 'corr-update', changed: [{ entityType: 'ci', entityId: baseCi.id }] })
})
afterEach(cleanup)

describe('Ops CMDB list (AC-04, AC-08)', () => {
  it('renders 60/20/20/20 counts, provider filters, stale/unknown and numeric zero distinctly', async () => {
    mount(<CmdbListPage session={session} />)
    const counts = await screen.findByRole('region', { name: 'Provider 可見數量' })
    expect(await within(counts).findByText('60')).toBeVisible()
    expect(within(counts).getAllByText('20')).toHaveLength(3)
    expect(await screen.findByText('aws-compute-zero')).toBeVisible()
    expect(screen.getByRole('row', { name: /aws-compute-zero/ })).toHaveTextContent(/0 vCPU.*0 MiB/)
    expect(screen.getByRole('row', { name: /aws-compute-zero/ })).toHaveTextContent('過期')
    expect(screen.getByRole('row', { name: /shared-redis-demo/ })).toHaveTextContent('未知 · 尚未觀測')
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'aliyun' } })
    await waitFor(() => expect(client.listCis).toHaveBeenCalledWith(expect.objectContaining({ provider: 'aliyun', pageSize: 25 })))
    const empty = (await screen.findByRole('heading', { name: '目前 scope 沒有符合條件的配置項' })).closest('section')!
    expect(empty).toBeVisible()
    fireEvent.click(within(empty).getByRole('button', { name: '清除篩選' }))
    expect(await screen.findByText('aws-compute-zero')).toBeVisible()
  })

  it('submits a provider-specific onboarding command and exposes actionable validation errors', async () => {
    mount(<CmdbListPage session={session} />)
    await screen.findByText('aws-compute-zero')
    fireEvent.click(screen.getByRole('button', { name: '手動納管 CI' }))
    fireEvent.change(screen.getByLabelText('名稱'), { target: { value: 'manual-from-ui' } })
    fireEvent.change(screen.getByLabelText('外部識別碼'), { target: { value: 'i-ui-01' } })
    fireEvent.click(screen.getByRole('button', { name: '確認納管' }))
    await waitFor(() => expect(client.createCi).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'aws', accountId: 'account-aws-demo', locationId: 'location-aws-sg', externalId: 'i-ui-01',
      attributes: expect.objectContaining({ subnetId: 'subnet-demo', cpu: 1, memoryMiB: 1024 }),
    })))
    expect(await screen.findByText('ci-manual-0001')).toBeVisible()

    client.createCi.mockRejectedValueOnce({ status: 422, code: 'VALIDATION_ERROR', message: 'provider、account、location 與 pool 必須相容。', requestId: 'http-422', fieldErrors: { provider: ['Incompatible provider identity'] } })
    fireEvent.click(screen.getByRole('button', { name: '手動納管 CI' }))
    fireEvent.change(screen.getByLabelText('名稱'), { target: { value: 'invalid-ui' } })
    fireEvent.change(screen.getByLabelText('外部識別碼'), { target: { value: 'bad-ui-01' } })
    fireEvent.change(screen.getByLabelText('Region location ID'), { target: { value: 'location-idc-sg' } })
    fireEvent.click(screen.getByRole('button', { name: '確認納管' }))
    expect(await screen.findByText('Incompatible provider identity')).toBeVisible()
    expect(screen.getByText(/http-422/)).toBeVisible()
    expect(screen.getByLabelText('名稱')).toHaveValue('invalid-ui')
  })
})

describe('Ops CI detail and metadata (AC-05, AC-08)', () => {
  it('shows legal provider fields, explicit zero values, locked identity and submits expectedVersion metadata only', async () => {
    mount(<CiDetailPage session={session} ciId={baseCi.id} />)
    expect(await screen.findByRole('heading', { name: baseCi.name })).toBeVisible()
    expect(screen.getByText('Subnet ID')).toBeVisible()
    expect(screen.getAllByText('0')).toHaveLength(2)
    expect(screen.getByText(/過期/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '編輯 metadata' }))
    expect(screen.getByLabelText('不可變 canonical identity')).toHaveTextContent('aws / location-aws-sg / compute / aws-external-02')
    fireEvent.change(screen.getByLabelText('名稱'), { target: { value: 'renamed-ui' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存 metadata' }))
    await waitFor(() => expect(client.patchCi).toHaveBeenCalledWith(baseCi.id, {
      expectedVersion: 1, name: 'renamed-ui', tags: { mode: 'demo' },
    }))
  })

  it('keeps the edit dialog open on 409 and offers an explicit latest-version refetch', async () => {
    client.patchCi.mockRejectedValueOnce({ status: 409, code: 'VERSION_CONFLICT', message: '資源版本已變更，請重新讀取後再確認。', requestId: 'http-conflict' })
    mount(<CiDetailPage session={session} ciId={baseCi.id} />)
    await screen.findByRole('heading', { name: baseCi.name })
    fireEvent.click(screen.getByRole('button', { name: '編輯 metadata' }))
    fireEvent.click(screen.getByRole('button', { name: '儲存 metadata' }))
    expect(await screen.findByText('資料版本已更新')).toBeVisible()
    expect(screen.getByText(/http-conflict/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '重新讀取最新版本' }))
    await waitFor(() => expect(client.getCi).toHaveBeenCalledTimes(2))
  })
})
