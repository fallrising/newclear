package com.example.deck.service;

import com.example.deck.error.ApiErrorCode;
import com.example.deck.error.ApiException;
import com.example.deck.model.NotificationType;
import com.example.deck.model.RepostState;
import com.example.deck.repository.NotificationRepository;
import com.example.deck.repository.PostRepository;
import com.example.deck.repository.PostRepostRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PostRepostService {

    private final PostRepository postRepository;
    private final PostRepostRepository postRepostRepository;
    private final NotificationRepository notificationRepository;

    public PostRepostService(
            PostRepository postRepository,
            PostRepostRepository postRepostRepository,
            NotificationRepository notificationRepository) {
        this.postRepository = postRepository;
        this.postRepostRepository = postRepostRepository;
        this.notificationRepository = notificationRepository;
    }

    @Transactional
    public RepostState repost(long postId, long accountId) {
        validatePost(postId);
        if (postRepostRepository.repost(postId, accountId)) {
            emitRepostNotification(postId, accountId);
        }
        return postRepostRepository.getState(postId, accountId);
    }

    private void emitRepostNotification(long postId, long accountId) {
        postRepository
                .findAuthorAccountId(postId)
                .filter(ownerId -> ownerId != accountId)
                .ifPresent(ownerId -> notificationRepository.insertAndPrune(
                        ownerId, accountId, postId, null, NotificationType.REPOST));
    }

    @Transactional
    public RepostState unrepost(long postId, long accountId) {
        validatePost(postId);
        postRepostRepository.unrepost(postId, accountId);
        return postRepostRepository.getState(postId, accountId);
    }

    private void validatePost(long postId) {
        if (postId <= 0) {
            throw new ApiException(ApiErrorCode.INVALID_POST_ID);
        }
        if (!postRepository.existsById(postId)) {
            throw new ApiException(ApiErrorCode.POST_NOT_FOUND);
        }
    }
}
