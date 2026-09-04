package com.example.deck.service;

import com.example.deck.model.Post;
import com.example.deck.model.ValidatedImage;
import com.example.deck.repository.PostImageRepository;
import com.example.deck.repository.PostRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Owns the short database transaction for creating a post together with its
 * single image metadata row. This bean, not a self-invocation, is what gets
 * proxied for {@link Transactional}; callers keep file I/O outside the
 * transaction so validation and storage always finish before any DB work.
 */
@Service
public class PostImagePersistenceService {

    private final PostRepository postRepository;
    private final PostImageRepository postImageRepository;
    private final AbuseSignalRecorder signalRecorder;

    public PostImagePersistenceService(
            PostRepository postRepository,
            PostImageRepository postImageRepository,
            AbuseSignalRecorder signalRecorder) {
        this.postRepository = postRepository;
        this.postImageRepository = postImageRepository;
        this.signalRecorder = signalRecorder;
    }

    @Transactional
    public Post createOwnedWithImage(
            long accountId,
            String content,
            String channel,
            String storageKey,
            ValidatedImage validated,
            String ipHmac) {
        Post post = postRepository.insertOwned(accountId, content, channel);
        postImageRepository.insert(
                post.id(),
                storageKey,
                validated.contentType(),
                validated.byteSize(),
                validated.width(),
                validated.height(),
                validated.sha256());
        signalRecorder.recordPostCreated(accountId, post.id(), ipHmac);
        return postRepository
                .findById(post.id())
                .orElseThrow(
                        () -> new IllegalStateException("Failed to reload post with image metadata"));
    }
}
