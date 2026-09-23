import { z } from 'zod'
import { navigationItemSchema, notificationSchema, type Center } from '../../domain/schema-models'
import type { ApiRequest } from '../core/request'

/** Only the two feature reads needed by every initial workspace shell. */
export function createShellClient(request: ApiRequest) {
  return {
    getNavigation: (center: Center) => request(`/navigation?${new URLSearchParams({ center })}`, z.array(navigationItemSchema)),
    getNotifications: () => request('/notifications', z.strictObject({ items: z.array(notificationSchema).max(20) })),
  }
}
