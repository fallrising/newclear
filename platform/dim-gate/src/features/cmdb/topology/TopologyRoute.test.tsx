// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { CIView, Relation } from '../../../domain/schemas'
import type { TopologyClient, TopologyView } from '../../../api/clients/topology'
import { TopologyRoute } from './TopologyRoute'

const timestamp = '2026-09-20T09:00:00Z'

function ci(id: string, name: string, version = 1): CIView {
  return {
    id, name, orgId: 'org-demo', version, createdAt: timestamp, updatedAt: timestamp,
    kind: 'cache', provider: 'onprem', externalId: id, locationId: 'location-idc-sg', poolId: 'pool-idc-sg',
    ownerTeamId: 'team-platform', visibilityProjectIds: ['project-store'], lifecycle: 'active', health: 'healthy',
    tags: {}, attributes: { engine: 'redis', versionLabel: '7', endpointLabel: `${id}.example.invalid` },
    customFields: {}, source: 'discovered', observedAt: timestamp,
  }
}

function edge(id: string, sourceCiId: string, targetCiId: string, source: Relation['source'] = 'manual'): Relation {
  return {
    id, sourceCiId, targetCiId, source, orgId: 'org-demo', version: 2, createdAt: timestamp, updatedAt: timestamp,
    type: 'depends_on', confidence: 'verified',
  }
}

const cycle: TopologyView = {
  nodes: [ci('ci-cycle-a', 'Cycle A', 2), ci('ci-cycle-b', 'Cycle B', 4)],
  edges: [
    edge('relation-cycle-a-b', 'ci-cycle-a', 'ci-cycle-b'),
    edge('relation-cycle-b-a', 'ci-cycle-b', 'ci-cycle-a', 'discovered'),
    edge('relation-hidden', 'ci-cycle-a', 'ci-data-hidden', 'discovered'),
  ],
  truncated: true,
  depthReached: 3,
}

function clientFor(result: TopologyView | Error): TopologyClient {
  return {
    getTopology: vi.fn(async () => { if (result instanceof Error) throw result; return result }),
    search: vi.fn(), listRelations: vi.fn(),
    createRelation: vi.fn().mockResolvedValue({ entityType: 'relation', entityId: 'relation-new', entityVersion: 1, correlationId: 'corr-create', changed: [] }),
    deleteRelation: vi.fn().mockResolvedValue({ entityType: 'relation', entityId: 'relation-cycle-a-b', entityVersion: 3, correlationId: 'corr-delete', changed: [] }),
  }
}

function mount(client: TopologyClient, path = '/ops/topology?ciId=ci-cycle-a&mode=dependencies&depth=3', canWriteRelations = false) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[path]}><TopologyRoute client={client} makeQueryKey={(family, scope, filters) => ['session-test', 1, 1, family, scope, filters]} canWriteRelations={canWriteRelations} /></MemoryRouter></QueryClientProvider>)
}

afterEach(cleanup)

describe('TopologyRoute', () => {
  it('renders a cycle once, announces truncation and provides a keyboard-operable table alternative', async () => {
    const client = clientFor(cycle)
    mount(client)

    expect(await screen.findByRole('heading', { name: '依賴圖' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('結果已截斷')
    expect(screen.getByText('2 個可見節點 · 2 條可見關係 · 已探索 3 hop')).toBeVisible()
    const nodeList = screen.getByRole('list', { name: '可見拓撲節點' })
    expect(within(nodeList).getAllByRole('listitem')).toHaveLength(2)
    const table = screen.getByRole('table', { name: '目前拓撲中的可見配置關係' })
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(within(table).queryByText('relation-cycle-a-b')).not.toBeInTheDocument()
    expect(screen.queryByText('ci-data-hidden')).not.toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: /Cycle A · ci-cycle-a/ })
    expect(links[0]).toHaveAttribute('href', '/ops/cmdb/ci-cycle-a')
    links[0].focus()
    expect(links[0]).toHaveFocus()
    expect(client.getTopology).toHaveBeenCalledWith({ ciId: 'ci-cycle-a', mode: 'dependencies', depth: 3 })
  })

  it('uses the same non-disclosing state for missing and out-of-scope roots', async () => {
    const error = Object.assign(new Error('not found'), { status: 404, code: 'NOT_FOUND', requestId: 'request-scope' })
    mount(clientFor(error), '/ops/topology?ciId=ci-data-hidden&mode=impact&depth=1')

    expect(await screen.findByRole('heading', { name: '找不到可見的根節點' })).toBeVisible()
    expect(screen.getByText(/不存在或不在目前授權範圍/)).toBeVisible()
    expect(screen.queryByText('Data')).not.toBeInTheDocument()
  })

  it('keeps a successful empty environment result distinct from loading and unknown', async () => {
    mount(clientFor({ nodes: [], edges: [], truncated: false, depthReached: 0 }), '/ops/topology?environmentId=env-empty&mode=dependencies&depth=2')

    expect(await screen.findByRole('heading', { name: '目前範圍沒有可顯示的節點' })).toBeVisible()
    expect(screen.getByText(/查詢已成功/)).toBeVisible()
    expect(screen.queryByText('正在讀取授權範圍內的拓撲…')).not.toBeInTheDocument()
  })

  it('submits visible endpoint versions for a relation and refreshes committed data', async () => {
    const client = clientFor(cycle)
    mount(client, '/ops/topology?ciId=ci-cycle-a&mode=dependencies&depth=3', true)
    await screen.findByRole('heading', { name: '關係管理' })

    fireEvent.change(screen.getByLabelText('建立原因'), { target: { value: 'operator verified' } })
    fireEvent.click(screen.getByRole('button', { name: '建立關係' }))

    await waitFor(() => expect(client.createRelation).toHaveBeenCalledWith({
      sourceCiId: 'ci-cycle-a', targetCiId: 'ci-cycle-b', sourceExpectedVersion: 2, targetExpectedVersion: 4,
      type: 'depends_on', reason: 'operator verified',
    }))
    expect(await screen.findByText('關係已提交並寫入稽核。')).toBeVisible()
    expect(client.getTopology).toHaveBeenCalledTimes(2)
  })
})
