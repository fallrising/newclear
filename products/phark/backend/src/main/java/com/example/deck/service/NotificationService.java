package com.example.deck.service;

import com.example.deck.error.ApiErrorCode;
import com.example.deck.error.ApiException;
import com.example.deck.model.NotificationCursor;
import com.example.deck.model.NotificationItem;
import com.example.deck.model.NotificationPage;
import com.example.deck.model.NotificationReadState;
import com.example.deck.model.NotificationSummary;
import com.example.deck.repository.NotificationReadRepository;
import com.example.deck.repository.NotificationRepository;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class NotificationService {

    private final NotificationRepository notificationRepository;
    private final NotificationReadRepository notificationReadRepository;
    private final NotificationCursorCodec cursorCodec;

    public NotificationService(
            NotificationRepository notificationRepository,
            NotificationReadRepository notificationReadRepository,
            NotificationCursorCodec cursorCodec) {
        this.notificationRepository = notificationRepository;
        this.notificationReadRepository = notificationReadRepository;
        this.cursorCodec = cursorCodec;
    }

    @Transactional(readOnly = true)
    public NotificationPage getNotifications(
            long accountId, int limit, String before) {
        validateLimit(limit);
        NotificationCursor beforeCursor = before == null ? null : decodeCursor(before);
        NotificationSummary summary = notificationRepository.findSummary(accountId);
        List<NotificationItem> fetchedItems = notificationRepository.findPage(
                accountId,
                limit + 1,
                beforeCursor == null ? null : beforeCursor.id(),
                summary.readThroughId());

        boolean hasMore = fetchedItems.size() > limit;
        List<NotificationItem> items = hasMore
                ? List.copyOf(fetchedItems.subList(0, limit))
                : List.copyOf(fetchedItems);
        String nextCursor = hasMore
                ? encodeCursor(items.get(items.size() - 1).id())
                : null;

        return new NotificationPage(
                items,
                nextCursor,
                encodeNullableCursor(summary.latestRetainedId()),
                encodeReadThrough(summary.readThroughId()),
                summary.unreadCount());
    }

    @Transactional
    public NotificationReadState markRead(long accountId, String through) {
        NotificationCursor requested = decodeCursor(through);
        if (!notificationReadRepository.isOwnedRetained(accountId, requested.id())) {
            throw new ApiException(ApiErrorCode.INVALID_CURSOR);
        }

        long readThroughId =
                notificationReadRepository.advanceReadThrough(accountId, requested.id());
        NotificationSummary summary = notificationRepository.findSummary(accountId);
        return new NotificationReadState(
                encodeReadThrough(readThroughId), summary.unreadCount());
    }

    private NotificationCursor decodeCursor(String encoded) {
        try {
            return cursorCodec.decode(encoded);
        } catch (IllegalArgumentException exception) {
            throw new ApiException(ApiErrorCode.INVALID_CURSOR, exception);
        }
    }

    private String encodeNullableCursor(Long id) {
        return id == null ? null : encodeCursor(id);
    }

    private String encodeReadThrough(long id) {
        return id == 0 ? null : encodeCursor(id);
    }

    private String encodeCursor(long id) {
        return cursorCodec.encode(new NotificationCursor(id));
    }

    private void validateLimit(int limit) {
        if (limit < 1 || limit > 100) {
            throw new ApiException(ApiErrorCode.INVALID_LIMIT);
        }
    }
}
