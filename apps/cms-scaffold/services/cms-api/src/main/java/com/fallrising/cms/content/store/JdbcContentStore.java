package com.fallrising.cms.content.store;

import com.fallrising.cms.content.ContentException;
import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.EntryRefRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.domain.NavigationRecord;
import com.fallrising.cms.content.domain.PublicationState;
import com.fallrising.cms.content.domain.RevisionRecord;
import com.fallrising.cms.content.index.EntryIndexer;
import com.fallrising.cms.content.index.IndexRow;
import com.fallrising.cms.content.index.IndexScope;
import com.fallrising.cms.content.query.AccessFilter;
import com.fallrising.cms.content.query.EntryPage;
import com.fallrising.cms.content.query.EntryQuery;
import com.fallrising.cms.content.query.FieldFilter;
import com.fallrising.cms.content.query.RefFilter;
import com.fallrising.cms.content.query.SortKey;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

public class JdbcContentStore implements ContentStore {

    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};
    private static final TypeReference<List<String>> STRINGS = new TypeReference<>() {};
    private static final TypeReference<Map<String, String>> LABELS = new TypeReference<>() {};

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final TransactionTemplate transactions;

    public JdbcContentStore(DataSource dataSource, ObjectMapper mapper) {
        this.jdbc = new JdbcTemplate(dataSource);
        this.mapper = mapper;
        this.transactions = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
    }

    @Override
    public <T> T writeTransaction(Supplier<T> work) {
        return transactions.execute(status -> work.get());
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
                   singleton, enabled, previewable, public_requires_published_refs, created_at, updated_at,
                   sort_field, visibility_field, owner_field)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?, ?, ?, ?)
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
                ts(type.updatedAt()),
                type.sortField(),
                type.visibilityField(),
                type.ownerField());
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
    public void updateTypeSettings(ContentTypeRecord type) {
        transactions.executeWithoutResult(status -> {
            writeTypeSettings(type);
            reindexType(type.id());
        });
    }

    private void writeTypeSettings(ContentTypeRecord type) {
        jdbc.update(
                "UPDATE cms_content_type SET sort_field = ?, visibility_field = ?, owner_field = ?, updated_at = ? WHERE id = ?",
                type.sortField(),
                type.visibilityField(),
                type.ownerField(),
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
        transactions.executeWithoutResult(status -> {
            writeField(field);
            reindexType(field.contentTypeId());
        });
    }

    private void writeField(FieldRecord field) {
        jdbc.update(
                """
                INSERT INTO cms_field
                  (id, content_type_id, field_key, field_type, required, unique_in_type, indexed, visibility,
                   sort_order, ref_target_type_key, on_delete, enum_values, enabled, public_bytes,
                   label, group_key, listable, filterable, enum_labels, placeholder, help_text)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?)
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
                field.publicBytes(),
                field.label(),
                field.groupKey(),
                field.listable(),
                field.filterable(),
                json(field.enumLabels()),
                field.placeholder(),
                field.helpText());
    }

    @Override
    public void updateFieldMetadata(FieldRecord field) {
        jdbc.update(
                """
                UPDATE cms_field SET label = ?, group_key = ?, listable = ?, filterable = ?,
                  enum_labels = CAST(? AS jsonb), placeholder = ?, help_text = ?
                WHERE id = ?
                """,
                field.label(),
                field.groupKey(),
                field.listable(),
                field.filterable(),
                json(field.enumLabels()),
                field.placeholder(),
                field.helpText(),
                field.id());
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
    public Map<UUID, EntryRecord> findEntries(Collection<UUID> ids) {
        if (ids.isEmpty()) return Map.of();
        String placeholders = String.join(", ", java.util.Collections.nCopies(ids.size(), "?"));
        List<EntryRecord> rows = jdbc.query("SELECT e.*, t.type_key FROM cms_entry e"
                + " JOIN cms_content_type t ON t.id = e.content_type_id WHERE e.id IN (" + placeholders + ")",
                entryMapper(), ids.toArray());
        Map<UUID, EntryRecord> found = new LinkedHashMap<>();
        rows.forEach(entry -> found.put(entry.id(), entry));
        return found;
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
    public EntryPage queryEntries(EntryQuery query) {
        List<Object> args = new ArrayList<>();
        String where = where(query, args);
        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM cms_entry e WHERE " + where, Long.class, args.toArray());
        List<Object> pageArgs = new ArrayList<>();
        String sortColumn = sortColumn(query, pageArgs);
        pageArgs.addAll(args);
        SortKey sort = query.sort();
        String direction = sort.descending() ? "DESC" : "ASC";
        String sql = "SELECT e.*, t.type_key, " + sortColumn + " AS sort_value FROM cms_entry e"
                + " JOIN cms_content_type t ON t.id = e.content_type_id WHERE " + where
                + " ORDER BY sort_value " + direction + " NULLS LAST, e.updated_at DESC NULLS LAST, e.id::text COLLATE \"C\" ASC"
                + " LIMIT ? OFFSET ?";
        pageArgs.add(query.size());
        pageArgs.add(query.offset());
        List<EntryRecord> items = jdbc.query(sql, entryMapper(), pageArgs.toArray());
        return new EntryPage(items, total == null ? 0 : total);
    }

    @Override
    public List<IndexRow> indexRowsOf(UUID entryId) {
        return jdbc.query(
                "SELECT * FROM cms_entry_index WHERE entry_id = ? ORDER BY scope COLLATE \"C\", field_key COLLATE \"C\"",
                (rs, n) -> new IndexRow(
                        rs.getObject("entry_id", UUID.class),
                        rs.getString("field_key"),
                        IndexScope.fromWire(rs.getString("scope")),
                        rs.getString("value_kind"),
                        rs.getString("value_string"),
                        rs.getBigDecimal("value_int"),
                        rs.getObject("value_bool") == null ? null : rs.getBoolean("value_bool"),
                        instant(rs, "value_ts")),
                entryId);
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
        transactions.executeWithoutResult(status -> {
            writeNewEntry(entry);
            reindex(entry);
        });
        return entry;
    }

    private void writeNewEntry(EntryRecord entry) {
        jdbc.update(
                """
                INSERT INTO cms_entry
                  (id, content_type_id, slug, publication_state, version, payload, published_payload,
                   published_at, archived_at, deleted_at, created_by, updated_by, created_at, updated_at, publish_requested_at, publish_requested_by)
                VALUES (?, ?, ?, ?, ?, CAST(? AS jsonb), CAST(? AS jsonb), ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                ts(entry.updatedAt()),
                ts(entry.publishRequestedAt()),
                entry.publishRequestedBy());
    }

    @Override
    public EntryRecord updateEntry(EntryRecord entry) {
        return writeTransaction(() -> {
            writeEntry(entry);
            reindex(entry);
            return entry;
        });
    }

    private void writeEntry(EntryRecord entry) {
        int changed = jdbc.update(
                """
                UPDATE cms_entry SET slug = ?, publication_state = ?, version = ?, payload = CAST(? AS jsonb),
                  published_payload = CAST(? AS jsonb), published_at = ?, archived_at = ?, deleted_at = ?,
                  updated_by = ?, updated_at = ?, publish_requested_at = ?, publish_requested_by = ?
                WHERE id = ? AND version = ?
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
                ts(entry.publishRequestedAt()),
                entry.publishRequestedBy(),
                entry.id(),
                entry.version() - 1);
        if (changed != 1) {
            throw ContentException.versionConflict();
        }
    }

    @Override
    public void hardDeleteEntry(UUID id, int expectedVersion) {
        // Content dependents have ON DELETE CASCADE; claim the version before deleting anything.
        if (jdbc.update("DELETE FROM cms_entry WHERE id = ? AND version = ?", id, expectedVersion) != 1) {
            throw ContentException.versionConflict();
        }
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

    // ---- index maintenance ----

    private void reindex(EntryRecord entry) {
        List<ContentTypeRecord> type = jdbc.query("SELECT * FROM cms_content_type WHERE id = ?", typeMapper(), entry.contentTypeId());
        jdbc.update("DELETE FROM cms_entry_index WHERE entry_id = ?", entry.id());
        if (type.isEmpty()) return;
        insertRows(EntryIndexer.rows(type.getFirst(), fieldsOf(type.getFirst().id()), entry));
    }

    private void reindexType(UUID typeId) {
        List<ContentTypeRecord> type = jdbc.query("SELECT * FROM cms_content_type WHERE id = ?", typeMapper(), typeId);
        if (type.isEmpty()) return;
        List<FieldRecord> fields = fieldsOf(typeId);
        List<EntryRecord> all = jdbc.query(
                """
                SELECT e.*, t.type_key FROM cms_entry e
                JOIN cms_content_type t ON t.id = e.content_type_id
                WHERE e.content_type_id = ?
                """,
                entryMapper(),
                typeId);
        jdbc.update("DELETE FROM cms_entry_index WHERE entry_id IN (SELECT id FROM cms_entry WHERE content_type_id = ?)", typeId);
        List<IndexRow> rows = new ArrayList<>();
        all.forEach(entry -> rows.addAll(EntryIndexer.rows(type.getFirst(), fields, entry)));
        insertRows(rows);
    }

    private void insertRows(List<IndexRow> rows) {
        if (rows.isEmpty()) return;
        jdbc.batchUpdate(
                """
                INSERT INTO cms_entry_index
                  (entry_id, field_key, scope, value_kind, value_string, value_int, value_bool, value_ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows.stream().map(row -> new Object[] {
                        row.entryId(), row.fieldKey(), row.scope().wire(), row.kind(), row.stringValue(),
                        row.intValue(), row.boolValue(), ts(row.tsValue())}).toList());
    }


    // ---- query translation; must match InMemoryContentStore.queryEntries ----

    // The PostgreSQL blank check follows Java String.isBlank, including Unicode whitespace.
    private static final String BLANK_CHARACTERS = java.util.stream.IntStream.rangeClosed(1, Character.MAX_VALUE)
            .filter(Character::isWhitespace).collect(StringBuilder::new, StringBuilder::appendCodePoint,
                    StringBuilder::append).toString();

    private static final String UUID_TEXT = "'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'";

    private String where(EntryQuery query, List<Object> args) {
        String scope = query.scope().wire();
        StringBuilder sql = new StringBuilder("e.content_type_id = ? AND e.deleted_at IS NULL");
        args.add(query.typeId());
        if (query.scope() == IndexScope.WORK) {
            if (query.publishRequested()) sql.append(" AND e.publish_requested_at IS NOT NULL");
            if (query.states().isEmpty()) {
                sql.append(" AND FALSE");
            } else {
                sql.append(" AND e.publication_state IN (")
                        .append(String.join(", ", query.states().stream().map(s -> "?").toList()))
                        .append(")");
                args.addAll(query.states());
            }
        } else {
            sql.append(" AND e.publication_state = 'published' AND e.published_payload IS NOT NULL");
            if (query.visibilityField() != null) {
                sql.append(" AND (e.published_payload ->> ? = 'public'"
                        + " OR btrim(COALESCE(e.published_payload ->> ?, ''), ?) = '')");
                args.add(query.visibilityField());
                args.add(query.visibilityField());
                args.add(BLANK_CHARACTERS);
            }
            for (String refField : query.requiredRefs()) {
                sql.append(" ").append("""
                         AND (e.published_payload ->> ? IS NULL OR EXISTS (
                           SELECT 1 FROM cms_entry te JOIN cms_content_type tt ON tt.id = te.content_type_id
                           WHERE te.id = (CASE WHEN e.published_payload ->> ? ~ %s
                             THEN CAST(e.published_payload ->> ? AS uuid) END)
                             AND te.deleted_at IS NULL AND te.publication_state = 'published'
                             AND te.published_payload IS NOT NULL
                             AND COALESCE(te.published_payload ->> tt.visibility_field, '') <> 'private'))
                        """.formatted(UUID_TEXT));
                args.add(refField);
                args.add(refField);
                args.add(refField);
            }
        }
        if (query.q() != null && !query.q().isBlank()) {
            sql.append(" ").append("""
                     AND EXISTS (SELECT 1 FROM cms_entry_index x WHERE x.entry_id = e.id AND x.scope = ?
                       AND x.field_key = ? AND x.value_string ILIKE ? ESCAPE '\\')""");
            args.add(scope);
            args.add(query.titleField());
            args.add("%" + escapeLike(query.q()) + "%");
        }
        for (FieldFilter filter : query.filters()) {
            sql.append(" AND EXISTS (SELECT 1 FROM cms_entry_index f WHERE f.entry_id = e.id AND f.scope = ? AND f.field_key = ?");
            args.add(scope);
            args.add(filter.fieldKey());
            if (filter.op() == FieldFilter.Op.RANGE) {
                sql.append(" AND f.value_ts IS NOT NULL");
                if (filter.from() != null) {
                    sql.append(" AND f.value_ts >= ?");
                    args.add(ts(filter.from()));
                }
                if (filter.to() != null) {
                    sql.append(" AND f.value_ts < ?");
                    args.add(ts(filter.to()));
                }
            } else {
                sql.append(switch (filter.kind()) {
                    case "int" -> " AND f.value_int = ?";
                    case "bool" -> " AND f.value_bool = ?";
                    default -> " AND f.value_string = ?";
                });
                args.add(filter.value());
            }
            sql.append(")");
        }
        for (RefFilter ref : query.refs()) {
            if (query.scope() == IndexScope.PUBLISHED) {
                // The published copy's relation (02 BQ-10); cms_entry_ref holds the working copy's.
                sql.append(" AND EXISTS (SELECT 1 FROM cms_entry_index rf WHERE rf.entry_id = e.id AND rf.scope = ?"
                        + " AND rf.field_key = ? AND rf.value_string = ?)");
                args.add(scope);
                args.add(ref.fieldKey());
                args.add(ref.targetId().toString());
            } else {
                sql.append(" AND EXISTS (SELECT 1 FROM cms_entry_ref rf WHERE rf.from_entry_id = e.id AND rf.field_key = ? AND rf.to_id = ?)");
                args.add(ref.fieldKey());
                args.add(ref.targetId());
            }
        }
        AccessFilter access = query.access();
        if (!access.unrestricted()) {
            if (access.anyOf().isEmpty()) {
                sql.append(" AND FALSE");
            } else {
                sql.append(" AND EXISTS (SELECT 1 FROM cms_entry_index a WHERE a.entry_id = e.id AND a.scope = ? AND (");
                args.add(scope);
                List<String> clauses = new ArrayList<>();
                for (AccessFilter.Clause clause : access.anyOf()) {
                    clauses.add("(a.field_key = ? AND a.value_string = ?)");
                    args.add(clause.fieldKey());
                    args.add(clause.value());
                }
                sql.append(String.join(" OR ", clauses)).append("))");
            }
        }
        return sql.toString();
    }

    private static String sortColumn(EntryQuery query, List<Object> args) {
        SortKey sort = query.sort();
        if (sort.source() == SortKey.Source.SYSTEM) {
            return switch (sort.key()) {
                case "createdAt" -> "e.created_at";
                case "publishedAt" -> "e.published_at";
                default -> "e.updated_at";
            };
        }
        String column = switch (sort.kind()) {
            case "int" -> "s.value_int";
            case "bool" -> "s.value_bool";
            case "datetime" -> "s.value_ts";
            default -> "s.value_string COLLATE \"C\"";
        };
        args.add(query.scope().wire());
        args.add(sort.key());
        return "(SELECT " + column + " FROM cms_entry_index s WHERE s.entry_id = e.id AND s.scope = ? AND s.field_key = ? LIMIT 1)";
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
                instant(rs, "updated_at"),
                rs.getString("sort_field"),
                rs.getString("visibility_field"),
                rs.getString("owner_field"));
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
                columnOrFalse(rs, "public_bytes"),
                rs.getString("label"),
                rs.getString("group_key"),
                rs.getBoolean("listable"),
                rs.getBoolean("filterable"),
                readLabels(rs.getString("enum_labels")),
                rs.getString("placeholder"),
                rs.getString("help_text"));
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
                readNullableMap(rs.getString("published_payload")),
                instant(rs, "published_at"),
                instant(rs, "archived_at"),
                instant(rs, "deleted_at"),
                rs.getObject("created_by", UUID.class),
                rs.getObject("updated_by", UUID.class),
                instant(rs, "created_at"),
                instant(rs, "updated_at"),
                instant(rs, "publish_requested_at"),
                rs.getObject("publish_requested_by", UUID.class));
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
                readNullableMap(rs.getString("published_document")),
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

    private Map<String, String> readLabels(String raw) {
        if (raw == null || raw.isBlank() || "null".equals(raw)) {
            return Map.of();
        }
        try {
            Map<String, String> labels = mapper.readValue(raw, LABELS);
            return labels == null ? Map.of() : labels;
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private Map<String, Object> readNullableMap(String raw) {
        return raw == null ? null : readMap(raw);
    }

    static String escapeLike(String raw) {
        return raw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
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
