import type { AccountProfile } from "@/api/accounts"
import { PostCard } from "@/components/PostCard"
import { Button } from "@/components/ui/button"
import type { Channel, Post } from "@/types/post"

const CHANNEL_LABELS: Record<Channel, string> = {
  home: "Home",
  tech: "Tech",
  ops: "Ops",
}

interface ColumnProps {
  channel: Channel
  posts: Post[]
  sessionAccount: AccountProfile | null
  pendingLikeIds: ReadonlySet<number>
  likeErrors: Readonly<Record<number, string>>
  pendingRepostIds: ReadonlySet<number>
  repostErrors: Readonly<Record<number, string>>
  hasMore: boolean
  loadingMore: boolean
  error: string | null
  onLoadMore: () => void
  onAuthRequest: () => void
  onNavigateProfile: (handle: string) => void
  onReplyCreated: (postId: number) => void
  onToggleLike: (post: Post) => Promise<void>
  onToggleRepost: (post: Post) => Promise<void>
}

export function Column({
  channel,
  posts,
  sessionAccount,
  pendingLikeIds,
  likeErrors,
  pendingRepostIds,
  repostErrors,
  hasMore,
  loadingMore,
  error,
  onLoadMore,
  onAuthRequest,
  onNavigateProfile,
  onReplyCreated,
  onToggleLike,
  onToggleRepost,
}: ColumnProps) {
  return (
    <section className="flex h-full min-w-[280px] flex-1 flex-col rounded-2xl border border-border/70 bg-muted/30 md:min-w-0">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-muted/60 px-4 py-3 backdrop-blur">
        <h2 className="text-sm font-semibold tracking-wide text-foreground">
          {CHANNEL_LABELS[channel]}
        </h2>
        <p className="text-xs text-muted-foreground">{posts.length} loaded</p>
      </header>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {posts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No posts yet.</p>
        ) : (
          posts.map((post) => (
            <PostCard
              key={post.timelineEntryId}
              post={post}
              sessionAccount={sessionAccount}
              likePending={pendingLikeIds.has(post.id)}
              likeError={likeErrors[post.id] ?? null}
              repostPending={pendingRepostIds.has(post.id)}
              repostError={repostErrors[post.id] ?? null}
              onAuthRequest={onAuthRequest}
              onNavigateProfile={onNavigateProfile}
              onReplyCreated={onReplyCreated}
              onToggleLike={onToggleLike}
              onToggleRepost={onToggleRepost}
            />
          ))
        )}
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {hasMore ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? "Loading..." : "Load more"}
          </Button>
        ) : null}
      </div>
    </section>
  )
}
