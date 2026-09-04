package com.example.deck.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.deck.error.ApiErrorCode;
import com.example.deck.error.ApiException;
import com.example.deck.model.Post;
import com.example.deck.model.PostPage;
import com.example.deck.model.SearchCursor;
import com.example.deck.repository.SearchRepository;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.annotation.Transactional;

class SearchServiceTest {

    private final SearchRepository repository = mock(SearchRepository.class);
    private final SearchQueryCompiler searchQueryCompiler = new SearchQueryCompiler();
    private final SearchCursorCodec cursorCodec = new SearchCursorCodec();
    private final SearchService service =
            new SearchService(repository, searchQueryCompiler, cursorCodec);

    @Test
    void searchIsReadOnlyTransactional() throws Exception {
        Transactional annotation = SearchService.class
                .getMethod("search", String.class, int.class, String.class, Long.class)
                .getAnnotation(Transactional.class);

        assertThat(annotation).isNotNull();
        assertThat(annotation.readOnly()).isTrue();
    }

    @Test
    void missingOrInvalidQueryMapsToInvalidQuery() {
        assertThatThrownBy(() -> service.search(null, 20, null, null))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getCode())
                        .isEqualTo(ApiErrorCode.INVALID_QUERY));

        assertThatThrownBy(() -> service.search("***", 20, null, null))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getCode())
                        .isEqualTo(ApiErrorCode.INVALID_QUERY));
    }

    @Test
    void outOfRangeLimitMapsToInvalidLimitWithSearchRangeDetail() {
        assertThatThrownBy(() -> service.search("ship", 0, null, null))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> {
                    ApiException apiException = (ApiException) ex;
                    assertThat(apiException.getCode()).isEqualTo(ApiErrorCode.INVALID_LIMIT);
                    assertThat(apiException.getDetail()).isEqualTo("Limit must be between 1 and 50.");
                });

        assertThatThrownBy(() -> service.search("ship", 51, null, null))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getCode())
                        .isEqualTo(ApiErrorCode.INVALID_LIMIT));
    }

    @Test
    void malformedCursorMapsToInvalidCursor() {
        assertThatThrownBy(() -> service.search("ship", 20, "garbage", null))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getCode())
                        .isEqualTo(ApiErrorCode.INVALID_CURSOR));
    }

    @Test
    void fetchesLimitPlusOneAndEmitsCursorFromLastDeliveredPost() {
        Instant newest = Instant.parse("2026-09-03T09:00:02Z");
        Instant middle = Instant.parse("2026-09-03T09:00:01Z");
        Instant oldest = Instant.parse("2026-09-03T09:00:00Z");
        List<Post> fetched = List.of(post(3, newest), post(2, middle), post(1, oldest));
        when(repository.findResults(eq("\"ship\""), eq(42L), isNull(), eq(3)))
                .thenReturn(fetched);

        PostPage page = service.search("ship", 2, null, 42L);

        verify(repository).findResults(eq("\"ship\""), eq(42L), isNull(), eq(3));
        assertThat(page.items()).containsExactly(post(3, newest), post(2, middle));
        SearchCursor boundary = cursorCodec.decode(page.nextCursor());
        assertThat(boundary.createdAt()).isEqualTo(middle);
        assertThat(boundary.id()).isEqualTo(2L);
    }

    @Test
    void rowsNotExceedingLimitNeverProduceCursor() {
        Instant newer = Instant.parse("2026-09-03T09:00:01Z");
        Instant older = Instant.parse("2026-09-03T09:00:00Z");
        when(repository.findResults(anyString(), any(), any(), anyInt()))
                .thenReturn(List.of(post(2, newer), post(1, older)));

        PostPage page = service.search("ship", 2, null, null);

        assertThat(page.items()).hasSize(2);
        assertThat(page.nextCursor()).isNull();
    }

    @Test
    void emptyPageNeverEncodesCursor() {
        when(repository.findResults(anyString(), any(), any(), anyInt()))
                .thenReturn(List.of());

        PostPage page = service.search("ship", 20, null, null);

        assertThat(page.items()).isEmpty();
        assertThat(page.nextCursor()).isNull();
    }

    @Test
    void decodesAndPassesCursorToRepository() {
        SearchCursor boundary = new SearchCursor(Instant.parse("2026-09-03T09:00:00Z"), 7);
        String encoded = cursorCodec.encode(boundary);
        when(repository.findResults(eq("\"ship\""), isNull(), eq(boundary), eq(21)))
                .thenReturn(List.of());

        service.search("ship", 20, encoded, null);

        verify(repository).findResults(eq("\"ship\""), isNull(), eq(boundary), eq(21));
    }

    @Test
    void operationalRepositoryFailurePropagatesUnchanged() {
        IllegalStateException failure = new IllegalStateException("fts index corrupted");
        when(repository.findResults(anyString(), any(), any(), anyInt())).thenThrow(failure);

        assertThatThrownBy(() -> service.search("ship", 20, null, null)).isSameAs(failure);
    }

    private static Post post(long id, Instant createdAt) {
        return new Post(id, "Alice", "alice", "ship fast", "home", createdAt,
                0L, 0L, false, "post:" + id, 0L, false, null, null, null);
    }
}