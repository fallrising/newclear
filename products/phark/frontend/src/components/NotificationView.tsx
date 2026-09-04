import { ArrowLeft, Bell, Check } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { NotificationItem, NotificationType } from "@/types/notification"

interface NotificationViewProps {
  authenticated: boolean
  items: readonly NotificationItem[]
  latestCursor: string | null
  unreadCount: number
  loading: boolean
  loadingMore: boolean
  markingRead: boolean
  error: string | null
  onBack: () => void
  onAuthRequest: () => void
  onNavigateProfile: (handle: string) => void
  onLoadMore: (() => void) | null
  onMarkAllRead: () => void
}

function attributionText(type: NotificationType): string {
  switch (type) {
    case "REPLY":
      return "replied to your post"
    case "LIKE":
      return "liked your post"
    case "REPOST":
      return "reposted your post"
  }
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

export function NotificationView({
  authenticated,
  items,
  latestCursor,
  unreadCount,
  loading,
  loadingMore,
  markingRead,
  error,
  onBack,
  onAuthRequest,
  onNavigateProfile,
  onLoadMore,
  onMarkAllRead,
}: NotificationViewProps) {
  const markAllReadDisabled =
    latestCursor === null || unreadCount === 0 || markingRead

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6">
      <Button type="button" variant="outline" size="sm" onClick={onBack}>
        <ArrowLeft className="size-4" />
        Back to timeline
      </Button>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Bell className="size-5" />
          Notifications
        </h1>
        {authenticated ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={markAllReadDisabled}
            onClick={onMarkAllRead}
          >
            <Check className="size-3.5" />
            {markingRead ? "Marking all read..." : "Mark all read"}
          </Button>
        ) : null}
      </div>

      {!authenticated ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Sign in to view notifications</CardTitle>
            <CardDescription>
              Your notifications are waiting for you once you sign in.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" onClick={onAuthRequest}>
              Sign in
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {authenticated && loading ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Loading notifications...
        </p>
      ) : null}

      {authenticated && !loading && items.length === 0 ? (
        <Card className="mt-4">
          <CardContent className="p-4 text-sm text-muted-foreground">
            No notifications yet.
          </CardContent>
        </Card>
      ) : null}

      {authenticated && !loading ? (
        <section className="mt-4 space-y-3">
          {items.map((item) => (
            <Card
              key={item.id}
              className={cn("border-border/70", !item.read && "bg-primary/5")}
            >
              <CardHeader className="flex-row items-center justify-between gap-2 p-4 pb-0">
                <p className="text-sm">
                  <button
                    type="button"
                    className="font-semibold text-primary hover:underline"
                    onClick={() => onNavigateProfile(item.actorHandle)}
                  >
                    {item.actor}
                  </button>{" "}
                  {attributionText(item.type)}
                </p>
                <span
                  className={cn(
                    "shrink-0 text-xs font-medium",
                    item.read
                      ? "text-muted-foreground"
                      : "text-primary"
                  )}
                >
                  {item.read ? "Read" : "Unread"}
                </span>
              </CardHeader>
              <CardContent className="p-4">
                <p className="whitespace-pre-wrap text-sm">{item.postContent}</p>
                {item.replyContent !== null ? (
                  <p className="mt-2 whitespace-pre-wrap border-l-2 border-border/70 pl-3 text-sm text-muted-foreground">
                    {item.replyContent}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  {formatTimestamp(item.createdAt)}
                </p>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}

      {authenticated && !loading && onLoadMore !== null ? (
        <Button
          type="button"
          variant="outline"
          className="mt-4 w-full"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? "Loading..." : "Load more notifications"}
        </Button>
      ) : null}
    </main>
  )
}
