package com.example.deck.service;

import com.example.deck.dto.CreatePostRequest;
import com.example.deck.error.ApiErrorCode;
import com.example.deck.error.ApiException;
import com.example.deck.model.Post;
import com.example.deck.model.PostCursor;
import com.example.deck.model.PostPage;
import com.example.deck.model.TimelinePost;
import com.example.deck.model.ValidatedImage;
import com.example.deck.repository.PostRepository;
import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class PostService {

    private static final Logger LOGGER = LoggerFactory.getLogger(PostService.class);

    private static final Set<String> VALID_CHANNELS = Set.of("home", "tech", "ops");

    private final PostRepository postRepository;
    private final PostCursorCodec cursorCodec;
    private final ImageValidator imageValidator;
    private final MediaStorage mediaStorage;
    private final PostImagePersistenceService postImagePersistenceService;
    private final AbuseSignalRecorder signalRecorder;

    public PostService(
            PostRepository postRepository,
            PostCursorCodec cursorCodec,
            ImageValidator imageValidator,
            MediaStorage mediaStorage,
            PostImagePersistenceService postImagePersistenceService,
            AbuseSignalRecorder signalRecorder) {
        this.postRepository = postRepository;
        this.cursorCodec = cursorCodec;
        this.imageValidator = imageValidator;
        this.mediaStorage = mediaStorage;
        this.postImagePersistenceService = postImagePersistenceService;
        this.signalRecorder = signalRecorder;
    }

    public PostPage getPosts(String channel, int limit, String before) {
        return getPosts(channel, limit, before, null);
    }

    public PostPage getPosts(
            String channel,
            int limit,
            String before,
            Long viewerAccountId) {
        validateChannel(channel);
        validateLimit(limit);

        PostCursor beforeCursor = decodeCursor(before);
        return toPage(
                postRepository.findTimelinePage(
                        channel, limit + 1, beforeCursor, viewerAccountId),
                limit);
    }

    public PostPage getPostsByAccountId(long accountId, int limit, String before) {
        return getPostsByAccountId(accountId, limit, before, null);
    }

    public PostPage getPostsByAccountId(
            long accountId,
            int limit,
            String before,
            Long viewerAccountId) {
        validateLimit(limit);

        PostCursor beforeCursor = decodeCursor(before);
        return toPage(
                postRepository.findTimelinePageByAccountId(
                        accountId, limit + 1, beforeCursor, viewerAccountId),
                limit);
    }

    private PostCursor decodeCursor(String before) {
        PostCursor beforeCursor = null;
        if (before != null) {
            try {
                beforeCursor = cursorCodec.decode(before);
            } catch (IllegalArgumentException exception) {
                throw new ApiException(ApiErrorCode.INVALID_CURSOR, exception);
            }
        }
        return beforeCursor;
    }

    private PostPage toPage(List<TimelinePost> fetchedItems, int limit) {
        boolean hasMore = fetchedItems.size() > limit;
        List<TimelinePost> page = hasMore
                ? List.copyOf(fetchedItems.subList(0, limit))
                : List.copyOf(fetchedItems);
        List<Post> items = page.stream().map(TimelinePost::post).toList();
        String nextCursor = hasMore
                ? cursorCodec.encode(page.get(page.size() - 1).cursor())
                : null;

        return new PostPage(items, nextCursor);
    }

    @Transactional
    public Post createPost(long accountId, CreatePostRequest request, String ipHmac) {
        Post post = postRepository.insertOwned(
                accountId, request.content().trim(), request.channel());
        signalRecorder.recordPostCreated(accountId, post.id(), ipHmac);
        return post;
    }

    /**
     * Multipart create path: validation and the single defensive byte copy land
     * in storage before any database work; the atomic post + metadata insert runs
     * in the proxied {@link PostImagePersistenceService} transaction. Any
     * transaction invocation failure triggers a compensating delete of the stored
     * bytes; a failed cleanup is logged and suppressed so it never masks the
     * primary failure.
     */
    public Post createPostWithImage(
            long accountId,
            CreatePostRequest request,
            MultipartFile image,
            String ipHmac) {
        ValidatedImage validated = validateImage(image);
        String storageKey = mediaStorage.store(validated.bytes(), validated.extension());
        try {
            return postImagePersistenceService.createOwnedWithImage(
                    accountId,
                    request.content().trim(),
                    request.channel(),
                    storageKey,
                    validated,
                    ipHmac);
        } catch (RuntimeException failure) {
            compensate(storageKey, failure);
            throw failure;
        }
    }

    private ValidatedImage validateImage(MultipartFile image) {
        try (InputStream input = image.getInputStream()) {
            return imageValidator.validate(image.getContentType(), input);
        } catch (IOException exception) {
            throw new InvalidImageException();
        }
    }

    private void compensate(String storageKey, RuntimeException failure) {
        try {
            mediaStorage.delete(storageKey);
        } catch (RuntimeException cleanupFailure) {
            LOGGER.warn("Failed to clean up stored media after create failure", cleanupFailure);
            failure.addSuppressed(cleanupFailure);
        }
    }

    @PostConstruct
    public void seedData() {
        if (postRepository.count() > 0) {
            return;
        }

        postRepository.insertSeed("Alice", "Welcome to Stream Deck! This is the home feed.", "home");
        postRepository.insertSeed("Bob", "Morning standup notes are posted here.", "home");
        postRepository.insertSeed("Carol", "Deployed the latest release to staging.", "home");

        postRepository.insertSeed("Dave", "Exploring Kotlin coroutines for our next service.", "tech");
        postRepository.insertSeed("Eve", "SQLite WAL mode gives us better concurrent reads.", "tech");
        postRepository.insertSeed("Frank", "Benchmarking JdbcClient vs raw JDBC templates.", "tech");

        postRepository.insertSeed("Grace", "On-call rotation starts tonight at 18:00.", "ops");
        postRepository.insertSeed("Henry", "Disk usage on node-3 is back to normal.", "ops");
        postRepository.insertSeed("Ivy", "Scheduled maintenance window confirmed for Sunday.", "ops");
    }

    private void validateChannel(String channel) {
        if (channel != null && !VALID_CHANNELS.contains(channel)) {
            throw new ApiException(ApiErrorCode.INVALID_CHANNEL);
        }
    }

    private void validateLimit(int limit) {
        if (limit < 1 || limit > 100) {
            throw new ApiException(ApiErrorCode.INVALID_LIMIT);
        }
    }
}
