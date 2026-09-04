package com.example.deck.model;

import java.time.Instant;

public record Post(
        long id,
        String author,
        String authorHandle,
        String content,
        String channel,
        Instant createdAt,
        long replyCount,
        long likeCount,
        boolean likedByViewer,
        String timelineEntryId,
        long repostCount,
        boolean repostedByViewer,
        String repostedBy,
        String repostedByHandle,
        Instant repostedAt,
        PostImage image) {

    public Post(long id,
                String author,
                String authorHandle,
                String content,
                String channel,
                Instant createdAt,
                long replyCount,
                long likeCount,
                boolean likedByViewer,
                String timelineEntryId,
                long repostCount,
                boolean repostedByViewer,
                String repostedBy,
                String repostedByHandle,
                Instant repostedAt) {
        this(id, author, authorHandle, content, channel, createdAt, replyCount, likeCount,
                likedByViewer, timelineEntryId, repostCount, repostedByViewer, repostedBy,
                repostedByHandle, repostedAt, null);
    }
}
