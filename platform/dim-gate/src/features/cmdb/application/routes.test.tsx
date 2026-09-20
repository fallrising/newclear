// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ApplicationClient, ApplicationDetail, EnvironmentDetail } from '../../../api/clients/application'
import type { Application, Environment, Placement } from '../../../domain/schemas'
import { ApplicationDetailRoute, ApplicationListRoute, EnvironmentDetailRoute } from './routes'

vi.mock('../../../api/client', () => ({
  api: {},
  queryKey: (family: string, scope: unknown = null, filters: unknown = null) => ['session-test', 1, 1, family, scope, filters],
}))

const timestamp = '2026-09-20T09:00:00Z'
const application: Application = {
  id: 'app-checkout', orgId: 'org-demo', projectId: 'project-store', ownerTeamId: 'team-commerce',
  name: 'checkout-api', slug: 'checkout-api', tier: 'critical', description: 'Checkout demo',
  version: 1, createdAt: timestamp, updatedAt: timestamp,
}
const environment: Environment = {
  id: 'env-checkout-dev', orgId: 'org-demo', applicationId: application.id, name: 'dev', stage: 'dev',
  status: 'ready', activeReleaseId: null, version: 1, createdAt: timestamp, updatedAt: timestamp,
}
const placement = (id: string, role: Placement['role']): Placement => ({
  id, orgId: 'org-demo', applicationId: application.id, environmentId: environment.id,
  ciId: 'ci-idc-redis-01', role, version: 1, createdAt: timestamp, updatedAt: timestamp,
})

function makeClient(overrides: Partial<ApplicationClient> = {}): ApplicationClient {
  return {
    listApplications: vi.fn().mockResolvedValue({ items: [application], total: 1, page: 1, pageSize: 25 }),
    getApplication: vi.fn().mockResolvedValue({ application, environments: [environment] } satisfies ApplicationDetail),
    getEnvironment: vi.fn().mockResolvedValue({ environment, placements: [placement('placement-1', 'dependency')], activeRelease: null } satisfies EnvironmentDetail),
    ...overrides,
  }
}

function mount(path: string, element: React.ReactNode, route: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={element} /></Routes></MemoryRouter></QueryClientProvider>)
}

afterEach(cleanup)

describe('RD application routes', () => {
  it('does not present a zero application result while the scoped list is loading', async () => {
    let resolveList: (value: Awaited<ReturnType<ApplicationClient['listApplications']>>) => void = () => undefined
    const pending = new Promise<Awaited<ReturnType<ApplicationClient['listApplications']>>>((resolve) => { resolveList = resolve })
    const client = makeClient({ listApplications: vi.fn().mockReturnValue(pending) })
    mount('/rd/apps', <ApplicationListRoute client={client} />, '/rd/apps')

    expect(await screen.findByText('正在讀取目前 scope 的應用…')).toBeVisible()
    expect(screen.queryByText('0 個')).not.toBeInTheDocument()

    await act(async () => resolveList({ items: [application], total: 1, page: 1, pageSize: 25 }))
    expect(await screen.findByRole('link', { name: 'checkout-api' })).toHaveAttribute('href', '/rd/apps/app-checkout')
  })

  it('renders a semantic scoped empty result without leaking Data identifiers to RD Commerce', async () => {
    const client = makeClient({ listApplications: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 }) })
    mount('/rd/apps', <ApplicationListRoute client={client} />, '/rd/apps')

    expect(await screen.findByRole('heading', { name: '目前範圍沒有應用' })).toBeVisible()
    expect(screen.queryByText('data-worker')).not.toBeInTheDocument()
    expect(screen.queryByText('app-data')).not.toBeInTheDocument()
  })

  it('links application environments using canonical application and environment IDs', async () => {
    const client = makeClient()
    mount('/rd/apps/app-checkout', <ApplicationDetailRoute client={client} />, '/rd/apps/:appId')

    const environmentLink = await screen.findByRole('link', { name: 'dev' })
    expect(environmentLink).toHaveAttribute('href', '/rd/apps/app-checkout/environments/env-checkout-dev')
    expect(screen.getByText('尚無 active release')).toBeVisible()
  })

  it('deduplicates a shared CI into one canonical Ops deep link while preserving placement roles', async () => {
    const client = makeClient({
      getEnvironment: vi.fn().mockResolvedValue({
        environment, placements: [placement('placement-workload', 'workload'), placement('placement-dependency', 'dependency')], activeRelease: null,
      } satisfies EnvironmentDetail),
    })
    mount('/rd/apps/app-checkout/environments/env-checkout-dev', <EnvironmentDetailRoute client={client} />, '/rd/apps/:appId/environments/:environmentId')

    const table = await screen.findByRole('table', { name: '此環境可見的 canonical CI placement' })
    expect(within(table).getAllByText('ci-idc-redis-01')).toHaveLength(1)
    expect(within(table).getByText('工作負載、相依服務')).toBeVisible()
    expect(within(table).getByRole('link', { name: '在 Ops 查看' })).toHaveAttribute('href', '/ops/cmdb/ci-idc-redis-01')
    expect(screen.getByText('1 個 canonical CI')).toBeVisible()
  })

  it('distinguishes a successful zero-placement result from unknown', async () => {
    const client = makeClient({ getEnvironment: vi.fn().mockResolvedValue({ environment, placements: [], activeRelease: null } satisfies EnvironmentDetail) })
    mount('/rd/apps/app-checkout/environments/env-checkout-dev', <EnvironmentDetailRoute client={client} />, '/rd/apps/:appId/environments/:environmentId')

    expect(await screen.findByText('此環境目前有 0 個可見配置項。0 代表已成功讀取的空結果，不是未知狀態。')).toBeVisible()
    expect(screen.getByText('0 個 canonical CI')).toBeVisible()
  })

  it('uses the same non-disclosing 404 presentation for missing and scope-out details', async () => {
    const client = makeClient({ getApplication: vi.fn().mockRejectedValue({ status: 404, code: 'NOT_FOUND', requestId: 'request-hidden' }) })
    mount('/rd/apps/app-data', <ApplicationDetailRoute client={client} />, '/rd/apps/:appId')

    expect(await screen.findByRole('heading', { name: '找不到這個應用' })).toBeVisible()
    expect(screen.queryByText('app-data')).not.toBeInTheDocument()
    expect(screen.queryByText('request-hidden')).not.toBeInTheDocument()
  })
})
