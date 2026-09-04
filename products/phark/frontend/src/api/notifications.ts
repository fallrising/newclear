import { apiRequest } from "@/api/client"
import type {
  NotificationPage,
  NotificationReadState,
} from "@/types/notification"

export type FetchNotificationsOptions = {
  readonly before?: string
  readonly limit?: number
}

export async function fetchNotifications({
  before,
  limit = 20,
}: FetchNotificationsOptions = {}): Promise<NotificationPage> {
  const params = new URLSearchParams({ limit: limit.toString() })
  if (before) params.set("before", before)

  return apiRequest<NotificationPage>(`/api/notifications?${params.toString()}`)
}

export function markNotificationsRead(
  through: string
): Promise<NotificationReadState> {
  return apiRequest<NotificationReadState>("/api/notifications/read", {
    method: "PUT",
    body: { through },
  })
}
