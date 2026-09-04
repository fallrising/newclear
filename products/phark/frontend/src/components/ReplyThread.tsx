import { useRef, useState, type FormEvent } from "react"
import { ChevronDown, ChevronUp, MessageCircle, Send } from "lucide-react"

import { createReply, fetchReplies, getApiErrorMessage } from "@/api/posts"
import type { AccountProfile } from "@/api/accounts"
import { AuthorLink } from "@/components/AuthorLink"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ReportControl } from "@/components/ReportControl"
import type { Reply } from "@/types/post"

interface ReplyThreadProps {
  postId: number
  replyCount: number
  sessionAccount: AccountProfile | null
  onAuthRequest: () => void
  onNavigateProfile: (handle: string) => void
  onReplyCreated: (postId: number) => void
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

function mergeReplies(current: Reply[], incoming: Reply[]): Reply[] {
  const repliesById = new Map(current.map((reply) => [reply.id, reply]))
  incoming.forEach((reply) => repliesById.set(reply.id, reply))
  return [...repliesById.values()].sort((left, right) => {
    const timestampOrder = left.createdAt.localeCompare(right.createdAt)
    return timestampOrder === 0 ? left.id - right.id : timestampOrder
  })
}

export function ReplyThread({
  postId,
  replyCount,
  sessionAccount,
  onAuthRequest,
  onNavigateProfile,
  onReplyCreated,
}: ReplyThreadProps) {
  const [expanded, setExpanded] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [items, setItems] = useState<Reply[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [content, setContent] = useState("")
  const [error, setError] = useState<string | null>(null)
  const loadingPage = useRef(false)
  const submittingReply = useRef(false)
  const threadId = `reply-thread-${postId}`

  async function loadPage(after?: string) {
    if (loadingPage.current) {
      return
    }

    loadingPage.current = true
    setError(null)
    if (after) {
      setLoadingMore(true)
    } else {
      setLoading(true)
    }

    try {
      const page = await fetchReplies(postId, { after })
      setItems((current) => mergeReplies(current, page.items))
      setNextCursor(page.nextCursor)
      setLoaded(true)
    } catch (error) {
      setError(getApiErrorMessage(error, "Unable to load replies. Please try again."))
    } finally {
      loadingPage.current = false
      setLoading(false)
      setLoadingMore(false)
    }
  }

  function handleToggle() {
    const shouldExpand = !expanded
    setExpanded(shouldExpand)
    if (shouldExpand && !loaded) {
      void loadPage()
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingReply.current) {
      return
    }

    const trimmedContent = content.trim()
    if (sessionAccount === null) {
      setError("Sign in before publishing a reply.")
      return
    }
    if (!trimmedContent) {
      setError("Reply content is required.")
      return
    }

    submittingReply.current = true
    setSubmitting(true)
    setError(null)
    try {
      const reply = await createReply(postId, {
        content: trimmedContent,
      })
      setItems((current) => mergeReplies(current, [reply]))
      setContent("")
      onReplyCreated(postId)
    } catch (error) {
      setError(getApiErrorMessage(error, "Unable to publish reply. Please try again."))
    } finally {
      submittingReply.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="border-t border-border/70 pt-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full justify-between"
        aria-expanded={expanded}
        aria-controls={threadId}
        onClick={handleToggle}
      >
        <span className="flex items-center gap-2">
          <MessageCircle className="size-4" />
          {replyCount} {replyCount === 1 ? "reply" : "replies"}
        </span>
        {expanded ? (
          <ChevronUp className="size-4" />
        ) : (
          <ChevronDown className="size-4" />
        )}
      </Button>

      {expanded ? (
        <div id={threadId} className="mt-3 space-y-3">
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading replies...</p>
          ) : loaded && items.length === 0 ? (
            <p className="text-xs text-muted-foreground">No replies yet.</p>
          ) : items.length > 0 ? (
            <ol className="space-y-2">
              {items.map((reply) => (
                <li
                  key={reply.id}
                  className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <AuthorLink
                      author={reply.author}
                      handle={reply.authorHandle}
                      className="text-xs font-medium hover:text-primary hover:underline"
                      onNavigateProfile={onNavigateProfile}
                    />
                    <time
                      dateTime={reply.createdAt}
                      className="text-[0.65rem] text-muted-foreground"
                    >
                      {formatTimestamp(reply.createdAt)}
                    </time>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed">
                    {reply.content}
                  </p>
                  <div className="mt-2">
                    <ReportControl
                      targetType="REPLY"
                      targetId={reply.id}
                      sessionAccount={sessionAccount}
                      onAuthRequest={onAuthRequest}
                    />
                  </div>
                </li>
              ))}
            </ol>
          ) : null}

          {nextCursor ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              disabled={loadingMore}
              onClick={() => void loadPage(nextCursor)}
            >
              {loadingMore ? "Loading..." : "Load more replies"}
            </Button>
          ) : null}

          {sessionAccount === null ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">
                Sign in to reply with a verified identity.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onAuthRequest}
              >
                Sign in
              </Button>
            </div>
          ) : (
            <form className="space-y-2" onSubmit={handleSubmit}>
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={`${threadId}-content`} className="text-xs">
                    Reply
                  </Label>
                  <span className="text-[0.65rem] text-muted-foreground">
                    As {sessionAccount.displayName} (@{sessionAccount.handle})
                  </span>
                </div>
                <Textarea
                  id={`${threadId}-content`}
                  value={content}
                  maxLength={500}
                  rows={2}
                  className="min-h-16"
                  placeholder="Join the conversation"
                  onChange={(event) => setContent(event.target.value)}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[0.65rem] text-muted-foreground">
                  {content.length}/500
                </span>
                <Button type="submit" size="sm" disabled={submitting}>
                  <Send className="size-3.5" />
                  {submitting ? "Replying..." : "Reply"}
                </Button>
              </div>
            </form>
          )}

          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
