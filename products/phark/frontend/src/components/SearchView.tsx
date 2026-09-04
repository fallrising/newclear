import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react"
import { ArrowLeft, Search } from "lucide-react"

import type { AccountProfile } from "@/api/accounts"
import { getApiErrorMessage } from "@/api/client"
import { fetchSearch } from "@/api/search"
import {
  likePost,
  repostPost,
  unlikePost,
  unrepostPost,
} from "@/api/posts"
import { PostCard } from "@/components/PostCard"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  applyLikeStateToPosts,
  optimisticLikeState,
  snapshotLikeState,
} from "@/lib/postLikes"
import {
  applyRepostStateToPosts,
  optimisticRepostState,
  snapshotRepostState,
} from "@/lib/postReposts"
import type { Post } from "@/types/post"

const DEFAULT_LIMIT = 20

interface SearchViewProps {
  query: string
  sessionAccount: AccountProfile | null
  securityReady: boolean | null
  onSubmitQuery: (query: string) => void
  onBack: () => void
  onAuthRequest: () => void
  onNavigateProfile: (handle: string) => void
}

export function SearchView({
  query,
  sessionAccount,
  securityReady,
  onSubmitQuery,
  onBack,
  onAuthRequest,
  onNavigateProfile,
}: SearchViewProps) {
  const trimmedQuery = query.trim()
  const [draftQuery, setDraftQuery] = useState(query)
  const [posts, setPosts] = useState<Post[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [pendingLikeIds, setPendingLikeIds] = useState<Set<number>>(new Set())
  const [likeErrors, setLikeErrors] = useState<Record<number, string>>({})
  const [pendingRepostIds, setPendingRepostIds] = useState<Set<number>>(new Set())
  const [repostErrors, setRepostErrors] = useState<Record<number, string>>({})
  const requestVersion = useRef(0)
  const loadingMoreRef = useRef(false)
  const postMutations = useRef(new Set<number>())
  const sessionAccountRef = useRef<AccountProfile | null>(sessionAccount)

  useEffect(() => {
    sessionAccountRef.current = sessionAccount
  })

  useEffect(() => {
    setDraftQuery(query)
  }, [query])

  const runSearch = useCallback(async () => {
    const requestedAccount = sessionAccount
    const isCurrentGeneration = (
      version: number,
      account: AccountProfile | null
    ) => version === requestVersion.current && account === sessionAccountRef.current

    if (trimmedQuery === "") {
      requestVersion.current += 1
      loadingMoreRef.current = false
      setLoading(false)
      setLoadingMore(false)
      setPosts([])
      setNextCursor(null)
      setError(null)
      setLikeErrors({})
      setRepostErrors({})
      return
    }

    const version = ++requestVersion.current
    loadingMoreRef.current = false
    setLoading(true)
    setLoadingMore(false)
    setPosts([])
    setNextCursor(null)
    setError(null)
    setLikeErrors({})
    setRepostErrors({})

    try {
      const page = await fetchSearch(query, { limit: DEFAULT_LIMIT })
      if (!isCurrentGeneration(version, requestedAccount)) return

      setPosts(page.items)
      setNextCursor(page.nextCursor)
    } catch (error) {
      if (isCurrentGeneration(version, requestedAccount)) {
        setError(getApiErrorMessage(error, "Unable to run this search."))
      }
    } finally {
      if (isCurrentGeneration(version, requestedAccount)) {
        setLoading(false)
      }
    }
  }, [query, sessionAccount, trimmedQuery])

  useEffect(() => {
    void runSearch()
    return () => {
      requestVersion.current += 1
    }
  }, [runSearch, attempt])

  async function loadMore() {
    if (nextCursor === null || loadingMoreRef.current) return

    const version = requestVersion.current
    const before = nextCursor
    loadingMoreRef.current = true
    setLoadingMore(true)
    setError(null)

    try {
      const page = await fetchSearch(query, { before, limit: DEFAULT_LIMIT })
      if (version !== requestVersion.current) return

      setPosts((current) => {
        const knownIds = new Set(current.map((post) => post.id))
        return [
          ...current,
          ...page.items.filter((post) => !knownIds.has(post.id)),
        ]
      })
      setNextCursor(page.nextCursor)
    } catch (error) {
      if (version === requestVersion.current) {
        setError(getApiErrorMessage(error, "Unable to load more results."))
      }
    } finally {
      if (version === requestVersion.current) {
        loadingMoreRef.current = false
        setLoadingMore(false)
      }
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextQuery = draftQuery.trim()
    if (nextQuery === "") return
    if (nextQuery === trimmedQuery) {
      setAttempt((current) => current + 1)
      return
    }
    onSubmitQuery(nextQuery)
  }

  function handleReplyCreated(postId: number) {
    setPosts((current) =>
      current.map((post) =>
        post.id === postId
          ? { ...post, replyCount: post.replyCount + 1 }
          : post
      )
    )
  }

  async function handleToggleLike(post: Post) {
    if (sessionAccount === null) {
      setLikeErrors((current) => ({
        ...current,
        [post.id]: "Sign in to like this post.",
      }))
      onAuthRequest()
      return
    }
    if (securityReady !== true) {
      setLikeErrors((current) => ({
        ...current,
        [post.id]:
          securityReady === null
            ? "Secure actions are still initializing."
            : "Secure actions are unavailable. Retry account security setup.",
      }))
      return
    }
    if (postMutations.current.has(post.id)) return

    const snapshot = snapshotLikeState(post)
    const optimistic = optimisticLikeState(snapshot)
    const version = requestVersion.current
    postMutations.current.add(post.id)
    setPendingLikeIds((current) => new Set(current).add(post.id))
    setLikeErrors((current) => {
      const next = { ...current }
      delete next[post.id]
      return next
    })
    setPosts((current) => applyLikeStateToPosts(current, optimistic))

    try {
      const state = snapshot.likedByViewer
        ? await unlikePost(post.id)
        : await likePost(post.id)
      if (version === requestVersion.current) {
        setPosts((current) => applyLikeStateToPosts(current, state))
      }
    } catch (error) {
      if (version === requestVersion.current) {
        setPosts((current) => applyLikeStateToPosts(current, snapshot))
        setLikeErrors((current) => ({
          ...current,
          [post.id]: getApiErrorMessage(
            error,
            "Unable to update this like. Please try again."
          ),
        }))
      }
    } finally {
      postMutations.current.delete(post.id)
      setPendingLikeIds((current) => {
        const next = new Set(current)
        next.delete(post.id)
        return next
      })
    }
  }

  async function handleToggleRepost(post: Post) {
    if (sessionAccount === null) {
      setRepostErrors((current) => ({
        ...current,
        [post.id]: "Sign in to repost this post.",
      }))
      onAuthRequest()
      return
    }
    if (securityReady !== true) {
      setRepostErrors((current) => ({
        ...current,
        [post.id]:
          securityReady === null
            ? "Secure actions are still initializing."
            : "Secure actions are unavailable. Retry account security setup.",
      }))
      return
    }
    if (postMutations.current.has(post.id)) return

    const snapshot = snapshotRepostState(post)
    const optimistic = optimisticRepostState(snapshot)
    const version = requestVersion.current
    postMutations.current.add(post.id)
    setPendingRepostIds((current) => new Set(current).add(post.id))
    setRepostErrors((current) => {
      const next = { ...current }
      delete next[post.id]
      return next
    })
    setPosts((current) => applyRepostStateToPosts(current, optimistic))

    try {
      const state = snapshot.repostedByViewer
        ? await unrepostPost(post.id)
        : await repostPost(post.id)
      if (version === requestVersion.current) {
        setPosts((current) => applyRepostStateToPosts(current, state))
      }
    } catch (error) {
      if (version === requestVersion.current) {
        setPosts((current) => applyRepostStateToPosts(current, snapshot))
        setRepostErrors((current) => ({
          ...current,
          [post.id]: getApiErrorMessage(
            error,
            "Unable to update this repost. Please try again."
          ),
        }))
      }
    } finally {
      postMutations.current.delete(post.id)
      setPendingRepostIds((current) => {
        const next = new Set(current)
        next.delete(post.id)
        return next
      })
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6">
      <Button type="button" variant="outline" size="sm" onClick={onBack}>
        <ArrowLeft className="size-4" />
        Back to timeline
      </Button>

      <h1 className="mt-4 flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <Search className="size-5" />
        Search
      </h1>

      <form className="mt-4" role="search" onSubmit={handleSubmit}>
        <Label htmlFor="search-query">Search posts</Label>
        <div className="mt-2 flex gap-2">
          <Input
            id="search-query"
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.target.value)}
            placeholder="Search posts"
            className="flex-1"
          />
          <Button type="submit" disabled={draftQuery.trim() === ""}>
            Search
          </Button>
        </div>
      </form>

      {trimmedQuery === "" ? (
        <Card className="mt-4">
          <CardContent className="p-4 text-sm text-muted-foreground">
            Enter a query to search posts.
          </CardContent>
        </Card>
      ) : null}

      {trimmedQuery !== "" && loading ? (
        <p className="mt-4 text-sm text-muted-foreground">Searching posts...</p>
      ) : null}

      {trimmedQuery !== "" && error ? (
        <div className="mt-4">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => setAttempt((current) => current + 1)}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {trimmedQuery !== "" && !loading && !error && posts.length === 0 ? (
        <Card className="mt-4">
          <CardContent className="p-4 text-sm text-muted-foreground">
            No posts matched your search.
          </CardContent>
        </Card>
      ) : null}

      {trimmedQuery !== "" && !loading && posts.length > 0 ? (
        <section className="mt-6 space-y-4">
          {posts.map((post) => (
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
              onReplyCreated={handleReplyCreated}
              onToggleLike={handleToggleLike}
              onToggleRepost={handleToggleRepost}
            />
          ))}
        </section>
      ) : null}

      {trimmedQuery !== "" && !loading && nextCursor !== null ? (
        <Button
          type="button"
          variant="outline"
          className="mt-4 w-full"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? "Loading..." : "Load more results"}
        </Button>
      ) : null}
    </main>
  )
}
