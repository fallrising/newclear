package com.example.deck.service;

import com.example.deck.error.ApiErrorCode;
import com.example.deck.error.ApiException;
import com.example.deck.model.LikeState;
import com.example.deck.model.NotificationType;
import com.example.deck.repository.NotificationRepository;
import com.example.deck.repository.PostLikeRepository;
import com.example.deck.repository.PostRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PostLikeService {

    private final PostRepository postRepository;
    private final PostLikeRepository postLikeRepository;
    private final NotificationRepository notificationRepository;

    public PostLikeService(
            PostRepository postRepository,
            PostLikeRepository postLikeRepository,
            NotificationRepository notificationRepository) {
        this.postRepository = postRepository;
        this.postLikeRepository = postLikeRepository;
        this.notificationRepository = notificationRepository;
    }

    @Transactional
    public LikeState like(long postId, long accountId) {
        validatePost(postId);
        if (postLikeRepository.like(postId, accountId)) {
            emitLikeNotification(postId, accountId);
        }
        return postLikeRepository.getState(postId, accountId);
    }

    private void emitLikeNotification(long postId, long accountId) {
        postRepository
                .findAuthorAccountId(postId)
                .filter(ownerId -> ownerId != accountId)
                .ifPresent(ownerId -> notificationRepository.insertAndPrune(
                        ownerId, accountId, postId, null, NotificationType.LIKE));
    }

    @Transactional
    public LikeState unlike(long postId, long accountId) {
        validatePost(postId);
        postLikeRepository.unlike(postId, accountId);
        return postLikeRepository.getState(postId, accountId);
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
