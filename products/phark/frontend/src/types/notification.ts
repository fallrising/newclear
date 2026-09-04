export type NotificationType = "REPLY" | "LIKE" | "REPOST"

export interface NotificationItem {
  readonly id: number
  readonly type: NotificationType
  readonly actor: string
  readonly actorHandle: string
  readonly postId: number
  readonly postContent: string
  readonly replyId: number | null
  readonly replyContent: string | null
  readonly createdAt: string
  readonly read: boolean
}

export interface NotificationPage {
  readonly items: readonly NotificationItem[]
  readonly nextCursor: string | null
  readonly latestCursor: string | null
  readonly readThroughCursor: string | null
  readonly unreadCount: number
}

export interface NotificationReadState {
  readonly readThroughCursor: string
  readonly unreadCount: number
}
