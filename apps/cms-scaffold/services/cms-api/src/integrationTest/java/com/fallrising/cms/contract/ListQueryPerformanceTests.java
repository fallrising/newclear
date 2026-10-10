package com.fallrising.cms.contract;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.domain.PublicationState;
import com.fallrising.cms.content.index.IndexScope;
import com.fallrising.cms.content.query.AccessFilter;
import com.fallrising.cms.content.query.EntryPage;
import com.fallrising.cms.content.query.EntryQuery;
import com.fallrising.cms.content.query.FieldFilter;
import com.fallrising.cms.content.query.SortKey;
import com.fallrising.cms.content.store.JdbcContentStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import javax.sql.DataSource;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 02 §5.4 on PostgreSQL 16 with 10,000 entries of one type. Each operation runs 10 warm-up times, then 100 measured
 * times; the 95th percentile (the 95th of 100 sorted durations) must meet the target. queryEntries must issue exactly
 * 2 SQL statements (COUNT and page SELECT) for any page size.
 */
class ListQueryPerformanceTests {

    static final int ENTRIES = 10_000;
    static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");

    final AtomicInteger statements = new AtomicInteger();

    @Test
    void BW1b_listAndPatchMeetTargetsWithTenThousandEntries() {
        JdbcContentStore store = new JdbcContentStore(counting(PostgresFixture.cleanDataSource()), new ObjectMapper());
        ContentTypeRecord type = new ContentTypeRecord(UUID.randomUUID(), "perf_item", "Item", "Items", null, "title",
                "optional", false, true, true, List.of(), T0, T0, "rank", "visibility", null);
        store.insertType(type);
        store.insertField(field(type, "title", "string", false, List.of()));
        store.insertField(field(type, "status", "enum", true, List.of("open", "closed")));
        store.insertField(field(type, "rank", "int", false, List.of()));
        store.insertField(field(type, "visibility", "enum", false, List.of("public", "unlisted")));
        Random random = new Random(42);
        List<EntryRecord> all = new ArrayList<>();
        for (int i = 0; i < ENTRIES; i++) {
            Map<String, Object> payload = Map.of(
                    "title", "Item " + i + (i % 10 == 0 ? " harbour" : ""),
                    "status", i % 3 == 0 ? "open" : "closed",
                    "rank", random.nextInt(1000),
                    "visibility", i % 20 == 0 ? "unlisted" : "public");
            boolean published = i % 2 == 0;
            EntryRecord entry = new EntryRecord(UUID.randomUUID(), type.id(), "perf_item", "item-" + i,
                    published ? PublicationState.PUBLISHED : PublicationState.DRAFT, 1, payload, published ? payload : null,
                    published ? T0.plusSeconds(i) : null, null, null, null, null, T0, T0.plusSeconds(i));
            store.insertEntry(entry);
            all.add(entry);
        }

        EntryQuery work = new EntryQuery(type.id(), IndexScope.WORK, List.of("draft", "published"), "title", "harbour",
                List.of(FieldFilter.equalsValue("status", "enum", "open")), List.of(), AccessFilter.none(), null, List.of(),
                SortKey.system("updatedAt", true), 1, 20);
        EntryQuery pub = new EntryQuery(type.id(), IndexScope.PUBLISHED, List.of("published"), "title", null, List.of(),
                List.of(), AccessFilter.none(), "visibility", List.of(), SortKey.field("rank", "int", false), 1, 20);

        statements.set(0);
        EntryPage workPage = store.queryEntries(work);
        assertThat(statements.get()).isEqualTo(2);
        assertThat(workPage.items()).hasSize(20);
        assertThat(workPage.total()).isEqualTo(334);
        statements.set(0);
        EntryPage publicPage = store.queryEntries(pub);
        assertThat(statements.get()).isEqualTo(2);
        assertThat(publicPage.total()).isEqualTo(4500);

        for (int size : List.of(1, 100)) {
            statements.set(0);
            EntryPage page = store.queryEntries(new EntryQuery(type.id(), IndexScope.WORK, work.states(), "title", "harbour",
                    work.filters(), List.of(), AccessFilter.none(), null, List.of(), work.sort(), 1, size));
            assertThat(statements.get()).isEqualTo(2);
            assertThat(page.items()).hasSize(size);
            assertThat(page.total()).isEqualTo(334);
        }

        long workP95 = p95(() -> store.queryEntries(work));
        long publicP95 = p95(() -> store.queryEntries(pub));
        long patchP95 = p95(() -> {
            int index = random.nextInt(ENTRIES);
            EntryRecord e = all.get(index);
            EntryRecord updated = store.updateEntry(new EntryRecord(e.id(), e.contentTypeId(), e.contentTypeKey(), e.slug(),
                    e.publicationState(), e.version() + 1, Map.of("title", "Patched " + random.nextInt(), "status", "open",
                    "rank", random.nextInt(1000), "visibility", "public"), e.publishedPayload(), e.publishedAt(), null,
                    null, null, null, e.createdAt(), Instant.now()));
            all.set(index, updated);
            return updated;
        });
        System.out.printf("BW1b perf (%d entries): work list p95 %d ms, public list p95 %d ms, patch p95 %d ms%n",
                ENTRIES, workP95, publicP95, patchP95);
        assertThat(workP95).isLessThanOrEqualTo(150);
        assertThat(publicP95).isLessThanOrEqualTo(100);
        assertThat(patchP95).isLessThanOrEqualTo(80);
    }

    private static long p95(Supplier<?> operation) {
        for (int i = 0; i < 10; i++) operation.get();
        long[] millis = new long[100];
        for (int i = 0; i < millis.length; i++) {
            long start = System.nanoTime();
            operation.get();
            millis[i] = (System.nanoTime() - start) / 1_000_000;
        }
        java.util.Arrays.sort(millis);
        return millis[94];
    }

    private static FieldRecord field(ContentTypeRecord type, String key, String fieldType, boolean indexed, List<String> enums) {
        return new FieldRecord(UUID.randomUUID(), type.id(), key, fieldType, false, false, indexed, "public", 0, null,
                "restrict", enums, true, false);
    }

    /** Counts prepareStatement and createStatement calls on every connection of the data source. */
    private DataSource counting(DataSource target) {
        return (DataSource) Proxy.newProxyInstance(DataSource.class.getClassLoader(), new Class<?>[] {DataSource.class},
                (proxy, method, args) -> {
                    Object result = invoke(target, method, args);
                    if (result instanceof Connection connection) {
                        return Proxy.newProxyInstance(Connection.class.getClassLoader(), new Class<?>[] {Connection.class},
                                (p, m, a) -> {
                                    if (m.getName().equals("prepareStatement") || m.getName().equals("createStatement")) {
                                        statements.incrementAndGet();
                                    }
                                    return invoke(connection, m, a);
                                });
                    }
                    return result;
                });
    }

    private static Object invoke(Object target, java.lang.reflect.Method method, Object[] args) throws Throwable {
        try {
            return method.invoke(target, args);
        } catch (InvocationTargetException e) {
            throw e.getCause();
        }
    }
}
