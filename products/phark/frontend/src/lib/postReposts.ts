import type { Post, RepostState } from "@/types/post"

export function snapshotRepostState(post: Post): RepostState {
  return {
    postId: post.id,
    repostCount: post.repostCount,
    repostedByViewer: post.repostedByViewer,
  }
}

export function optimisticRepostState(state: RepostState): RepostState {
  return {
    postId: state.postId,
    repostCount: state.repostedByViewer
      ? Math.max(0, state.repostCount - 1)
      : state.repostCount + 1,
    repostedByViewer: !state.repostedByViewer,
  }
}

export function applyRepostStateToPost(post: Post, state: RepostState): Post {
  if (post.id !== state.postId) return post
  return {
    ...post,
    repostCount: state.repostCount,
    repostedByViewer: state.repostedByViewer,
  }
}

export function applyRepostStateToPosts(posts: Post[], state: RepostState): Post[] {
  return posts.map((post) => applyRepostStateToPost(post, state))
}
