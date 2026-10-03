package db.migration;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.domain.PublicationState;
import com.fallrising.cms.content.index.EntryIndexer;
import com.fallrising.cms.content.index.IndexRow;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * BW1b: rebuilds cms_entry_index for every existing entry with EntryIndexer (02 §3.2), so rows written before V6
 * (scope-less, never maintained) are replaced by the same rows the content store writes from now on.
 */
public class V7__backfill_entry_index extends BaseJavaMigration {

    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};
    private static final TypeReference<List<String>> STRINGS = new TypeReference<>() {};

    private final ObjectMapper mapper = new ObjectMapper();

    @Override
    public void migrate(Context context) {
        JdbcTemplate jdbc = new JdbcTemplate(new SingleConnectionDataSource(context.getConnection(), true));
        jdbc.update("DELETE FROM cms_entry_index");
        List<ContentTypeRecord> types = jdbc.query(
                "SELECT id, type_key, title_field, public_requires_published_refs, sort_field, visibility_field, owner_field FROM cms_content_type",
                (rs, n) -> new ContentTypeRecord(
                        rs.getObject("id", UUID.class), rs.getString("type_key"), "", "", null,
                        rs.getString("title_field"), "none", false, true, false,
                        read(rs.getString("public_requires_published_refs"), STRINGS), null, null,
                        rs.getString("sort_field"), rs.getString("visibility_field"), rs.getString("owner_field")));
        for (ContentTypeRecord type : types) {
            List<FieldRecord> fields = jdbc.query(
                    "SELECT id, field_key, field_type, indexed, enabled FROM cms_field WHERE content_type_id = ?",
                    (rs, n) -> new FieldRecord(
                            rs.getObject("id", UUID.class), type.id(), rs.getString("field_key"), rs.getString("field_type"),
                            false, false, rs.getBoolean("indexed"), "public", 0, null, "restrict", List.of(),
                            rs.getBoolean("enabled"), false),
                    type.id());
            List<EntryRecord> entries = jdbc.query(
                    "SELECT id, payload, published_payload FROM cms_entry WHERE content_type_id = ?",
                    (rs, n) -> new EntryRecord(
                            rs.getObject("id", UUID.class), type.id(), type.typeKey(), null, PublicationState.DRAFT, 1,
                            read(rs.getString("payload"), MAP),
                            rs.getString("published_payload") == null ? null : read(rs.getString("published_payload"), MAP),
                            null, null, null, null, null, null, null),
                    type.id());
            for (EntryRecord entry : entries) {
                List<IndexRow> rows = EntryIndexer.rows(type, fields, entry);
                jdbc.batchUpdate(
                        """
                        INSERT INTO cms_entry_index
                          (entry_id, field_key, scope, value_kind, value_string, value_int, value_bool, value_ts)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        rows.stream().map(row -> new Object[] {
                                row.entryId(), row.fieldKey(), row.scope().wire(), row.kind(), row.stringValue(),
                                row.intValue(), row.boolValue(),
                                row.tsValue() == null ? null : Timestamp.from(row.tsValue())}).toList());
            }
        }
    }

    private <T> T read(String raw, TypeReference<T> type) {
        try {
            return mapper.readValue(raw == null ? "null" : raw, type);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
