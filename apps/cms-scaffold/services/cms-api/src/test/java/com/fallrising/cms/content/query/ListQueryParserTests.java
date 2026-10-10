package com.fallrising.cms.content.query;

import com.fallrising.cms.api.error.ErrorCode;
import com.fallrising.cms.content.ContentException;
import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.index.IndexScope;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ListQueryParserTests {

    static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");
    static final UUID TYPE = UUID.randomUUID();

    static ContentTypeRecord type(String sortField) {
        return new ContentTypeRecord(TYPE, "event", "Event", "Events", null, "title", "optional", false, true, true,
                List.of(), T0, T0, sortField, null, null);
    }

    static FieldRecord field(String key, String fieldType, boolean indexed, boolean filterable, String visibility) {
        return new FieldRecord(UUID.randomUUID(), TYPE, key, fieldType, false, false, indexed, visibility, 0, null,
                "restrict", List.of(), true, false, null, null, false, filterable, Map.of(), null, null);
    }

    static final List<FieldRecord> FIELDS = List.of(
            field("title", "string", false, false, "public"),
            field("status", "enum", true, true, "public"),
            field("rank", "int", true, true, "public"),
            field("featured", "boolean", true, true, "public"),
            field("startsAt", "datetime", true, true, "public"),
            field("venue", "ref", true, true, "public"),
            field("secretNote", "string", true, true, "internal"),
            field("staffRef", "ref", false, false, "back"),
            field("color", "string", true, false, "public"),
            field("loose", "string", false, true, "public"));

    static ListQueryParser.Parsed work(String... pairs) {
        return ListQueryParser.parse(type(null), FIELDS, IndexScope.WORK, params(pairs));
    }

    static ListQueryParser.Parsed pub(ContentTypeRecord type, String... pairs) {
        return ListQueryParser.parse(type, FIELDS, IndexScope.PUBLISHED, params(pairs));
    }

    static Map<String, String[]> params(String... pairs) {
        Map<String, List<String>> grouped = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            grouped.computeIfAbsent(pairs[i], k -> new java.util.ArrayList<>()).add(pairs[i + 1]);
        }
        Map<String, String[]> out = new LinkedHashMap<>();
        grouped.forEach((k, v) -> out.put(k, v.toArray(String[]::new)));
        return out;
    }

    static void rejected(Runnable parse, String messagePart) {
        assertThatThrownBy(parse::run)
                .isInstanceOf(ContentException.class)
                .hasMessageContaining(messagePart)
                .satisfies(e -> assertThat(((ContentException) e).code()).isEqualTo(ErrorCode.VALIDATION_FAILED));
    }

    @Test
    void G02_workDefaults() {
        ListQueryParser.Parsed parsed = work("offset", "40", "unknown", "x");
        assertThat(parsed).isEqualTo(new ListQueryParser.Parsed(List.of("draft", "published"), null, List.of(), List.of(),
                SortKey.system("updatedAt", true), 1, 20));
    }

    @Test
    void G02_unknownParametersAreIgnoredOnceAndRejectedWhenRepeated() {
        assertThat(work("unknown", "x")).isEqualTo(work());
        rejected(() -> work("unknown", "x", "unknown", "y"), "unknown must not repeat");
        rejected(() -> work("include", "refs", "include", "media"), "include must not repeat");
        rejected(() -> pub(type(null), "offset", "0", "offset", "20"), "offset must not repeat");
    }

    @Test
    void B03_publicDefaultSortIsSortFieldAscendingElseNewestPublished() {
        assertThat(pub(type("rank")).sort()).isEqualTo(SortKey.field("rank", "int", false));
        assertThat(pub(type(null)).sort()).isEqualTo(SortKey.system("publishedAt", true));
        assertThat(pub(type(null)).states()).containsExactly("published");
    }

    @Test
    void G02_pageAndSizeBounds() {
        assertThat(work("page", "3", "size", "100")).extracting(ListQueryParser.Parsed::page, ListQueryParser.Parsed::size)
                .containsExactly(3, 100);
        rejected(() -> work("page", "0"), "page must be a positive integer");
        rejected(() -> work("page", "two"), "page must be a positive integer");
        rejected(() -> work("size", "0"), "size must be an integer from 1 to 100");
        rejected(() -> work("size", "101"), "size must be an integer from 1 to 100");
        rejected(() -> work("page", "1", "page", "2"), "page must not repeat");
    }

    @Test
    void G02_states() {
        assertThat(work("state", " draft , archived,draft").states()).containsExactly("draft", "archived");
        assertThat(work("state", " , ").states()).containsExactly("draft", "published");
        rejected(() -> work("state", "draft,deleted"), "state: unknown value deleted");
    }

    @Test
    void G02_sortKeys() {
        assertThat(work("sort", "-createdAt").sort()).isEqualTo(SortKey.system("createdAt", true));
        assertThat(work("sort", "title").sort()).isEqualTo(SortKey.field("title", "string", false));
        assertThat(work("sort", "-startsAt").sort()).isEqualTo(SortKey.field("startsAt", "datetime", true));
        assertThat(work("sort", "color").sort()).isEqualTo(SortKey.field("color", "string", false));
        rejected(() -> work("sort", "loose"), "sort: loose is not sortable");
        rejected(() -> work("sort", "venue"), "sort: venue is not sortable");
        rejected(() -> work("sort", "missing"), "sort: missing is not sortable");
        assertThat(work("sort", "secretNote").sort()).isEqualTo(SortKey.field("secretNote", "string", false));
        rejected(() -> pub(type(null), "sort", "secretNote"), "sort: secretNote is not sortable");
    }

    @Test
    void G02_publicTitleAliasRejectsHiddenDisabledAndUnindexableFields() {
        for (FieldRecord title : List.of(
                field("title", "string", false, false, "internal"),
                new FieldRecord(UUID.randomUUID(), TYPE, "title", "string", false, false, true, "public", 0,
                        null, "restrict", List.of(), false, false),
                field("title", "media-ref", true, false, "public"),
                field("title", "ref", true, false, "public"))) {
            rejected(() -> ListQueryParser.parse(type(null), List.of(title), IndexScope.PUBLISHED,
                    params("sort", "title")), "sort: title is not sortable");
        }
        rejected(() -> ListQueryParser.parse(type(null), List.of(), IndexScope.PUBLISHED,
                params("sort", "title")), "sort: title is not sortable");
    }

    @Test
    void G02_publicDefaultSortFallsBackForHiddenOrRefFields() {
        assertThat(pub(type("secretNote")).sort()).isEqualTo(SortKey.system("publishedAt", true));
        assertThat(pub(type("venue")).sort()).isEqualTo(SortKey.system("publishedAt", true));
    }

    @Test
    void G02_equalityFiltersParseByKind() {
        assertThat(work("filter.status", "open", "filter.rank", "-3", "filter.featured", "false", "filter.venue", "v1").filters())
                .containsExactly(
                        FieldFilter.equalsValue("status", "enum", "open"),
                        FieldFilter.equalsValue("rank", "int", -3L),
                        FieldFilter.equalsValue("featured", "bool", false),
                        FieldFilter.equalsValue("venue", "ref", "v1"));
        rejected(() -> work("filter.rank", "1.5"), "filter.rank must be an integer");
        rejected(() -> work("filter.featured", "yes"), "filter.featured must be true or false");
        rejected(() -> work("filter.status", " "), "filter.status must not be blank");
        rejected(() -> work("filter.status", "a", "filter.status", "b"), "filter.status must not repeat");
    }

    @Test
    void G02_onlyFilterableIndexedFieldsQualify() {
        rejected(() -> work("filter.color", "red"), "filter.color: field is not filterable");
        rejected(() -> work("filter.loose", "x"), "filter.loose: field is not filterable");
        rejected(() -> work("filter.nothing", "x"), "filter.nothing: field is not filterable");
        assertThat(work("filter.secretNote", "x").filters()).hasSize(1);
        rejected(() -> pub(type(null), "filter.secretNote", "x"), "filter.secretNote: field is not filterable");
    }

    @Test
    void G02_datetimeFiltersUseFromAndTo() {
        assertThat(work("filter.startsAt.from", "2026-01-01T08:00:00+08:00", "filter.startsAt.to", "2026-02-01T00:00:00Z").filters())
                .containsExactly(FieldFilter.range("startsAt", Instant.parse("2026-01-01T00:00:00Z"), Instant.parse("2026-02-01T00:00:00Z")));
        assertThat(work("filter.startsAt.to", "2026-02-01T00:00:00Z").filters())
                .containsExactly(FieldFilter.range("startsAt", null, Instant.parse("2026-02-01T00:00:00Z")));
        rejected(() -> work("filter.startsAt", "2026-01-01T00:00:00Z"), "filter.startsAt: use filter.startsAt.from or filter.startsAt.to");
        rejected(() -> work("filter.startsAt.from", "2026-01-01"), "filter.startsAt.from must be an ISO-8601 date-time with offset");
        rejected(() -> work("filter.rank.from", "1"), "filter.rank.from: .from and .to apply to datetime fields only");
    }

    @Test
    void G02_refFiltersRepeatAndSkipBlank() {
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        assertThat(work("ref.venue", a.toString(), "ref.venue", b.toString(), "ref.other", "").refs())
                .containsExactly(new RefFilter("venue", a), new RefFilter("venue", b));
        assertThat(work("ref.staffRef", a.toString()).refs()).containsExactly(new RefFilter("staffRef", a));
        rejected(() -> work("ref.venue", "abc"), "ref.venue must be a UUID");
        assertThat(pub(type(null), "ref.venue", a.toString()).refs()).containsExactly(new RefFilter("venue", a));
        rejected(() -> pub(type(null), "ref.staffRef", a.toString()), "ref.staffRef: field is not a public ref field");
        rejected(() -> pub(type(null), "ref.status", a.toString()), "ref.status: field is not a public ref field");
    }

    @Test
    void G02_searchIsPassedThrough() {
        assertThat(work("q", " Coast ").q()).isEqualTo(" Coast ");
        rejected(() -> work("q", "a", "q", "b"), "q must not repeat");
    }
}
