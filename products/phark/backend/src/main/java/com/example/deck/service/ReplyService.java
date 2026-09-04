package com.example.deck.service;

import com.example.deck.dto.CreateReplyRequest;
import com.example.deck.error.ApiErrorCode;
import com.example.deck.error.ApiException;
import com.example.deck.model.NotificationType;
import com.example.deck.model.PostCursor;
import com.example.deck.model.Reply;
import com.example.deck.model.ReplyPage;
import com.example.deck.repository.NotificationRepository;
import com.example.deck.repository.PostRepository;
import com.example.deck.repository.ReplyRepository;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ReplyService {

    private final PostRepository postRepository;
    private final ReplyRepository replyRepository;
    private final PostCursorCodec cursorCodec;
    private final NotificationRepository notificationRepository;
    private final AbuseSignalRecorder signalRecorder;

    public ReplyService(
            PostRepository postRepository,
            ReplyRepository replyRepository,
            PostCursorCodec cursorCodec,
            NotificationRepository notificationRepository,
            AbuseSignalRecorder signalRecorder) {
        this.postRepository = postRepository;
        this.replyRepository = replyRepository;
        this.cursorCodec = cursorCodec;
        this.notificationRepository = notificationRepository;
        this.signalRecorder = signalRecorder;
    }

    public ReplyPage getReplies(long postId, int limit, String after) {
        validatePost(postId);
        validateLimit(limit);

        PostCursor afterCursor = null;
        if (after != null) {
            try {
                afterCursor = cursorCodec.decode(after);
            } catch (IllegalArgumentException exception) {
                throw new ApiException(ApiErrorCode.INVALID_CURSOR, exception);
            }
        }

        List<Reply> fetchedItems = replyRepository.findPage(postId, limit + 1, afterCursor);
        boolean hasMore = fetchedItems.size() > limit;
        List<Reply> items = hasMore
                ? List.copyOf(fetchedItems.subList(0, limit))
                : List.copyOf(fetchedItems);
        String nextCursor = hasMore
                ? cursorCodec.encode(toCursor(items.get(items.size() - 1)))
                : null;

        return new ReplyPage(items, nextCursor);
    }

    @Transactional
    public Reply createReply(
            long postId,
            long accountId,
            CreateReplyRequest request,
            String ipHmac) {
        validatePost(postId);
        Reply reply = replyRepository.insertOwned(postId, accountId, request.content().trim());
        emitReplyNotification(postId, accountId, reply);
        signalRecorder.recordReplyCreated(accountId, reply.id(), ipHmac);
        return reply;
    }

    private void emitReplyNotification(long postId, long accountId, Reply reply) {
        postRepository
                .findAuthorAccountId(postId)
                .filter(ownerId -> ownerId != accountId)
                .ifPresent(ownerId -> notificationRepository.insertAndPrune(
                        ownerId, accountId, postId, reply.id(), NotificationType.REPLY));
    }

    private void validatePost(long postId) {
        if (postId <= 0) {
            throw new ApiException(ApiErrorCode.INVALID_POST_ID);
        }
        if (!postRepository.existsById(postId)) {
            throw new ApiException(ApiErrorCode.POST_NOT_FOUND);
        }
    }

    private void validateLimit(int limit) {
        if (limit < 1 || limit > 100) {
            throw new ApiException(ApiErrorCode.INVALID_LIMIT);
        }
    }

    private PostCursor toCursor(Reply reply) {
        return new PostCursor(reply.createdAt(), reply.id());
    }
}
