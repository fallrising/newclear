package com.example.deck.service;

import com.example.deck.error.ApiErrorCode;
import com.example.deck.error.ApiException;
import com.example.deck.model.Post;
import com.example.deck.model.PostPage;
import com.example.deck.model.SearchCursor;
import com.example.deck.repository.SearchRepository;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SearchService {

    private static final int MAX_LIMIT = 50;

    private final SearchRepository searchRepository;
    private final SearchQueryCompiler searchQueryCompiler;
    private final SearchCursorCodec cursorCodec;

    public SearchService(
            SearchRepository searchRepository,
            SearchQueryCompiler searchQueryCompiler,
            SearchCursorCodec cursorCodec) {
        this.searchRepository = searchRepository;
        this.searchQueryCompiler = searchQueryCompiler;
        this.cursorCodec = cursorCodec;
    }

    @Transactional(readOnly = true)
    public PostPage search(String query, int limit, String before, Long viewerAccountId) {
        String compiledQuery = compileQuery(query);
        validateLimit(limit);
        SearchCursor beforeCursor = decodeCursor(before);

        List<Post> fetchedItems =
                searchRepository.findResults(compiledQuery, viewerAccountId, beforeCursor, limit + 1);
        return toPage(fetchedItems, limit);
    }

    private String compileQuery(String query) {
        try {
            return searchQueryCompiler.compile(query);
        } catch (IllegalArgumentException exception) {
            throw new ApiException(ApiErrorCode.INVALID_QUERY, exception);
        }
    }

    private void validateLimit(int limit) {
        if (limit < 1 || limit > MAX_LIMIT) {
            throw new ApiException(ApiErrorCode.INVALID_LIMIT, "Limit must be between 1 and 50.");
        }
    }

    private SearchCursor decodeCursor(String before) {
        if (before == null) {
            return null;
        }
        try {
            return cursorCodec.decode(before);
        } catch (IllegalArgumentException exception) {
            throw new ApiException(ApiErrorCode.INVALID_CURSOR, exception);
        }
    }

    private PostPage toPage(List<Post> fetchedItems, int limit) {
        boolean hasMore = fetchedItems.size() > limit;
        List<Post> items = hasMore
                ? List.copyOf(fetchedItems.subList(0, limit))
                : List.copyOf(fetchedItems);
        String nextCursor = hasMore
                ? cursorCodec.encode(new SearchCursor(
                        items.get(items.size() - 1).createdAt(),
                        items.get(items.size() - 1).id()))
                : null;
        return new PostPage(items, nextCursor);
    }
}