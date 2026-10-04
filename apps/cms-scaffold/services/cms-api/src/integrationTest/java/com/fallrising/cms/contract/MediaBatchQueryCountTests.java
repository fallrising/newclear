package com.fallrising.cms.contract;

import com.fallrising.cms.media.domain.MediaAsset;
import com.fallrising.cms.media.domain.MediaAttachment;
import com.fallrising.cms.media.domain.MediaVariant;
import com.fallrising.cms.media.store.JdbcMediaStore;
import org.junit.jupiter.api.Test;

import javax.sql.DataSource;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/** Count actual PostgreSQL statements for batched media and variant/attachment reads. */
class MediaBatchQueryCountTests {
    private final AtomicInteger statements = new AtomicInteger();
    private static final Instant NOW = Instant.parse("2026-10-04T00:00:00Z");

    @Test
    void oneAndThreeKnownMediaUseTwoQueriesAndAttachmentsUseOne() {
        JdbcMediaStore store = new JdbcMediaStore(counting(PostgresFixture.cleanDataSource()));
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            UUID id = UUID.randomUUID();
            ids.add(id);
            store.insert(asset(id));
            store.insertVariant(new MediaVariant(id, "thumbnail", "image/jpeg", 10, 8, 8, "media/" + id + "/thumb"));
            UUID entryId = UUID.randomUUID();
            store.replaceAttachments(entryId, List.of(new MediaAttachment(id, entryId, "photo", NOW)));
        }
        for (int size : List.of(1, 3)) {
            List<UUID> requested = new ArrayList<>(ids.subList(0, size));
            requested.add(ids.getFirst());
            requested.add(UUID.randomUUID());
            statements.set(0);
            List<MediaAsset> found = store.findAll(requested);
            assertThat(statements.get()).isEqualTo(2);
            assertThat(found).extracting(MediaAsset::id).containsExactlyInAnyOrderElementsOf(ids.subList(0, size));
            for (MediaAsset media : found) {
                assertThat(media.variants()).hasSize(1);
                assertThat(media.variants().getFirst().mediaId()).isEqualTo(media.id());
                assertThat(media.variants().getFirst().variant()).isEqualTo("thumbnail");
            }
            statements.set(0);
            List<MediaAttachment> attachments = store.attachmentsOfMedia(requested);
            assertThat(statements.get()).isEqualTo(1);
            assertThat(attachments).extracting(MediaAttachment::mediaId).containsExactlyInAnyOrderElementsOf(ids.subList(0, size));
        }
    }

    @Test
    void emptyCollectionsIssueNoSqlAndUnknownMediaSkipTheVariantQuery() {
        JdbcMediaStore store = new JdbcMediaStore(counting(PostgresFixture.cleanDataSource()));
        statements.set(0);
        assertThat(store.findAll(List.of())).isEmpty();
        assertThat(store.attachmentsOfMedia(List.of())).isEmpty();
        assertThat(statements.get()).isZero();
        assertThat(store.findAll(List.of(UUID.randomUUID()))).isEmpty();
        assertThat(statements.get()).isEqualTo(1);
    }

    private MediaAsset asset(UUID id) {
        return new MediaAsset(id, UUID.randomUUID(), "Media", "Alt", "image.png", "image/png", 100, 110,
                8, 8, "a".repeat(64), "available", null, NOW, NOW, List.of());
    }

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
        } catch (InvocationTargetException exception) {
            throw exception.getCause();
        }
    }
}
