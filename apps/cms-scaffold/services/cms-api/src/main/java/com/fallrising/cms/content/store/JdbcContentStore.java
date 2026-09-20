package com.fallrising.cms.content.store;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.EntryRefRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.domain.NavigationRecord;
import com.fallrising.cms.content.domain.PublicationState;
import com.fallrising.cms.content.domain.RevisionRecord;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import javax.sql.DataSource;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

public class JdbcContentStore implements ContentStore {

    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};
    private static final TypeReference<List<String>> STRINGS = new TypeReference<>() {};

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public JdbcContentStore(DataSource dataSource, ObjectMapper mapper) {
        this.jdbc = new JdbcTemplate(dataSource);
        this.mapper = mapper;
    }

    @Override
    public Optional<ContentTypeRecord> findTypeByKey(String typeKey) {
        return one(jdbc.query("SELECT * FROM cms_content_type WHERE type_key = ?", typeMapper(), typeKey));
    }

    @Override
    public List<ContentTypeRecord> listTypes() {
        return jdbc.query("SELECT * FROM cms_content_type ORDER BY type_key", typeMapper());
    }

    @Override
    public void insertType(ContentTypeRecord type) {
        jdbc.update(
                """
                INSERT INTO cms_content_type
                  (id, type_key, display_name, plural_display_name, description, title_field, slug_policy,
                   singleton, enabled, previewable, public_requires_published_refs, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?)
                """,
                type.id(),
                type.typeKey(),
                type.displayName(),
                type.pluralDisplayName(),
                type.description(),
                type.titleField(),
                type.slugPolicy(),
                type.singleton(),
                type.enabled(),
                type.previewable(),
                json(type.publicRequiresPublishedRefs()),
                ts(type.createdAt()),
                ts(type.updatedAt()));
    }

    @Override
    public void updateType(ContentTypeRecord type) {
        jdbc.update(
                """
                UPDATE cms_content_type SET display_name = ?, plural_display_name = ?, description = ?,
                  enabled = ?, updated_at = ? WHERE id = ?
                """,
                type.displayName(),
                type.pluralDisplayName(),
                type.description(),
                type.enabled(),
                ts(type.updatedAt()),
                type.id());
    }

    @Override
    public List<FieldRecord> fieldsOf(UUID typeId) {
        return jdbc.query(
                "SELECT * FROM cms_field WHERE content_type_id = ? ORDER BY sort_order, field_key",
                fieldMapper(),
                typeId);
    }

    @Override
    public void insertField(FieldRecord field) {
        jdbc.update(
                """
                INSERT INTO cms_field
                  (id, content_type_id, field_key, field_type, required, unique_in_type, indexed, visibility,
                   sort_order, ref_target_type_key, on_delete, enum_values, enabled, public_bytes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?)
                """,
                field.id(),
                field.contentTypeId(),
                field.fieldKey(),
                field.fieldType(),
                field.required(),
                field.uniqueInType(),
                field.indexed(),
                field.visibility(),
                field.sortOrder(),
                field.refTargetTypeKey(),
                field.onDelete(),
                json(field.enumValues()),
                field.enabled(),
                field.publicBytes());
    }

    @Override
    public void markMediaRefsPublic() {
        jdbc.update("UPDATE cms_field SET public_bytes = true WHERE field_type = 'media-ref'");
    }

    @Override
    public Optional<EntryRecord> findEntry(UUID id) {
        return one(jdbc.query(
                """
                SELECT e.*, t.type_key FROM cms_entry e
                JOIN cms_content_type t ON t.id = e.content_type_id
                WHERE e.id = ?
                """,
                entryMapper(),
                id));
    }

    @Override
    public Optional<EntryRecord> findBySlug(UUID typeId, String slug) {
        return one(jdbc.query(
                """
                SELECT e.*, t.type_key FROM cms_entry e
                JOIN cms_content_type t ON t.id = e.content_type_id
                WHERE e.content_type_id = ? AND e.slug = ?
                """,
                entryMapper(),
                typeId,
                slug));
    }

    @Override
    public List<EntryRecord> listEntries(
            UUID typeId, List<String> states, boolean includeDeleted, String q, String refField, UUID refTarget) {
        StringBuilder sql = new StringBuilder(
                """
                SELECT e.*, t.type_key FROM cms_entry e
                JOIN cms_content_type t ON t.id = e.content_type_id
                WHERE e.content_type_id = ?
                """);
        List<Object> args = new ArrayList<>();
        args.add(typeId);
        if (!includeDeleted) {
            sql.append(" AND e.deleted_at IS NULL");
        }
        if (states != null && !states.isEmpty()) {
            sql.append(" AND e.publication_state IN (");
            sql.append(String.join(",", states.stream().map(s -> "?").toList()));
            sql.append(")");
            args.addAll(states);
        }
        if (q != null && !q.isBlank()) {
            sql.append(" AND e.payload->>'title' ILIKE ?");
            args.add("%" + q + "%");
        }
        if (refField != null && refTarget != null) {
            sql.append(
                    """
                     AND EXISTS (
                       SELECT 1 FROM cms_entry_ref r
                       WHERE r.from_entry_id = e.id AND r.field_key = ? AND r.to_id = ?
                     )
                    """);
            args.add(refField);
            args.add(refTarget);
        }
        sql.append(" ORDER BY e.updated_at DESC");
        return jdbc.query(sql.toString(), entryMapper(), args.toArray());
    }

    @Override
    public long countEntries(UUID typeId, boolean includeDeleted) {
        String sql = includeDeleted
                ? "SELECT COUNT(*) FROM cms_entry WHERE content_type_id = ?"
                : "SELECT COUNT(*) FROM cms_entry WHERE content_type_id = ? AND deleted_at IS NULL";
        Long count = jdbc.queryForObject(sql, Long.class, typeId);
        return count == null ? 0 : count;
    }

    @Override
    public EntryRecord insertEntry(EntryRecord entry) {
        jdbc.update(
                """
                INSERT INTO cms_entry
                  (id, content_type_id, slug, publication_state, version, payload, published_payload,
                   published_at, archived_at, deleted_at, created_by, updated_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, CAST(? AS jsonb), CAST(? AS jsonb), ?, ?, ?, ?, ?, ?, ?)
                """,
                entry.id(),
                entry.contentTypeId(),
                entry.slug(),
                entry.publicationState().wire(),
                entry.version(),
                json(entry.payload()),
                json(entry.publishedPayload()),
                ts(entry.publishedAt()),
                ts(entry.archivedAt()),
                ts(entry.deletedAt()),
                entry.createdBy(),
                entry.updatedBy(),
                ts(entry.createdAt()),
                ts(entry.updatedAt()));
        return entry;
    }

    @Override
    public EntryRecord updateEntry(EntryRecord entry) {
        jdbc.update(
                """
                UPDATE cms_entry SET slug = ?, publication_state = ?, version = ?, payload = CAST(? AS jsonb),
                  published_payload = CAST(? AS jsonb), published_at = ?, archived_at = ?, deleted_at = ?,
                  updated_by = ?, updated_at = ?
                WHERE id = ?
                """,
                entry.slug(),
                entry.publicationState().wire(),
                entry.version(),
                json(entry.payload()),
                json(entry.publishedPayload()),
                ts(entry.publishedAt()),
                ts(entry.archivedAt()),
                ts(entry.deletedAt()),
                entry.updatedBy(),
                ts(entry.updatedAt()),
                entry.id());
        return entry;
    }

    @Override
    public void hardDeleteEntry(UUID id) {
        jdbc.update("DELETE FROM cms_entry_index WHERE entry_id = ?", id);
        jdbc.update("DELETE FROM cms_entry_ref WHERE from_entry_id = ?", id);
        jdbc.update("DELETE FROM cms_entry_revision WHERE entry_id = ?", id);
        jdbc.update("DELETE FROM cms_entry WHERE id = ?", id);
    }

    @Override
    public void insertRevision(RevisionRecord revision) {
        jdbc.update(
                """
                INSERT INTO cms_entry_revision
                  (id, entry_id, revision_no, slug, payload, published_at, published_by, content_type_key)
                VALUES (?, ?, ?, ?, CAST(? AS jsonb), ?, ?, ?)
                """,
                revision.id(),
                revision.entryId(),
                revision.revisionNo(),
                revision.slug(),
                json(revision.payload()),
                ts(revision.publishedAt()),
                revision.publishedBy(),
                revision.contentTypeKey());
    }

    @Override
    public List<RevisionRecord> revisionsOf(UUID entryId) {
        return jdbc.query(
                "SELECT * FROM cms_entry_revision WHERE entry_id = ? ORDER BY revision_no DESC",
                revisionMapper(),
                entryId);
    }

    @Override
    public void deleteOldestRevisions(UUID entryId, int keep) {
        jdbc.update(
                """
                DELETE FROM cms_entry_revision WHERE entry_id = ? AND revision_no NOT IN (
                  SELECT revision_no FROM cms_entry_revision WHERE entry_id = ? ORDER BY revision_no DESC LIMIT ?
                )
                """,
                entryId,
                entryId,
                keep);
    }

    @Override
    public void replaceRefs(UUID entryId, List<EntryRefRecord> next) {
        jdbc.update("DELETE FROM cms_entry_ref WHERE from_entry_id = ?", entryId);
        for (EntryRefRecord ref : next) {
            jdbc.update(
                    """
                    INSERT INTO cms_entry_ref (from_entry_id, field_key, to_id, to_kind, sort_position)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    ref.fromEntryId(),
                    ref.fieldKey(),
                    ref.toId(),
                    ref.toKind(),
                    ref.sortPosition());
        }
    }

    @Override
    public List<EntryRefRecord> refsTo(UUID toId) {
        return jdbc.query(
                "SELECT * FROM cms_entry_ref WHERE to_id = ?",
                (rs, n) -> new EntryRefRecord(
                        rs.getObject("from_entry_id", UUID.class),
                        rs.getString("field_key"),
                        rs.getObject("to_id", UUID.class),
                        rs.getString("to_kind"),
                        rs.getInt("sort_position")),
                toId);
    }

    @Override
    public Optional<NavigationRecord> findNavigation(String menuKey) {
        return one(jdbc.query("SELECT * FROM cms_navigation_menu WHERE menu_key = ?", navMapper(), menuKey));
    }

    @Override
    public void upsertNavigation(NavigationRecord menu) {
        int updated = jdbc.update(
                """
                UPDATE cms_navigation_menu SET publication_state = ?, version = ?, document = CAST(? AS jsonb),
                  published_document = CAST(? AS jsonb), updated_by = ?, updated_at = ?
                WHERE menu_key = ?
                """,
                menu.publicationState(),
                menu.version(),
                json(menu.document()),
                json(menu.publishedDocument()),
                menu.updatedBy(),
                ts(menu.updatedAt()),
                menu.menuKey());
        if (updated == 0) {
            jdbc.update(
                    """
                    INSERT INTO cms_navigation_menu
                      (id, menu_key, surface, publication_state, version, document, published_document, updated_by, updated_at)
                    VALUES (?, ?, ?, ?, ?, CAST(? AS jsonb), CAST(? AS jsonb), ?, ?)
                    """,
                    menu.id(),
                    menu.menuKey(),
                    menu.surface(),
                    menu.publicationState(),
                    menu.version(),
                    json(menu.document()),
                    json(menu.publishedDocument()),
                    menu.updatedBy(),
                    ts(menu.updatedAt()));
        }
    }

    private RowMapper<ContentTypeRecord> typeMapper() {
        return (rs, n) -> new ContentTypeRecord(
                rs.getObject("id", UUID.class),
                rs.getString("type_key"),
                rs.getString("display_name"),
                rs.getString("plural_display_name"),
                rs.getString("description"),
                rs.getString("title_field"),
                rs.getString("slug_policy"),
                rs.getBoolean("singleton"),
                rs.getBoolean("enabled"),
                rs.getBoolean("previewable"),
                readStrings(rs.getString("public_requires_published_refs")),
                instant(rs, "created_at"),
                instant(rs, "updated_at"));
    }

    private RowMapper<FieldRecord> fieldMapper() {
        return (rs, n) -> new FieldRecord(
                rs.getObject("id", UUID.class),
                rs.getObject("content_type_id", UUID.class),
                rs.getString("field_key"),
                rs.getString("field_type"),
                rs.getBoolean("required"),
                rs.getBoolean("unique_in_type"),
                rs.getBoolean("indexed"),
                rs.getString("visibility"),
                rs.getInt("sort_order"),
                rs.getString("ref_target_type_key"),
                rs.getString("on_delete"),
                readStrings(rs.getString("enum_values")),
                rs.getBoolean("enabled"),
                columnOrFalse(rs, "public_bytes"));
    }

    private RowMapper<EntryRecord> entryMapper() {
        return (rs, n) -> new EntryRecord(
                rs.getObject("id", UUID.class),
                rs.getObject("content_type_id", UUID.class),
                rs.getString("type_key"),
                rs.getString("slug"),
                PublicationState.fromWire(rs.getString("publication_state")),
                rs.getInt("version"),
                readMap(rs.getString("payload")),
                readMap(rs.getString("published_payload")),
                instant(rs, "published_at"),
                instant(rs, "archived_at"),
                instant(rs, "deleted_at"),
                rs.getObject("created_by", UUID.class),
                rs.getObject("updated_by", UUID.class),
                instant(rs, "created_at"),
                instant(rs, "updated_at"));
    }

    private RowMapper<RevisionRecord> revisionMapper() {
        return (rs, n) -> new RevisionRecord(
                rs.getObject("id", UUID.class),
                rs.getObject("entry_id", UUID.class),
                rs.getInt("revision_no"),
                rs.getString("slug"),
                readMap(rs.getString("payload")),
                instant(rs, "published_at"),
                rs.getObject("published_by", UUID.class),
                rs.getString("content_type_key"));
    }

    private RowMapper<NavigationRecord> navMapper() {
        return (rs, n) -> new NavigationRecord(
                rs.getObject("id", UUID.class),
                rs.getString("menu_key"),
                rs.getString("surface"),
                rs.getString("publication_state"),
                rs.getInt("version"),
                readMap(rs.getString("document")),
                readMap(rs.getString("published_document")),
                rs.getObject("updated_by", UUID.class),
                instant(rs, "updated_at"));
    }

    private String json(Object value) {
        if (value == null) {
            return null;
        }
        try {
            return mapper.writeValueAsString(value);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private Map<String, Object> readMap(String raw) {
        if (raw == null || raw.isBlank()) {
            return new LinkedHashMap<>();
        }
        try {
            Map<String, Object> map = mapper.readValue(raw, MAP);
            return map == null ? new LinkedHashMap<>() : new LinkedHashMap<>(map);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private List<String> readStrings(String raw) {
        if (raw == null || raw.isBlank() || "null".equals(raw)) {
            return List.of();
        }
        try {
            List<String> values = mapper.readValue(raw, STRINGS);
            return values == null ? List.of() : values;
        } catch (Exception e) {
            return List.of();
        }
    }

    private static Timestamp ts(Instant instant) {
        return instant == null ? null : Timestamp.from(instant);
    }

    private static boolean columnOrFalse(ResultSet rs, String col) throws SQLException {
        try {
            return rs.getBoolean(col);
        } catch (SQLException e) {
            return false;
        }
    }

    private static Instant instant(ResultSet rs, String col) throws SQLException {
        Timestamp ts = rs.getTimestamp(col);
        return ts == null ? null : ts.toInstant();
    }

    private static <T> Optional<T> one(List<T> rows) {
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.getFirst());
    }
}
