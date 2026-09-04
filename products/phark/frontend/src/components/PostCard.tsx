import { useState } from "react"
import type { AccountProfile } from "@/api/accounts"
import { Heart, Repeat2 } from "lucide-react"
import { AuthorLink } from "@/components/AuthorLink"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ReplyThread } from "@/components/ReplyThread"
import { ReportControl } from "@/components/ReportControl"
import type { Post, PostImage } from "@/types/post"

interface PostCardProps {
  post: Post
  sessionAccount: AccountProfile | null
  likePending: boolean
  likeError: string | null
  onAuthRequest: () => void
  onNavigateProfile: (handle: string) => void
  onReplyCreated: (postId: number) => void
  onToggleLike: (post: Post) => Promise<void>
  repostPending: boolean
  repostError: string | null
  onToggleRepost: (post: Post) => Promise<void>
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

function PostImage({ image, author }: { image: PostImage; author: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  if (failedUrl === image.url) {
    return (
      <p className="rounded-lg border border-border/60 bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
        Image unavailable.
      </p>
    )
  }

  return (
    <img
      src={image.url}
      alt={`Post image by ${author}`}
      width={image.width}
      height={image.height}
      loading="lazy"
      decoding="async"
      onError={() => setFailedUrl(image.url)}
      className="h-auto max-h-96 w-full rounded-lg border border-border/60 object-contain"
    />
  )
}

export function PostCard({
  post,
  sessionAccount,
  likePending,
  likeError,
  onAuthRequest,
  onNavigateProfile,
  onReplyCreated,
  onToggleLike,
  repostPending,
  repostError,
  onToggleRepost,
}: PostCardProps) {
  const interactionBusy = likePending || repostPending

  return (
    <Card className="border-border/80 bg-card/95">
      <CardHeader>
        <CardTitle className="text-base">
          <AuthorLink
            author={post.author}
            handle={post.authorHandle}
            className="hover:text-primary hover:underline"
            onNavigateProfile={onNavigateProfile}
          />
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {formatTimestamp(post.createdAt)}
        </p>
        {post.repostedByHandle !== null &&
        post.repostedBy !== null &&
        post.repostedAt !== null ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Repeat2 className="size-3 shrink-0" />
            <AuthorLink
              author={post.repostedBy}
              handle={post.repostedByHandle}
              className="hover:text-primary hover:underline"
              onNavigateProfile={onNavigateProfile}
            />
            <span aria-hidden="true">·</span>
            <span>{formatTimestamp(post.repostedAt)}</span>
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {post.content}
        </p>
        {post.image !== null ? (
          <PostImage image={post.image} author={post.author} />
        ) : null}
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={post.likedByViewer ? "default" : "outline"}
              size="sm"
              aria-pressed={post.likedByViewer}
              aria-busy={likePending}
              disabled={interactionBusy}
              onClick={() => void onToggleLike(post)}
            >
              <Heart
                className={post.likedByViewer ? "size-4 fill-current" : "size-4"}
              />
              {post.likeCount} {post.likeCount === 1 ? "like" : "likes"}
            </Button>
            <Button
              type="button"
              variant={post.repostedByViewer ? "default" : "outline"}
              size="sm"
              aria-pressed={post.repostedByViewer}
              aria-busy={repostPending}
              disabled={interactionBusy}
              onClick={() => void onToggleRepost(post)}
            >
              <Repeat2
                className={
                  post.repostedByViewer ? "size-4 fill-current" : "size-4"
                }
              />
              {post.repostCount}{" "}
              {post.repostCount === 1 ? "repost" : "reposts"}
            </Button>
          </div>
          {likeError ? (
            <p role="alert" className="text-xs text-destructive">
              {likeError}
            </p>
          ) : null}
          {repostError ? (
            <p role="alert" className="text-xs text-destructive">
              {repostError}
            </p>
          ) : null}
        </div>
        <ReportControl
          targetType="POST"
          targetId={post.id}
          sessionAccount={sessionAccount}
          onAuthRequest={onAuthRequest}
        />
        <ReplyThread
          postId={post.id}
          replyCount={post.replyCount}
          sessionAccount={sessionAccount}
          onAuthRequest={onAuthRequest}
          onNavigateProfile={onNavigateProfile}
          onReplyCreated={onReplyCreated}
        />
      </CardContent>
    </Card>
  )
}
