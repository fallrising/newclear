package com.fallrising.cms.media.store;

import com.fallrising.cms.media.domain.MediaAsset;
import com.fallrising.cms.media.domain.MediaAttachment;
import com.fallrising.cms.media.domain.MediaVariant;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import javax.sql.DataSource;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public class JdbcMediaStore implements MediaStore {

    private final JdbcTemplate jdbc;

    public JdbcMediaStore(DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    @Override
    public void insert(MediaAsset asset) {
        jdbc.update(
                """
                INSERT INTO cms_media
                  (id, owner_principal_id, title, alt_text, original_filename, content_type, byte_size, stored_bytes,
                   width, height, checksum_sha256, status, deleted_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                asset.id(),
                asset.ownerPrincipalId(),
                asset.title(),
                asset.altText(),
                asset.originalFilename(),
                asset.contentType(),
                asset.byteSize(),
                asset.storedBytes(),
                asset.width(),
                asset.height(),
                asset.checksumSha256(),
                asset.status(),
                ts(asset.deletedAt()),
                ts(asset.createdAt()),
                ts(asset.updatedAt()));
    }

    @Override
    public Optional<MediaAsset> find(UUID id) {
        List<MediaAsset> rows = jdbc.query("SELECT * FROM cms_media WHERE id = ?", assetMapper(), id);
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        MediaAsset asset = rows.getFirst();
        return Optional.of(withVariants(asset));
    }

    @Override
    public List<MediaAsset> listAvailable() {
        return jdbc.query(
                        "SELECT * FROM cms_media WHERE status = 'available' ORDER BY created_at DESC",
                        assetMapper())
                .stream()
                .map(this::withVariants)
                .toList();
    }

    @Override
    public void update(MediaAsset asset) {
        jdbc.update(
                """
                UPDATE cms_media SET title = ?, alt_text = ?, status = ?, deleted_at = ?, updated_at = ?, stored_bytes = ?
                WHERE id = ?
                """,
                asset.title(),
                asset.altText(),
                asset.status(),
                ts(asset.deletedAt()),
                ts(asset.updatedAt()),
                asset.storedBytes(),
                asset.id());
    }

    @Override
    public void insertVariant(MediaVariant variant) {
        jdbc.update(
                """
                INSERT INTO cms_media_variant (media_id, variant, content_type, byte_size, width, height, object_key)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                variant.mediaId(),
                variant.variant(),
                variant.contentType(),
                variant.byteSize(),
                variant.width(),
                variant.height(),
                variant.objectKey());
    }

    @Override
    public List<MediaVariant> variantsOf(UUID mediaId) {
        return jdbc.query("SELECT * FROM cms_media_variant WHERE media_id = ?", variantMapper(), mediaId);
    }

    @Override
    public void replaceAttachments(UUID entryId, List<MediaAttachment> attachments) {
        jdbc.update("DELETE FROM cms_media_attachment WHERE entry_id = ?", entryId);
        for (MediaAttachment attachment : attachments) {
            jdbc.update(
                    """
                    INSERT INTO cms_media_attachment (media_id, entry_id, field_key, attached_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    attachment.mediaId(),
                    attachment.entryId(),
                    attachment.fieldKey(),
                    ts(attachment.attachedAt()));
        }
    }

    @Override
    public List<MediaAttachment> attachmentsOfMedia(UUID mediaId) {
        return jdbc.query(
                "SELECT * FROM cms_media_attachment WHERE media_id = ?",
                (rs, n) -> new MediaAttachment(
                        rs.getObject("media_id", UUID.class),
                        rs.getObject("entry_id", UUID.class),
                        rs.getString("field_key"),
                        instant(rs, "attached_at")),
                mediaId);
    }

    @Override
    public long countFiles() {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM cms_media", Long.class);
        return count == null ? 0 : count;
    }

    @Override
    public long sumStoredBytes() {
        Long sum = jdbc.queryForObject("SELECT COALESCE(SUM(stored_bytes),0) FROM cms_media", Long.class);
        return sum == null ? 0 : sum;
    }

    @Override
    public long countByOwner(UUID ownerId) {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM cms_media WHERE owner_principal_id = ?", Long.class, ownerId);
        return count == null ? 0 : count;
    }

    @Override
    public Quota quota() {
        return jdbc.query(
                        "SELECT * FROM cms_media_settings WHERE id = 1",
                        (rs, n) -> new Quota(
                                rs.getLong("max_file_bytes"),
                                rs.getLong("max_library_bytes"),
                                rs.getInt("max_files"),
                                rs.getInt("max_files_per_principal")))
                .stream()
                .findFirst()
                .orElse(new Quota(15_728_640, 2_147_483_648L, 10_000, 2_000));
    }

    private MediaAsset withVariants(MediaAsset asset) {
        return new MediaAsset(
                asset.id(),
                asset.ownerPrincipalId(),
                asset.title(),
                asset.altText(),
                asset.originalFilename(),
                asset.contentType(),
                asset.byteSize(),
                asset.storedBytes(),
                asset.width(),
                asset.height(),
                asset.checksumSha256(),
                asset.status(),
                asset.deletedAt(),
                asset.createdAt(),
                asset.updatedAt(),
                variantsOf(asset.id()));
    }

    private RowMapper<MediaAsset> assetMapper() {
        return (rs, n) -> new MediaAsset(
                rs.getObject("id", UUID.class),
                rs.getObject("owner_principal_id", UUID.class),
                rs.getString("title"),
                rs.getString("alt_text"),
                rs.getString("original_filename"),
                rs.getString("content_type"),
                rs.getLong("byte_size"),
                rs.getLong("stored_bytes"),
                (Integer) rs.getObject("width"),
                (Integer) rs.getObject("height"),
                rs.getString("checksum_sha256"),
                rs.getString("status"),
                instant(rs, "deleted_at"),
                instant(rs, "created_at"),
                instant(rs, "updated_at"),
                List.of());
    }

    private RowMapper<MediaVariant> variantMapper() {
        return (rs, n) -> new MediaVariant(
                rs.getObject("media_id", UUID.class),
                rs.getString("variant"),
                rs.getString("content_type"),
                rs.getLong("byte_size"),
                (Integer) rs.getObject("width"),
                (Integer) rs.getObject("height"),
                rs.getString("object_key"));
    }

    private static Timestamp ts(Instant instant) {
        return instant == null ? null : Timestamp.from(instant);
    }

    private static Instant instant(ResultSet rs, String col) throws SQLException {
        Timestamp ts = rs.getTimestamp(col);
        return ts == null ? null : ts.toInstant();
    }
}
