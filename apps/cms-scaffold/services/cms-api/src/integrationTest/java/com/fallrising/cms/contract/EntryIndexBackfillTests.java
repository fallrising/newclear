package com.fallrising.cms.contract;

import com.fallrising.cms.content.index.IndexRow;
import com.fallrising.cms.content.index.IndexScope;
import com.fallrising.cms.content.store.JdbcContentStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import javax.sql.DataSource;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** V7 rebuilds cms_entry_index for entries written before BW1b (02 §3.2); V10 adds rows of ref fields (02 BQ-10). */
class EntryIndexBackfillTests {

    @Test
    void B09_v7BackfillsWorkAndPublishedRowsAndDropsStaleRows() {
        DataSource dataSource = PostgresFixture.emptyDataSource();
        Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").target("6").load().migrate();
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        UUID type = UUID.randomUUID();
        UUID entry = UUID.randomUUID();
        UUID draft = UUID.randomUUID();
        UUID fraction = UUID.randomUUID();
        jdbc.update("INSERT INTO cms_content_type (id, type_key, display_name, plural_display_name, title_field, sort_field) "
                + "VALUES (?, 'photo', 'Photo', 'Photos', 'title', 'rank')", type);
        jdbc.update("INSERT INTO cms_field (id, content_type_id, field_key, field_type, indexed) VALUES (?, ?, 'title', 'string', false)",
                UUID.randomUUID(), type);
        jdbc.update("INSERT INTO cms_field (id, content_type_id, field_key, field_type, indexed) VALUES (?, ?, 'rank', 'int', false)",
                UUID.randomUUID(), type);
        jdbc.update("INSERT INTO cms_field (id, content_type_id, field_key, field_type, indexed) VALUES (?, ?, 'caption', 'string', false)",
                UUID.randomUUID(), type);
        jdbc.update("INSERT INTO cms_entry (id, content_type_id, slug, publication_state, payload, published_payload) "
                + "VALUES (?, ?, 'a', 'published', CAST(? AS jsonb), CAST(? AS jsonb))",
                entry, type, "{\"title\":\"New\",\"rank\":2,\"caption\":\"c\"}", "{\"title\":\"Old\",\"rank\":1}");
        jdbc.update("INSERT INTO cms_entry (id, content_type_id, slug, publication_state, payload) "
                + "VALUES (?, ?, 'b', 'draft', CAST(? AS jsonb))", draft, type, "{\"title\":\"Draft\"}");
        jdbc.update("INSERT INTO cms_entry_index (entry_id, field_key, value_kind, value_string) VALUES (?, 'caption', 'string', 'stale')", entry);

        jdbc.update("INSERT INTO cms_entry (id, content_type_id, slug, publication_state, payload, published_payload) "
                + "VALUES (?, ?, 'fraction', 'published', CAST(? AS jsonb), CAST(? AS jsonb))",
                fraction, type, "{\"rank\":1.5}", "{\"rank\":0.5}");

        Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").load().migrate();

        JdbcContentStore store = new JdbcContentStore(dataSource, new ObjectMapper());
        assertThat(store.indexRowsOf(entry)).containsExactly(
                new IndexRow(entry, "rank", IndexScope.PUBLISHED, "int", null, 1L, null, null),
                new IndexRow(entry, "title", IndexScope.PUBLISHED, "string", "Old", null, null, null),
                new IndexRow(entry, "rank", IndexScope.WORK, "int", null, 2L, null, null),
                new IndexRow(entry, "title", IndexScope.WORK, "string", "New", null, null, null));
        assertThat(store.indexRowsOf(fraction)).containsExactly(
                new IndexRow(fraction, "rank", IndexScope.PUBLISHED, "int", null, new java.math.BigDecimal("0.5"), null, null),
                new IndexRow(fraction, "rank", IndexScope.WORK, "int", null, new java.math.BigDecimal("1.5"), null, null));
        assertThat(store.indexRowsOf(draft)).containsExactly(
                new IndexRow(draft, "title", IndexScope.WORK, "string", "Draft", null, null, null));
    }

    @Test
    void BQ10_v10IndexesRefFieldsOfExistingEntries() {
        DataSource dataSource = PostgresFixture.emptyDataSource();
        Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").target("9").load().migrate();
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        UUID type = UUID.randomUUID();
        UUID entry = UUID.randomUUID();
        UUID oldAlbum = UUID.randomUUID();
        UUID newAlbum = UUID.randomUUID();
        jdbc.update("INSERT INTO cms_content_type (id, type_key, display_name, plural_display_name, title_field) "
                + "VALUES (?, 'photo', 'Photo', 'Photos', 'title')", type);
        jdbc.update("INSERT INTO cms_field (id, content_type_id, field_key, field_type, indexed) VALUES (?, ?, 'title', 'string', false)",
                UUID.randomUUID(), type);
        jdbc.update("INSERT INTO cms_field (id, content_type_id, field_key, field_type, indexed) VALUES (?, ?, 'album', 'ref', false)",
                UUID.randomUUID(), type);
        jdbc.update("INSERT INTO cms_entry (id, content_type_id, slug, publication_state, payload, published_payload) "
                + "VALUES (?, ?, 'a', 'published', CAST(? AS jsonb), CAST(? AS jsonb))", entry, type,
                "{\"title\":\"T\",\"album\":\"" + newAlbum + "\"}", "{\"title\":\"T\",\"album\":\"" + oldAlbum + "\"}");

        Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").load().migrate();

        JdbcContentStore store = new JdbcContentStore(dataSource, new ObjectMapper());
        assertThat(store.indexRowsOf(entry)).containsExactly(
                new IndexRow(entry, "album", IndexScope.PUBLISHED, "ref", oldAlbum.toString(), null, null, null),
                new IndexRow(entry, "title", IndexScope.PUBLISHED, "string", "T", null, null, null),
                new IndexRow(entry, "album", IndexScope.WORK, "ref", newAlbum.toString(), null, null, null),
                new IndexRow(entry, "title", IndexScope.WORK, "string", "T", null, null, null));
    }
}
