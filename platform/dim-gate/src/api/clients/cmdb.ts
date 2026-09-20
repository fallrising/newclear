import { dashboardViewSchema } from '../../domain/schemas'
import type { Center, DashboardView } from '../../domain/schemas'
import type { ApiRequest } from '../core/request'

export function createCmdbClient(request: ApiRequest) {
  return {
    getDashboard: (center: Center): Promise<DashboardView> => request(`/dashboard?center=${encodeURIComponent(center)}`, dashboardViewSchema),
  }
}
