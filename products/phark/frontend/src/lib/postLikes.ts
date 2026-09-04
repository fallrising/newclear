import type { LikeState, Post } from "@/types/post"

export function snapshotLikeState(post: Post): LikeState {
  return {
    postId: post.id,
    likeCount: post.likeCount,
    likedByViewer: post.likedByViewer,
  }
}

export function optimisticLikeState(state: LikeState): LikeState {
  return {
    postId: state.postId,
    likeCount: state.likedByViewer
      ? Math.max(0, state.likeCount - 1)
      : state.likeCount + 1,
    likedByViewer: !state.likedByViewer,
  }
}

export function applyLikeStateToPost(post: Post, state: LikeState): Post {
  if (post.id !== state.postId) return post
  return {
    ...post,
    likeCount: state.likeCount,
    likedByViewer: state.likedByViewer,
  }
}

export function applyLikeStateToPosts(posts: Post[], state: LikeState): Post[] {
  return posts.map((post) => applyLikeStateToPost(post, state))
}
