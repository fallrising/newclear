import { applicationSchema, pageSchema, type Release, type Application, type Environment, type Page, type Placement } from '../../domain/schemas'
import { applicationDetailSchema, environmentDetailSchema } from '../wire-views'
import type { ApiRequest } from '../core/request'

export type ApplicationDetail = { application: Application; environments: Environment[] }
export type EnvironmentDetail = { environment: Environment; placements: Placement[]; activeRelease: Release | null }

export type ApplicationListInput = {
  projectId?: string
  q?: string
  page?: number
  pageSize?: number
  sort?: 'id' | 'name' | 'updatedAt'
  order?: 'asc' | 'desc'
}

const applicationPageSchema = pageSchema(applicationSchema)

function applicationListPath(input: ApplicationListInput = {}) {
  const query = new URLSearchParams()
  if (input.projectId) query.set('projectId', input.projectId)
  if (input.q) query.set('q', input.q)
  if (input.page !== undefined) query.set('page', String(input.page))
  if (input.pageSize !== undefined) query.set('pageSize', String(input.pageSize))
  if (input.sort) query.set('sort', input.sort)
  if (input.order) query.set('order', input.order)
  const suffix = query.toString()
  return `/applications${suffix ? `?${suffix}` : ''}`
}

export function createApplicationClient(request: ApiRequest) {
  return {
    listApplications: (input: ApplicationListInput = {}): Promise<Page<Application>> =>
      request(applicationListPath(input), applicationPageSchema),
    getApplication: (applicationId: string): Promise<ApplicationDetail> =>
      request(`/applications/${encodeURIComponent(applicationId)}`, applicationDetailSchema),
    getEnvironment: (environmentId: string): Promise<EnvironmentDetail> =>
      request(`/environments/${encodeURIComponent(environmentId)}`, environmentDetailSchema),
  }
}

export type ApplicationClient = ReturnType<typeof createApplicationClient>
